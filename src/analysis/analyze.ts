import { createPublicClient, fallback, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import type { Address, Hash, Hex } from 'viem';
import { decodePermissionLog, validateTransactionHash } from './decode';
import type { PermissionFinding, ReceiptLog } from './types';

const erc165Abi = parseAbi(['function supportsInterface(bytes4 interfaceId) view returns (bool)']);
export const INTERFACES = { erc165: '0x01ffc9a7', invalid: '0xffffffff', erc721: '0x80ac58cd', erc1155: '0xd9b67a26' } as const;

export type AnalysisStage = 'CHAIN_CHECK' | 'TRANSACTION_FETCH' | 'RECEIPT_FETCH' | 'LOG_PROCESSING';

export class AnalysisStageError extends Error {
  readonly stage: AnalysisStage;

  constructor(stage: AnalysisStage) {
    super(`ANALYSIS_STAGE_FAILED:${stage}`);
    this.name = 'AnalysisStageError';
    this.stage = stage;
  }
}

// Small injectable boundary keeps unit tests independent of a live RPC service.
export interface AnalysisClient {
  getChainId(): Promise<number>;
  getTransaction(args: { hash: Hash }): Promise<{ hash: Hash; from: Address; to: Address | null; blockHash: Hash | null; blockNumber: bigint | null }>;
  getTransactionReceipt(args: { hash: Hash }): Promise<{ transactionHash: Hash; blockHash: Hash; blockNumber: bigint; status: 'success' | 'reverted'; logs: readonly ReceiptLog[] }>;
  readContract(args: { address: Address; abi: typeof erc165Abi; functionName: 'supportsInterface'; args: readonly [Hex]; blockNumber: bigint; gas: bigint }): Promise<boolean>;
}

export function createEthereumClient(rpcUrl = process.env.ETHEREUM_RPC_URL) {
  if (!rpcUrl) throw new Error('ETHEREUM_RPC_URL is required.');

  const transport = fallback([
    http('https://ethereum-rpc.publicnode.com', { timeout: 10_000, retryCount: 0 }),
    http(rpcUrl, { timeout: 10_000, retryCount: 0 }),
    http('https://cloudflare-eth.com', { timeout: 10_000, retryCount: 0 }),
  ]);

  return createPublicClient({ chain: mainnet, transport });
}

export async function detectOperatorStandard(client: AnalysisClient, contract: Address, blockNumber: bigint): Promise<'ERC721' | 'ERC1155' | 'UNKNOWN'> {
  const supports = (id: Hex) => client.readContract({ address: contract, abi: erc165Abi, functionName: 'supportsInterface', args: [id], blockNumber, gas: 30_000n });
  try {
    const [erc165, invalid] = await Promise.all([supports(INTERFACES.erc165), supports(INTERFACES.invalid)]);
    if (erc165 !== true || invalid !== false) return 'UNKNOWN';
    const [erc721, erc1155] = await Promise.all([supports(INTERFACES.erc721), supports(INTERFACES.erc1155)]);
    if (erc721 === true && erc1155 === false) return 'ERC721';
    if (erc1155 === true && erc721 === false) return 'ERC1155';
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

export async function analyzeTransaction(input: unknown, suppliedClient?: AnalysisClient) {
  const hash = validateTransactionHash(input);
  const client = suppliedClient ?? createEthereumClient();

  let chainId: number;
  try { chainId = await client.getChainId(); }
  catch { throw new AnalysisStageError('CHAIN_CHECK'); }
  if (chainId !== 1) throw new Error('Only Ethereum mainnet (chain ID 1) is supported.');

  let transaction: Awaited<ReturnType<AnalysisClient['getTransaction']>>;
  try { transaction = await client.getTransaction({ hash }); }
  catch { throw new AnalysisStageError('TRANSACTION_FETCH'); }
  if (transaction.blockNumber === null || transaction.blockHash === null) throw new Error('Transaction is pending; a mined receipt is required.');

  let receipt: Awaited<ReturnType<AnalysisClient['getTransactionReceipt']>>;
  try { receipt = await client.getTransactionReceipt({ hash }); }
  catch { throw new AnalysisStageError('RECEIPT_FETCH'); }

  if (transaction.hash.toLowerCase() !== hash || receipt.transactionHash.toLowerCase() !== hash ||
      transaction.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase() || transaction.blockNumber !== receipt.blockNumber) {
    throw new Error('Transaction and receipt do not match; retry after chain reorganization or RPC inconsistency.');
  }

  try {
    const findings: PermissionFinding[] = [];
    const malformedLogs: { logIndex: number; reason: string }[] = [];
    let ignoredLogCount = 0;
    const standards = new Map<string, Awaited<ReturnType<typeof detectOperatorStandard>>>();
    if (receipt.status === 'success') {
      for (const log of [...receipt.logs].sort((a, b) => a.logIndex - b.logIndex)) {
        const decoded = decodePermissionLog(log, { transactionHash: hash, blockNumber: receipt.blockNumber });
        if (decoded.type === 'ignored') { ignoredLogCount++; continue; }
        if (decoded.type === 'malformed') { malformedLogs.push({ logIndex: decoded.logIndex, reason: decoded.reason }); continue; }
        const finding = decoded.finding;
        if (finding.kind === 'OPERATOR_APPROVAL') {
          const key = finding.contract.toLowerCase();
          let standard = standards.get(key);
          if (!standard) {
            standard = await detectOperatorStandard(client, finding.contract, receipt.blockNumber);
            standards.set(key, standard);
          }
          finding.standard = standard;
        }
        findings.push(finding);
      }
    }
    return {
      chainId: 1 as const, transactionHash: hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
      from: transaction.from, to: transaction.to, status: receipt.status,
      findings, malformedLogs, ignoredLogCount, currentAuthority: 'NOT_CHECKED' as const,
    };
  } catch {
    throw new AnalysisStageError('LOG_PROCESSING');
  }
}
