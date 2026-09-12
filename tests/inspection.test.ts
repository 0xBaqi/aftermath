import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/analyze/route';
import { analyzeTransactionWithResidualAuthority } from '../src/analysis/residual';
import { currentValue, effectLabel, stateLabel } from '../src/ui/report';
import type { InspectionFinding } from '../src/ui/report';

vi.mock('../src/analysis/residual', () => ({ analyzeTransactionWithResidualAuthority: vi.fn() }));
const analyze = vi.mocked(analyzeTransactionWithResidualAuthority);
const hash = `0x${'a'.repeat(64)}`;
const request = (body: unknown) => new Request('http://localhost/api/analyze', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
beforeEach(() => { vi.stubEnv('ETHEREUM_RPC_URL', 'https://example.invalid/private-key'); analyze.mockReset(); });
afterEach(() => vi.unstubAllEnvs());

describe('inspection API boundary', () => {
  it.each([{}, { hash: '0x12' }, { hash: `${hash}\n` }, { hash: 42 }, null])('rejects invalid requests before RPC: %j', async body => {
    expect((await POST(request(body))).status).toBe(400); expect(analyze).not.toHaveBeenCalled();
  });
  it('handles malformed JSON', async () => { expect((await POST(new Request('http://localhost', { method: 'POST', body: '{' }))).status).toBe(400); });
  it('reports missing configuration without calling the engine', async () => {
    vi.stubEnv('ETHEREUM_RPC_URL', ''); const response = await POST(request({ hash }));
    expect(response.status).toBe(503); expect((await response.json()).error.code).toBe('RPC_NOT_CONFIGURED'); expect(analyze).not.toHaveBeenCalled();
  });
  it('preserves exact evidence, unknown state and reverted status without reinterpretation', async () => {
    const report = { transaction: { status: 'reverted', blockNumber: 9007199254740993n, findings: [] }, residualAuthority: { blockNumber: null, snapshotError: 'RPC_FAILED', findings: [{ currentState: { status: 'UNKNOWN', risk: null, reason: 'CALL_FAILED' } }], blastRadius: { verifiedRisk: 'LOW', verification: 'INCOMPLETE', unknownCount: 1 } } };
    analyze.mockResolvedValue(report as unknown as Awaited<ReturnType<typeof analyzeTransactionWithResidualAuthority>>);
    const response = await POST(request({ hash: hash.toUpperCase().replace('0X', '0x') }));
    expect(analyze).toHaveBeenCalledWith(hash); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(JSON.parse(JSON.stringify(report, (_, value) => typeof value === 'bigint' ? String(value) : value)));
  });
  it('does not expose provider credentials', async () => {
    analyze.mockRejectedValue(new Error('https://example.invalid/private-key failed'));
    const response = await POST(request({ hash })); expect(response.status).toBe(502); const body = await response.text(); expect(body).toContain('RPC_FAILURE'); expect(body).not.toContain('private-key');
  });
  it('preserves pending and wrong-chain failure distinctions', async () => {
    analyze.mockRejectedValueOnce(new Error('Transaction is pending; a mined receipt is required.')).mockRejectedValueOnce(new Error('Only Ethereum mainnet (chain ID 1) is supported.'));
    expect((await POST(request({ hash }))).status).toBe(409); expect((await POST(request({ hash }))).status).toBe(503);
  });
});

const base: InspectionFinding = { transactionEffect: 'GRANTED_OR_UPDATED', transactionFinding: { chainId: 1, transactionHash: hash as `0x${string}`, blockNumber: '100', logIndex: 1, contract: '0x1', owner: '0x2', evidence: 'RECEIPT_LOG', currentAuthority: 'NOT_CHECKED', kind: 'ERC20_ALLOWANCE', standard: 'ERC20', spender: '0x3', amount: '50', change: 'SET' }, currentState: { status: 'ACTIVE', risk: 'MEDIUM', allowance: '49', reason: 'Current allowance is finite and non-zero.' } };
describe('evidence-to-state wording', () => {
  it('shows a changed amount without changing receipt evidence', () => { expect(effectLabel(base)).toBe('FINITE ERC-20 APPROVAL'); expect(stateLabel(base)).toBe('ACTIVE · AMOUNT CHANGED'); expect(currentValue(base)).toBe('49 raw units'); });
  it('does not mislabel spent-down allowance as a revocation', () => { expect(stateLabel({ ...base, currentState: { status: 'INACTIVE', risk: 'LOW', allowance: '0', reason: 'Current allowance is zero.' } })).toBe('NO LONGER ACTIVE'); });
  it('does not guess authority or risk when reads fail', () => { const finding: InspectionFinding = { ...base, currentState: { status: 'UNKNOWN', risk: null, reason: 'CALL_FAILED' } }; expect(stateLabel(finding)).toBe('UNKNOWN'); expect(currentValue(finding)).toBe('Could not verify current authority.'); });
  it('separates recorded revocation from a later active grant', () => { const f: InspectionFinding = { ...base, transactionEffect: 'REVOKED', transactionFinding: { ...base.transactionFinding, kind: 'ERC20_ALLOWANCE', standard: 'ERC20', spender: '0x3', amount: '0', change: 'REVOKE' } }; expect(effectLabel(f)).toBe('ALLOWANCE SET TO ZERO'); expect(stateLabel(f)).toBe('ACTIVE NOW'); });
});
