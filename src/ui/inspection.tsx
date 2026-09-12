'use client';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { InspectionFinding, InspectionReport } from './report';
import { currentValue, effectLabel, stateLabel } from './report';

function Identity({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setFailed(false); }
    catch { setFailed(true); }
  }
  return <span className="identity"><code title={value}>{value.slice(0, 10)}…{value.slice(-8)}</code><button type="button" className="copy" onClick={copy} aria-label={`Copy ${label}`} title={value}>{copied ? 'Copied' : 'Copy'}</button>{failed && <span role="status" className="copy-failure">Copy unavailable. Full value: <code>{value}</code></span>}</span>;
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="field"><dt>{label}</dt><dd>{children}</dd></div>; }
function Risk({ value }: { value: string }) { return <span className={`risk risk-${value.toLowerCase()}`}>{value}</span>; }

function Finding({ finding, index }: { finding: InspectionFinding; index: number }) {
  const f = finding.transactionFinding;
  const s = finding.currentState;
  const delegate = f.kind === 'ERC20_ALLOWANCE' ? f.spender : f.kind === 'ERC721_TOKEN_APPROVAL' ? f.approved : f.operator;
  return <article className="finding" aria-labelledby={`finding-${index}`}>
    <header className="finding-top"><span className="eyebrow">PERMISSION {String(index + 1).padStart(2, '0')} <span className="muted">/ {f.standard === 'UNKNOWN' ? 'UNKNOWN STANDARD' : f.standard.replace('ERC', 'ERC-')} · LOG {f.logIndex}</span></span><Risk value={s.risk ?? 'UNKNOWN'} /></header>
    <div className="effect-state"><div><p className="eyebrow muted">TRANSACTION EFFECT</p><h3 id={`finding-${index}`}>{effectLabel(finding)}</h3><p className="supporting">{finding.transactionEffect === 'REVOKED' ? 'Revocation recorded in this transaction.' : 'Grant or update recorded in this transaction.'}</p></div><span className="flow-arrow" aria-hidden="true">→</span><div><p className="eyebrow muted">CURRENT STATE</p><h3 className={`state state-${s.status.toLowerCase()}`}>{stateLabel(finding)}</h3><p className="supporting">{currentValue(finding)}</p></div></div>
    <div className="finding-identities"><span>Contract <Identity value={f.contract} label={`permission ${index + 1} contract`} /></span><span>Owner <Identity value={f.owner} label={`permission ${index + 1} owner`} /></span></div>
    <div className="interpretation"><span className="eyebrow">INTERPRETATION</span><p>{s.reason}</p></div>
    <details><summary>Evidence & details <span className="muted">Receipt log {f.logIndex}</span></summary><div className="evidence-grid"><section><h4 className="eyebrow">BLOCKCHAIN EVIDENCE</h4><dl>
      <Field label="Source">RECEIPT_LOG · block <code>{f.blockNumber}</code></Field>
      <Field label="Contract"><code className="full-value">{f.contract}</code></Field><Field label="Owner"><code className="full-value">{f.owner}</code></Field>
      <Field label={f.kind === 'ERC20_ALLOWANCE' ? 'Spender' : f.kind === 'ERC721_TOKEN_APPROVAL' ? 'Approved address' : 'Operator'}><Identity value={delegate} label={`permission ${index + 1} delegate`} /><code className="full-value">{delegate}</code></Field>
      {f.kind === 'ERC20_ALLOWANCE' && <Field label="Event allowance (raw units)"><code className="full-value">{f.amount}</code></Field>}
      {f.kind === 'ERC721_TOKEN_APPROVAL' && <Field label="Token ID"><code className="full-value">{f.tokenId}</code></Field>}
      {f.kind === 'OPERATOR_APPROVAL' && <Field label="Event approved"><code>{String(f.approved)}</code></Field>}
      <Field label="Recorded effect"><code>{finding.transactionEffect}</code></Field>
    </dl></section><section><h4 className="eyebrow">CURRENT STATE</h4><dl><Field label="Verification status">{s.status}</Field>
      {s.status !== 'UNKNOWN' && <>{s.allowance !== undefined && <Field label="allowance (raw units)"><code className="full-value">{s.allowance}</code></Field>}{s.approvedAddress !== undefined && <Field label="getApproved"><code className="full-value">{s.approvedAddress}</code></Field>}{s.currentOwner !== undefined && <Field label="ownerOf"><code className="full-value">{s.currentOwner}</code></Field>}{s.operatorApproved !== undefined && <Field label="isApprovedForAll"><code>{String(s.operatorApproved)}</code></Field>}</>}
      <Field label="Deterministic reason">{s.reason}</Field></dl><p className="detail-note">Compared at the report’s current-state block. Intervening revocations or grants are not reconstructed.</p></section></div></details>
  </article>;
}

export function Report({ report }: { report: InspectionReport }) {
  const t = report.transaction, r = report.residualAuthority, b = r.blastRadius;
  return <div className="report"><section className="transaction-summary" aria-labelledby="transaction-title"><div className="section-heading"><h2 id="transaction-title">Transaction summary</h2><span className={`receipt-status ${t.status === 'reverted' ? 'reverted' : ''}`}>{t.status === 'reverted' ? 'REVERTED' : 'CONFIRMED'}</span></div>
    <dl className="summary-grid"><Field label="Ethereum transaction"><Identity value={t.transactionHash} label="transaction hash" /></Field><Field label="Receipt block"><code>{t.blockNumber}</code></Field><Field label="From"><Identity value={t.from} label="sender address" /></Field><Field label="To">{t.to ? <Identity value={t.to} label="recipient address" /> : 'Contract creation'}</Field></dl>
    <details className="transaction-detail"><summary>Transaction evidence</summary><dl><Field label="Transaction hash"><code className="full-value">{t.transactionHash}</code></Field><Field label="Block hash"><code className="full-value">{t.blockHash}</code></Field><Field label="From"><code className="full-value">{t.from}</code></Field><Field label="To"><code className="full-value">{t.to ?? 'Contract creation'}</code></Field><Field label="Chain ID">{t.chainId} · Ethereum mainnet</Field></dl></details></section>
    <section className={`verdict verdict-${b.verifiedRisk.toLowerCase()}`} aria-labelledby="verdict-title"><div><h2 id="verdict-title" className="eyebrow">BLAST RADIUS</h2><p className="verdict-value">{b.verifiedRisk}</p><span className="eyebrow">VERIFIED PERMISSIONS</span></div><div className="verdict-explanation"><p>{b.reason}</p><strong className={b.verification === 'INCOMPLETE' || r.snapshotError ? 'uncertainty' : ''}>{b.verification === 'INCOMPLETE' ? `INCOMPLETE VERIFICATION · ${b.unknownCount} UNKNOWN` : r.snapshotError ? 'CURRENT SNAPSHOT UNAVAILABLE' : 'VERIFICATION COMPLETE'}</strong><p className="supporting">Current-state block: <code>{r.blockNumber ?? 'UNKNOWN'}</code>. This verdict applies only to supported permissions observed in this transaction.</p></div></section>
    {r.snapshotError && <div className="notice warning"><strong>Current state could not be fully verified.</strong><p>{r.snapshotError}</p></div>}
    <section aria-labelledby="permissions-title"><div className="section-heading permissions-heading"><h2 id="permissions-title">Persistent permissions</h2><span className="muted">{r.findings.length} {r.findings.length === 1 ? 'finding' : 'findings'}</span></div>
      {t.status === 'reverted' ? <div className="empty-result"><h3>Transaction reverted</h3><p>No permission changes from this reverted transaction were applied. This does not assess authority from other transactions.</p></div> : r.findings.length === 0 ? <div className="empty-result"><h3>No supported persistent permissions found</h3><p>No supported approval findings were decoded from this receipt. Other transaction effects and existing wallet permissions are outside this analysis.</p></div> : r.findings.map((finding, index) => <Finding key={`${finding.transactionFinding.logIndex}-${index}`} finding={finding} index={index} />)}
    </section>{(t.malformedLogs.length > 0 || t.ignoredLogCount > 0) && <details className="receipt-notes"><summary>Receipt coverage <span className="muted">{t.ignoredLogCount} ignored · {t.malformedLogs.length} malformed</span></summary><p>Unrelated logs are ignored. Malformed approval logs are excluded from the findings and verdict.</p>{t.malformedLogs.map((log, i) => <p key={i}><code>LOG {log.logIndex}</code> — {log.reason}</p>)}</details>}
  </div>;
}

