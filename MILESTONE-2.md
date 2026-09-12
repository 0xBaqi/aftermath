# Milestone 2 delivery record

## Outcome and scope
Completed the Residual Authority Engine in the existing project at:
`C:/Users/NURUDEEN/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an-2/outputs/transaction-blast-radius`

Preserved the original receipt-only API and all 50 Milestone 1 tests. No UI work or Milestone 3 work, dependencies, wallet connection, transaction submission, pricing, reputation, AI, Permit2, multichain, database, or arbitrary authorization was added.

## Exact authored project files changed
- Modified `src/analysis/analyze.ts`: removed the restrictive factory return annotation so the existing viem client exposes its current-state call methods. Runtime behavior remains unchanged.
- Added `src/analysis/residual.ts`: injectable current-state engine, canonical ABI checks, snapshot metadata, transaction-effect/current-state separation, deterministic risk and aggregate uncertainty, and combined analysis entry point.
- Added `tests/residual.test.ts`: 42 deterministic tests covering successful/failed reads, later revocation/regrant, finite/max allowance, changed NFT approvals and ownership, operator standards, malformed returns, wrong-chain/stale snapshot failures, aggregate risk, and integration.
- Added `verification/live.test.ts`: opt-in real Ethereum smoke check with optional JSON evidence output via LIVE_REPORT_PATH.
- Modified `README.md`: Milestone 2 usage, result interpretation, live verification and limitations.
- Added `MILESTONE-2.md`: this delivery record.

Milestone 1 source decoder/types, its tests/fixtures and report, application UI, package files and dependency versions remain unchanged. Build output and TypeScript caches are generated/ignored files. The repository already contained untracked Milestone 1 files and no baseline commit; no commit, remote, deployment or submission was created.

## API and interpretation
Use `analyzeTransactionWithResidualAuthority(hash, optionalClient)` from `src/analysis/residual.ts`. It returns `transaction` (unchanged M1 evidence) and `residualAuthority` (current checks). Standalone `evaluateResidualAuthority(findings, client)` and `aggregateBlastRadius(findings)` are also exported.

- Effects: GRANTED_OR_UPDATED or REVOKED. A log cannot distinguish first grant from update; no historical value is invented.
- Status: ACTIVE, INACTIVE or UNKNOWN. Unknown has null risk and an explicit safe reason.
- ERC20 allowance: zero LOW; finite non-zero MEDIUM; exactly maxUint256 HIGH.
- Individual ERC721: getApproved and ownerOf must match the original non-zero delegate and owner for ACTIVE/MEDIUM; otherwise INACTIVE/LOW. Failed calls (including burned tokens) remain UNKNOWN.
- ERC721/ERC1155 operators: isApprovedForAll true gives ACTIVE/HIGH; false gives INACTIVE/LOW. Unknown operator standard is not guessed.
- Aggregate verifiedRisk is the maximum of verified active supported permissions, default LOW. verification=INCOMPLETE and unknownCount explicitly qualify unresolved state; LOW with uncertainty is not an all-clear.
- All state reads use the same freshly captured mainnet block number per evaluation. A current block older than receipt evidence is rejected.

## Baseline and final verification
- Before implementation: 50/50 tests passed, TypeScript passed, production build passed.
- Final deterministic suite: 92 passed (50 original + 42 new), 1 optional live test skipped without configuration.
- Final TypeScript: passed.
- Production build: passed, Next.js Webpack with the established WASM fallback; static / and /_not-found routes generated. Existing missing-native-SWC warnings remain non-fatal.
- Configured live suite: 1 test passed, exercising two real transactions. The live test was rerun successfully to save detailed evidence.

## Live Ethereum evidence
Endpoint: https://ethereum-rpc.publicnode.com (public, no credentials).
Saved verification run: 2026-09-11 approximately 18:38 UTC.
Receipt and state block for both transactions: 25956004.

1. `0x056e04a2f2918320a0ac26d877a54172c430f896c95b1810bde111a1de6efae7`
   - USDC event allowance: 500000000 raw units.
   - Current allowance: 0; INACTIVE/LOW; aggregate LOW, COMPLETE.
2. `0x7ca7fddf3eb1ac6cf3663d78526b2a0cf475b641073801a8f093d52fd61dcaf7`
   - First USDC finding: event 762075244296, current 762075244295; ACTIVE/MEDIUM.
   - Second finding: event 1, current 0; INACTIVE/LOW.
   - Aggregate MEDIUM, COMPLETE.

Full owner/contract/spender identities and results are saved in `milestone-2-live-verification.json` in the current task outputs. This smoke check verifies real ERC20 receipt and current-state integration. NFT/operator paths and failure conditions are covered deterministically, not claimed as live-tested. Current state is block-relative and may subsequently change.

## Limitations and blockers
No unresolved milestone blocker and no missing required live-RPC check. This is an authority assessment of supported permissions observed in the selected transaction, not a complete wallet inventory or proof that arbitrary contracts honestly implement standards. Historical ERC165 availability can still produce UNKNOWN. Number-pinned reads do not provide reorganization/finality guarantees. RPC call reasons avoid echoing provider errors that may contain credentials. Bigints require decimal-string serialization for JSON.

## Time ledger
Milestone 1: conservatively charged 35 minutes.
Milestone 2: began approximately 17:56 UTC on 2026-09-11; reserve/charge 50 minutes conservatively, including inspection, baseline, implementation, verification and reporting.
Total charged: 1 hour 25 minutes. Remaining hard 10-hour budget: at most 8 hours 35 minutes, minus any earlier work outside these sessions.
Stop at Milestone 2. No Milestone 3 UI started.

