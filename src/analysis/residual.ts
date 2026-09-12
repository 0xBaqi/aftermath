import { encodeFunctionData, maxUint256, parseAbi, zeroAddress } from 'viem';
import type { Address, Hex } from 'viem';
import { analyzeTransaction, createEthereumClient } from './analyze';
import type { AnalysisClient } from './analyze';
import type { PermissionFinding } from './types';

const abi = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
]);
export interface ResidualClient {
  getChainId(): Promise<number>;
  getBlockNumber(args: { cacheTime: number }): Promise<bigint>;
  call(args: { to: Address; data: Hex; blockNumber: bigint }): Promise<{ data?: Hex }>;
}
export type Risk = 'LOW' | 'MEDIUM' | 'HIGH';
export type CurrentState =
  | { status: 'UNKNOWN'; risk: null; reason: string }
  | { status: 'ACTIVE' | 'INACTIVE'; risk: Risk; reason: string; allowance?: bigint; approvedAddress?: Address; currentOwner?: Address; operatorApproved?: boolean };
export type ResidualFinding = {
  transactionEffect: 'GRANTED_OR_UPDATED' | 'REVOKED';
  transactionFinding: PermissionFinding;
  currentState: CurrentState;
};
const unknown = (reason: string): CurrentState => ({ status: 'UNKNOWN', risk: null, reason });
const same = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase();

export function aggregateBlastRadius(findings: readonly ResidualFinding[]) {
  const ranks = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  let verifiedRisk: Risk = 'LOW';
  for (const { currentState: state } of findings) {
    if (state.status === 'ACTIVE' && state.risk !== null && ranks[state.risk] > ranks[verifiedRisk]) verifiedRisk = state.risk;
  }
  const unknownCount = findings.filter(f => f.currentState.status === 'UNKNOWN').length;
  return { verifiedRisk, verification: unknownCount ? 'INCOMPLETE' as const : 'COMPLETE' as const, unknownCount,
    reason: unknownCount ? 'Risk covers verified active permissions only; unresolved permissions may change the result.' : 'Highest risk among verified active supported permissions.' };
}

async function check(f: PermissionFinding, client: ResidualClient, blockNumber: bigint): Promise<CurrentState> {
  if (f.kind === 'OPERATOR_APPROVAL' && f.standard === 'UNKNOWN') return unknown('UNSUPPORTED_STANDARD: operator contract was not classified as ERC721 or ERC1155.');
  // Inspect raw return words: permissive ABI decoders may accept noncanonical booleans or trailing bytes.
  async function read(functionName: 'allowance' | 'getApproved' | 'ownerOf' | 'isApprovedForAll', args: readonly [Address, Address] | readonly [bigint]) {
    const data = encodeFunctionData({ abi, functionName, args });
    let result;
    try { result = await client.call({ to: f.contract, data, blockNumber }); }
    catch { throw new Error('CALL_FAILED: ' + functionName + ' RPC/contract call failed; current authority cannot be verified.'); }
    if (typeof result?.data !== 'string' || result.data.length !== 66 || !/^0x[0-9a-fA-F]{64}$/.test(result.data)) throw new Error('INVALID_RETURN: ' + functionName + ' did not return one canonical ABI word.');
    return result.data;
  }
  function address(word: Hex): Address {
    if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(word)) throw new Error('INVALID_RETURN: noncanonical address.');
    return ('0x' + word.slice(-40)) as Address;
  }
  try {
    if (f.kind === 'ERC20_ALLOWANCE') {
      const allowance = BigInt(await read('allowance', [f.owner, f.spender]));
      return { status: allowance > 0n ? 'ACTIVE' : 'INACTIVE', risk: allowance === 0n ? 'LOW' : allowance === maxUint256 ? 'HIGH' : 'MEDIUM', allowance,
        reason: allowance === 0n ? 'Current allowance is zero.' : allowance === maxUint256 ? 'Current allowance equals maxUint256.' : 'Current allowance is finite and non-zero.' };
    }
    if (f.kind === 'ERC721_TOKEN_APPROVAL') {
      const approvedAddress = address(await read('getApproved', [f.tokenId]));
      const currentOwner = address(await read('ownerOf', [f.tokenId]));
      if (same(currentOwner, zeroAddress)) return unknown('INVALID_RETURN: ownerOf returned the zero address.');
      const active = !same(f.approved, zeroAddress) && same(approvedAddress, f.approved) && same(currentOwner, f.owner);
      return { status: active ? 'ACTIVE' : 'INACTIVE', risk: active ? 'MEDIUM' : 'LOW', approvedAddress, currentOwner,
        reason: active ? 'The recorded owner and individual approved address still match.' : 'The recorded individual permission is no longer active (approval cleared/changed or owner changed).' };
    }
    const value = BigInt(await read('isApprovedForAll', [f.owner, f.operator]));
    if (value !== 0n && value !== 1n) return unknown('INVALID_RETURN: isApprovedForAll returned a noncanonical boolean.');
    const operatorApproved = value === 1n;
    return { status: operatorApproved ? 'ACTIVE' : 'INACTIVE', risk: operatorApproved ? 'HIGH' : 'LOW', operatorApproved,
      reason: operatorApproved ? 'Current operator authority covers the collection for this owner.' : 'Current operator approval is false.' };
  } catch (error) { return unknown(error instanceof Error ? error.message : 'CALL_FAILED: current authority could not be verified.'); }
}

export async function evaluateResidualAuthority(findings: readonly PermissionFinding[], client: ResidualClient) {
  let blockNumber: bigint | null = null;
  let failure: string | null = null;
  try {
    if (await client.getChainId() !== 1) failure = 'WRONG_CHAIN: Ethereum mainnet is required.';
    else {
      blockNumber = await client.getBlockNumber({ cacheTime: 0 });
      if (typeof blockNumber !== 'bigint' || blockNumber < 0n || findings.some(f => f.blockNumber > blockNumber!)) {
        failure = 'INVALID_SNAPSHOT: current block is invalid or predates transaction evidence.';
        blockNumber = null;
      }
    }
  } catch { failure = 'RPC_FAILED: could not verify mainnet and obtain a current block.'; }
  const results: ResidualFinding[] = [];
  // Sequential reads bound RPC concurrency. Every read uses the same freshly captured block.
  for (const finding of findings) {
    results.push({ transactionFinding: finding, transactionEffect: finding.change === 'REVOKE' ? 'REVOKED' : 'GRANTED_OR_UPDATED',
      currentState: failure ? unknown(failure) : await check(finding, client, blockNumber!) });
  }
  return { blockNumber, snapshotError: failure, findings: results, blastRadius: aggregateBlastRadius(results) };
}

export async function analyzeTransactionWithResidualAuthority(input: unknown, suppliedClient?: AnalysisClient & ResidualClient) {
  const client = suppliedClient ?? createEthereumClient();
  const transaction = await analyzeTransaction(input, client);
  const residualAuthority = await evaluateResidualAuthority(transaction.findings, client);
  return { transaction, residualAuthority };
}
