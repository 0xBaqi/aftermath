'use client';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { InspectionReport } from '../src/ui/report';
import { Report } from '../src/ui/inspection';

export default function Home() {
  const [hash, setHash] = useState(''), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null), [report, setReport] = useState<InspectionReport | null>(null);
  const busy = useRef(false), results = useRef<HTMLDivElement>(null);
  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current) return;
    const value = hash.trim(); setReport(null); setError(null);
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) { setError('Enter a transaction hash: 0x followed by exactly 64 hexadecimal characters.'); return; }
    busy.current = true; setLoading(true);
    try {
      const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash: value }), cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) { setError(data.error?.message ?? 'Analysis is unavailable. Please retry.'); return; }
      setReport(data); requestAnimationFrame(() => results.current?.focus());
    } catch { setError('Could not reach the analysis service. Check your connection and retry.'); }
    finally { busy.current = false; setLoading(false); }
  }
  return <main><header className="masthead"><div className="brand"><span className="brand-mark" aria-hidden="true">↳</span><h1>AFTERMATH</h1></div><span className="network"><span aria-hidden="true">●</span> ETHEREUM MAINNET</span></header><p className="tagline">Your transaction ended. Its permissions didn’t.</p>
    <section className="analyzer" aria-labelledby="inspect-title"><div className="section-heading"><h2 id="inspect-title">Inspect a transaction</h2><span className="eyebrow muted">PERSISTENT AUTHORITY</span></div><form onSubmit={analyze} noValidate><label htmlFor="transaction-hash">Ethereum transaction hash</label><div className="input-row"><input id="transaction-hash" name="hash" value={hash} onChange={e => setHash(e.target.value)} placeholder="0x…" autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={loading} aria-invalid={Boolean(error?.startsWith('Enter a transaction hash'))} aria-describedby={error ? 'analysis-error' : 'hash-help'} /><button className="analyze-button" type="submit" disabled={loading}>{loading ? 'Analyzing…' : 'Analyze'}<span aria-hidden="true">{loading ? '◌' : '→'}</span></button></div><p id="hash-help" className="input-help">Mined transactions only. Receipt evidence compared with a current Ethereum state snapshot.</p></form>{error && <div id="analysis-error" className="notice error" role="alert"><strong>Analysis unavailable</strong><p>{error}</p></div>}</section>
    <div role="status" className={loading ? 'loading-state' : 'sr-only'}>{loading ? 'Reading transaction evidence and checking current permissions…' : report ? `Analysis complete. Blast Radius ${report.residualAuthority.blastRadius.verifiedRisk}. ${report.residualAuthority.blastRadius.unknownCount} unknown findings.` : ''}</div>
    <div ref={results} tabIndex={-1} aria-label="Inspection results" aria-busy={loading}>{report && <Report key={report.transaction.transactionHash} report={report} />}</div>
    {!report && !loading && <div className="idle-guide"><span className="eyebrow">TRANSACTION EFFECT</span><span className="guide-arrow" aria-hidden="true">→</span><span className="eyebrow">CURRENT STATE</span><p>Inspect the authority a transaction left behind.</p></div>}
    <footer className="scope"><h2 className="eyebrow">SUPPORTED ANALYSIS / LIMITATIONS</h2><p>ERC-20 allowances · ERC-721 individual approvals · ERC-721 / ERC-1155 operator approvals</p><p className="muted">Only supported approval logs in this transaction are assessed—not a complete wallet inventory. Unknown standards and failed reads remain UNKNOWN. Amounts are raw units; token names and decimals are not verified. State may change after the snapshot, and arbitrary contracts may not implement standards honestly. No finality guarantee.</p></footer>
  </main>;
}
