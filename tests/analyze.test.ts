import { describe, expect, it, vi } from 'vitest';
import type { AnalysisClient } from '../src/analysis/analyze';
import { analyzeTransaction, detectOperatorStandard, INTERFACES } from '../src/analysis/analyze';
import { blockHash, contract, erc20, erc721, hash, operator, owner } from './fixtures';

function client() {
  return {
    getChainId: vi.fn(async () => 1),
    getTransaction: vi.fn<AnalysisClient['getTransaction']>(async () => ({ hash, from: owner, to: contract, blockHash, blockNumber: 123n })),
    getTransactionReceipt: vi.fn<AnalysisClient['getTransactionReceipt']>(async () => ({ transactionHash: hash, blockHash, blockNumber: 123n, status: 'success' as const, logs: [erc20(), erc721(), operator()] })),
    readContract: vi.fn<AnalysisClient['readContract']>(async ({ args }) => args[0] === INTERFACES.erc165 || args[0] === INTERFACES.erc721),
  };
}

describe('ERC165 classification', () => {
  it.each([
    [true, false, true, false, 'ERC721'],
    [true, false, false, true, 'ERC1155'],
    [true, false, true, true, 'UNKNOWN'],
    [true, false, false, false, 'UNKNOWN'],
    [false, false, true, false, 'UNKNOWN'],
    [true, true, true, false, 'UNKNOWN'],
  ] as const)('classifies interface responses %#', async (erc165, invalid, erc721, erc1155, expected) => {
    const rpc = client();
    const responses: Record<string, boolean> = { [INTERFACES.erc165]: erc165, [INTERFACES.invalid]: invalid, [INTERFACES.erc721]: erc721, [INTERFACES.erc1155]: erc1155 };
    rpc.readContract.mockImplementation(async ({ args }) => responses[args[0]]);
    expect(await detectOperatorStandard(rpc, contract, 123n)).toBe(expected);
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 123n, gas: 30_000n }));
  });
  it('keeps UNKNOWN on RPC failure', async () => {
    const rpc = client();
    rpc.readContract.mockRejectedValue(new Error('state unavailable'));
    expect(await detectOperatorStandard(rpc, contract, 123n)).toBe('UNKNOWN');
  });
});

describe('transaction analysis', () => {
  it('retrieves both objects, decodes all owners and caches interface reads per contract', async () => {
    const rpc = client();
    rpc.getTransactionReceipt.mockResolvedValue({ transactionHash: hash, blockHash, blockNumber: 123n, status: 'success', logs: [{ ...operator(false), logIndex: 4 }, { ...erc20(), logIndex: 1 }, { ...operator(), logIndex: 3 }, { ...erc721(), logIndex: 2 }] });
    const result = await analyzeTransaction(hash, rpc);
    expect(rpc.getTransaction).toHaveBeenCalledWith({ hash });
    expect(rpc.getTransactionReceipt).toHaveBeenCalledWith({ hash });
    expect(result.findings.map(f => f.logIndex)).toEqual([1, 2, 3, 4]);
    expect(result.findings[2]).toMatchObject({ standard: 'ERC721', currentAuthority: 'NOT_CHECKED' });
    expect(result.findings[3].change).toBe('REVOKE');
    expect(rpc.readContract).toHaveBeenCalledTimes(4);
  });
  it('rejects invalid hashes before any network call', async () => {
    const rpc = client();
    await expect(analyzeTransaction('0xno', rpc)).rejects.toThrow('Transaction hash');
    expect(rpc.getChainId).not.toHaveBeenCalled();
  });
  it('rejects a non-Ethereum endpoint', async () => {
    const rpc = client(); rpc.getChainId.mockResolvedValue(137);
    await expect(analyzeTransaction(hash, rpc)).rejects.toThrow('Ethereum mainnet');
    expect(rpc.getTransaction).not.toHaveBeenCalled();
  });
  it('rejects pending transactions before requesting a receipt', async () => {
    const rpc = client();
    rpc.getTransaction.mockResolvedValue({ hash, from: owner, to: null, blockHash: null, blockNumber: null });
    await expect(analyzeTransaction(hash, rpc)).rejects.toThrow('pending');
    expect(rpc.getTransactionReceipt).not.toHaveBeenCalled();
  });
  it('propagates transaction not found and receipt RPC failures', async () => {
    const rpc = client(); rpc.getTransaction.mockRejectedValueOnce(new Error('not found'));
    await expect(analyzeTransaction(hash, rpc)).rejects.toThrow('not found');
    rpc.getTransactionReceipt.mockRejectedValueOnce(new Error('RPC unavailable'));
    await expect(analyzeTransaction(hash, rpc)).rejects.toThrow('RPC unavailable');
  });
  it('rejects mismatched block evidence', async () => {
    const rpc = client(); rpc.getTransactionReceipt.mockResolvedValue({ transactionHash: hash, blockHash: hash, blockNumber: 123n, status: 'success', logs: [] });
    await expect(analyzeTransaction(hash, rpc)).rejects.toThrow('do not match');
  });
  it('returns no permission findings for reverted transactions', async () => {
    const rpc = client(); rpc.getTransactionReceipt.mockResolvedValue({ transactionHash: hash, blockHash, blockNumber: 123n, status: 'reverted', logs: [erc20()] });
    const result = await analyzeTransaction(hash, rpc);
    expect(result.status).toBe('reverted'); expect(result.findings).toEqual([]);
    expect(rpc.readContract).not.toHaveBeenCalled();
  });
  it('keeps valid findings alongside malformed and unrelated logs', async () => {
    const rpc = client(); rpc.getTransactionReceipt.mockResolvedValue({ transactionHash: hash, blockHash, blockNumber: 123n, status: 'success', logs: [erc20(), { ...erc20(), data: '0x', logIndex: 1 }, { ...erc20(), topics: [], logIndex: 2 }] });
    const result = await analyzeTransaction(hash, rpc);
    expect(result.findings).toHaveLength(1); expect(result.malformedLogs).toHaveLength(1); expect(result.ignoredLogCount).toBe(1);
  });
  it('handles a successful transaction with no approval logs', async () => {
    const rpc = client(); rpc.getTransactionReceipt.mockResolvedValue({ transactionHash: hash, blockHash, blockNumber: 123n, status: 'success', logs: [] });
    expect((await analyzeTransaction(hash, rpc)).findings).toEqual([]);
  });
});


