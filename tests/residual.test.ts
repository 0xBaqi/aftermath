import { describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, maxUint256, padHex, parseAbi, zeroAddress } from 'viem';
import { analyzeTransactionWithResidualAuthority, evaluateResidualAuthority } from '../src/analysis/residual';
import type { ResidualClient } from '../src/analysis/residual';
import { decodePermissionLog } from '../src/analysis/decode';
import type { PermissionFinding, ReceiptLog } from '../src/analysis/types';
import { blockHash, context, contract, delegate, erc20, erc721, hash, operator, owner, uint } from './fixtures';

const abi = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
]);
function finding(log: ReceiptLog): PermissionFinding {
  const result = decodePermissionLog(log, context);
  if (result.type !== 'finding') throw new Error('Invalid fixture');
  return result.finding;
}
function nftOperator(standard: 'ERC721' | 'ERC1155' = 'ERC721', enabled = true): PermissionFinding {
  return { ...finding(operator(enabled)), standard } as PermissionFinding;
}
function client(values: Record<string, unknown> = {}) {
  return {
    getChainId: vi.fn(async () => 1),
    getBlockNumber: vi.fn(async () => 200n),
    call: vi.fn<ResidualClient['call']>(async ({ data }) => {
      const { functionName } = decodeFunctionData({ abi, data });
      const value = Object.hasOwn(values, functionName) ? values[functionName] : { allowance: uint(42n), getApproved: padHex(delegate), ownerOf: padHex(owner), isApprovedForAll: uint(1n) }[functionName];
      if (value instanceof Error) throw value;
      return { data: value } as Awaited<ReturnType<ResidualClient['call']>>;
    }),
  };
}
const state = async (f: PermissionFinding, values: Record<string, unknown> = {}) => (await evaluateResidualAuthority([f], client(values))).findings[0].currentState;

describe('current ERC20 authority', () => {
  it.each([[0n, 'INACTIVE', 'LOW'], [1n, 'ACTIVE', 'MEDIUM'], [maxUint256 - 1n, 'ACTIVE', 'MEDIUM'], [maxUint256, 'ACTIVE', 'HIGH']] as const)('classifies current allowance %s', async (amount, status, risk) => {
    expect(await state(finding(erc20(maxUint256)), { allowance: uint(amount) })).toMatchObject({ status, risk, allowance: amount });
  });
  it('separates a revoked event from a subsequent active grant', async () => {
    const result = await evaluateResidualAuthority([finding(erc20(0n))], client());
    expect(result.findings[0]).toMatchObject({ transactionEffect: 'REVOKED', currentState: { status: 'ACTIVE', risk: 'MEDIUM' } });
  });
  it('preserves event evidence when revoked after the transaction', async () => {
    const original = finding(erc20(maxUint256));
    const before = structuredClone(original);
    const result = await evaluateResidualAuthority([original], client({ allowance: uint(0n) }));
    expect(original).toEqual(before);
    expect(result.findings[0]).toMatchObject({ transactionEffect: 'GRANTED_OR_UPDATED', currentState: { status: 'INACTIVE', risk: 'LOW' } });
  });
});

describe('individual NFT authority', () => {
  it.each([[delegate, owner, 'ACTIVE', 'MEDIUM'], [zeroAddress, owner, 'INACTIVE', 'LOW'], [contract, owner, 'INACTIVE', 'LOW'], [delegate, contract, 'INACTIVE', 'LOW']] as const)('checks approved address %s and owner %s', async (approved, currentOwner, status, risk) => {
    expect(await state(finding(erc721()), { getApproved: padHex(approved), ownerOf: padHex(currentOwner) })).toMatchObject({ status, risk });
  });
  it('compares addresses without case sensitivity', async () => {
    const f = finding(erc721());
    if (f.kind !== 'ERC721_TOKEN_APPROVAL') throw new Error();
    f.approved = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    expect(await state(f, { getApproved: padHex('0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD') })).toMatchObject({ status: 'ACTIVE' });
  });
  it('never treats zero approved address as active authority', async () => {
    const log = erc721(); log.topics = [log.topics[0], log.topics[1], padHex(zeroAddress), log.topics[3]];
    expect(await state(finding(log), { getApproved: padHex(zeroAddress) })).toMatchObject({ status: 'INACTIVE' });
  });
  it.each(['getApproved', 'ownerOf'])('returns UNKNOWN for %s failure, including burned tokens', async name => {
    expect(await state(finding(erc721()), { [name]: new Error('execution reverted') })).toMatchObject({ status: 'UNKNOWN', risk: null, reason: expect.stringContaining(name) });
  });
  it('rejects a zero owner', async () => {
    expect(await state(finding(erc721()), { ownerOf: padHex(zeroAddress) })).toMatchObject({ status: 'UNKNOWN' });
  });
});

describe('operator authority', () => {
  it.each(['ERC721', 'ERC1155'] as const)('checks active and revoked %s operators', async standard => {
    expect(await state(nftOperator(standard), { isApprovedForAll: uint(1n) })).toMatchObject({ status: 'ACTIVE', risk: 'HIGH' });
    expect(await state(nftOperator(standard), { isApprovedForAll: uint(0n) })).toMatchObject({ status: 'INACTIVE', risk: 'LOW' });
    expect(await state(nftOperator(standard, false))).toMatchObject({ status: 'ACTIVE', risk: 'HIGH' });
  });
  it('does not guess the standard', async () => {
    const rpc = client();
    const result = await evaluateResidualAuthority([finding(operator())], rpc);
    expect(result.findings[0].currentState).toMatchObject({ status: 'UNKNOWN', reason: expect.stringContaining('UNSUPPORTED_STANDARD') });
    expect(rpc.call).not.toHaveBeenCalled();
  });
  it('handles operator call failure', async () => {
    expect(await state(nftOperator(), { isApprovedForAll: new Error('timeout') })).toMatchObject({ status: 'UNKNOWN', risk: null });
  });
});

describe('strict failures and snapshots', () => {
  it.each([undefined, '0x', '0x01', uint(1n) + '00', uint(1n) + '\n', 42, '0x' + 'gg'.repeat(32)])('rejects malformed allowance return %#', async value => {
    expect(await state(finding(erc20()), { allowance: value })).toMatchObject({ status: 'UNKNOWN', reason: expect.stringContaining('INVALID_RETURN') });
  });
  it('rejects noncanonical bool', async () => {
    expect(await state(nftOperator(), { isApprovedForAll: uint(2n) })).toMatchObject({ status: 'UNKNOWN' });
  });
  it('rejects noncanonical address', async () => {
    expect(await state(finding(erc721()), { getApproved: uint(maxUint256) })).toMatchObject({ status: 'UNKNOWN' });
  });
  it('contains RPC failures without leaking endpoint secrets', async () => {
    const result = await state(finding(erc20()), { allowance: new Error('https://secret:key@rpc') });
    expect(result).toMatchObject({ status: 'UNKNOWN', risk: null });
    expect(result.reason).not.toContain('secret');
  });
  it.each(['chain', 'block', 'wrong chain', 'stale block'] as const)('handles %s failure', async failure => {
    const rpc = client();
    if (failure === 'chain') rpc.getChainId.mockRejectedValue(new Error());
    if (failure === 'block') rpc.getBlockNumber.mockRejectedValue(new Error());
    if (failure === 'wrong chain') rpc.getChainId.mockResolvedValue(137);
    if (failure === 'stale block') rpc.getBlockNumber.mockResolvedValue(122n);
    const result = await evaluateResidualAuthority([finding(erc20())], rpc);
    expect(result.findings[0].currentState.status).toBe('UNKNOWN');
    expect(result.snapshotError).toBeTruthy();
    expect(rpc.call).not.toHaveBeenCalled();
  });
  it('pins all reads to one fresh current block and uses exact identities', async () => {
    const rpc = client();
    await evaluateResidualAuthority([finding(erc20()), finding(erc721()), nftOperator()], rpc);
    expect(rpc.getBlockNumber).toHaveBeenCalledExactlyOnceWith({ cacheTime: 0 });
    const calls = rpc.call.mock.calls.map(([call]) => {
      expect(call.to).toBe(contract); expect(call.blockNumber).toBe(200n);
      return decodeFunctionData({ abi, data: call.data });
    });
    expect(calls).toEqual([
      { functionName: 'allowance', args: [owner, delegate] },
      { functionName: 'getApproved', args: [42n] },
      { functionName: 'ownerOf', args: [42n] },
      { functionName: 'isApprovedForAll', args: [owner, delegate] },
    ]);
  });
});

describe('aggregate and integration', () => {
  it.each([
    [0n, 0n, 'LOW'], [42n, 0n, 'MEDIUM'], [0n, 1n, 'HIGH'], [maxUint256, 0n, 'HIGH'],
  ] as const)('takes highest active risk %#', async (allowance, enabled, expected) => {
    const result = await evaluateResidualAuthority([finding(erc20()), nftOperator()], client({ allowance: uint(allowance), isApprovedForAll: uint(enabled) }));
    expect(result.blastRadius).toMatchObject({ verifiedRisk: expected, verification: 'COMPLETE', unknownCount: 0 });
  });
  it('does not inflate risk for unknown state alongside finite allowance', async () => {
    const result = await evaluateResidualAuthority([finding(erc20()), finding(operator())], client());
    expect(result.blastRadius).toMatchObject({ verifiedRisk: 'MEDIUM', verification: 'INCOMPLETE', unknownCount: 1 });
  });
  it('all unknown remains explicitly incomplete', async () => {
    const result = await evaluateResidualAuthority([finding(erc20())], client({ allowance: new Error() }));
    expect(result.blastRadius).toMatchObject({ verifiedRisk: 'LOW', verification: 'INCOMPLETE', unknownCount: 1 });
  });
  it('empty findings have LOW verified risk', async () => {
    expect((await evaluateResidualAuthority([], client())).blastRadius).toMatchObject({ verifiedRisk: 'LOW', verification: 'COMPLETE' });
  });
  it('integrates receipt evidence and current state without changing the M1 result', async () => {
    const rpc = {
      ...client({ allowance: uint(0n) }),
      getTransaction: async () => ({ hash, from: owner, to: contract, blockHash, blockNumber: 123n }),
      getTransactionReceipt: async () => ({ transactionHash: hash, blockHash, blockNumber: 123n, status: 'success' as const, logs: [erc20()] }),
      readContract: async () => false,
    };
    const result = await analyzeTransactionWithResidualAuthority(hash, rpc);
    expect(result.transaction.currentAuthority).toBe('NOT_CHECKED');
    expect(result.residualAuthority.findings[0].currentState.status).toBe('INACTIVE');
    expect(result.residualAuthority.blastRadius.verifiedRisk).toBe('LOW');
  });
});
