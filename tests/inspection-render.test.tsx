import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Report } from '../src/ui/inspection';
import type { InspectionFinding, InspectionReport } from '../src/ui/report';

const hash = `0x${'a'.repeat(64)}` as const, address = `0x${'b'.repeat(40)}` as const;
const finding: InspectionFinding = { transactionEffect: 'GRANTED_OR_UPDATED', transactionFinding: { chainId: 1, transactionHash: hash, blockNumber: '25956004', logIndex: 12, contract: address, owner: address, evidence: 'RECEIPT_LOG', currentAuthority: 'NOT_CHECKED', kind: 'ERC20_ALLOWANCE', standard: 'ERC20', spender: address, amount: '115792089237316195423570985008687907853269984665640564039457584007913129639935', change: 'SET' }, currentState: { status: 'ACTIVE', risk: 'HIGH', allowance: '115792089237316195423570985008687907853269984665640564039457584007913129639935', reason: 'Current allowance equals maxUint256.' } };
const empty: InspectionReport = { transaction: { chainId: 1, transactionHash: hash, blockHash: hash, blockNumber: '25956004', from: address, to: address, status: 'success', findings: [], malformedLogs: [], ignoredLogCount: 0, currentAuthority: 'NOT_CHECKED' }, residualAuthority: { blockNumber: '25956100', snapshotError: null, findings: [], blastRadius: { verifiedRisk: 'LOW', verification: 'COMPLETE', unknownCount: 0, reason: 'Highest risk among verified active supported permissions.' } } };
function withFindings(findings: InspectionFinding[], risk: 'LOW' | 'MEDIUM' | 'HIGH'): InspectionReport {
  const unknownCount = findings.filter(f => f.currentState.status === 'UNKNOWN').length;
  return { ...empty, transaction: { ...empty.transaction, findings: findings.map(f => f.transactionFinding) }, residualAuthority: { ...empty.residualAuthority, findings, blastRadius: { verifiedRisk: risk, verification: unknownCount ? 'INCOMPLETE' : 'COMPLETE', unknownCount, reason: unknownCount ? 'Risk covers verified active permissions only; unresolved permissions may change the result.' : empty.residualAuthority.blastRadius.reason } } };
}
function render(name: string, report: InspectionReport) {
  const html = renderToStaticMarkup(<Report report={report} />);
  // Optional review artifacts use the real component; no fixture route ships in the product.
  if (process.env.UI_REVIEW_DIR) {
    mkdirSync(process.env.UI_REVIEW_DIR, { recursive: true });
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    writeFileSync(join(process.env.UI_REVIEW_DIR, `${name}.html`), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AFTERMATH — ${name} fixture review</title><style>${css}</style><body><main><header class="masthead"><div class="brand"><span class="brand-mark">↳</span><h1>AFTERMATH</h1></div><span class="network">CONTROLLED TEST FIXTURE</span></header><p class="tagline">State review: ${name}. Synthetic evidence; not a live transaction.</p>${html}</main></body></html>`);
  }
  return html;
}
describe('inspection report rendering', () => {
  it('keeps mixed authority and unknown verification distinct with exact evidence', () => {
    const unknown: InspectionFinding = { ...finding, transactionFinding: { ...finding.transactionFinding, logIndex: 13 }, currentState: { status: 'UNKNOWN', risk: null, reason: 'CALL_FAILED: allowance RPC/contract call failed; current authority cannot be verified.' } };
    const inactive: InspectionFinding = { ...finding, transactionFinding: { ...finding.transactionFinding, logIndex: 14 }, currentState: { status: 'INACTIVE', risk: 'LOW', allowance: '0', reason: 'Current allowance is zero.' } };
    const html = render('mixed-high-unknown', withFindings([finding, unknown, inactive], 'HIGH'));
    for (const text of ['UNLIMITED ERC-20 APPROVAL', 'ACTIVE NOW', 'UNKNOWN', 'NO LONGER ACTIVE', 'INCOMPLETE VERIFICATION', 'BLOCKCHAIN EVIDENCE', 'CURRENT STATE', 'INTERPRETATION', '115792089237316195423570985008687907853269984665640564039457584007913129639935']) expect(html).toContain(text);
    expect(html).not.toContain('VERIFICATION COMPLETE');
  });
  it('qualifies LOW when all current state is unknown', () => {
    const html = render('low-unknown', withFindings([{ ...finding, currentState: { status: 'UNKNOWN', risk: null, reason: 'UNSUPPORTED_STANDARD: operator contract was not classified as ERC721 or ERC1155.' }, transactionFinding: { ...finding.transactionFinding, kind: 'OPERATOR_APPROVAL', standard: 'UNKNOWN', operator: address, approved: true, change: 'SET' } }], 'LOW'));
    expect(html).toContain('UNKNOWN STANDARD'); expect(html).toContain('INCOMPLETE VERIFICATION'); expect(html).not.toContain('VERIFICATION COMPLETE');
  });
  it('distinguishes reverted from successful empty receipts', () => {
    expect(render('reverted', { ...empty, transaction: { ...empty.transaction, status: 'reverted' } })).toContain('Transaction reverted');
    expect(render('empty', empty)).toContain('No supported persistent permissions found');
  });
  it('surfaces snapshot failure even with zero findings', () => {
    const html = render('snapshot-failure', { ...empty, residualAuthority: { ...empty.residualAuthority, blockNumber: null, snapshotError: 'RPC_FAILED: could not verify mainnet and obtain a current block.' } });
    expect(html).toContain('CURRENT SNAPSHOT UNAVAILABLE'); expect(html).not.toContain('VERIFICATION COMPLETE');
  });
  it('keeps finite current allowance and malformed-log reasons visible', () => {
    const report = withFindings([{ ...finding, currentState: { status: 'ACTIVE', risk: 'MEDIUM', allowance: '25', reason: 'Current allowance is finite and non-zero.' } }], 'MEDIUM');
    report.transaction.malformedLogs = [{ logIndex: 18, reason: 'Non-canonical indexed address' }];
    const html = render('medium', report); expect(html).toContain('25 raw units'); expect(html).toContain('ACTIVE · AMOUNT CHANGED'); expect(html).toContain('Non-canonical indexed address');
  });
});
