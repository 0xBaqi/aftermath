# Transaction Blast Radius — Milestones 1 and 2

Minimal Next.js + TypeScript + viem project. Ethereum mainnet only.

## Run

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run dev
```

Copy `.env.example` to `.env.local` and provide an Ethereum mainnet HTTP RPC URL when integrating the engine in a server-side Next.js handler. Tests and the production build require no RPC credentials. Standalone callers must load their own environment variables or pass `createEthereumClient(url)` explicitly.

```ts
import { analyzeTransaction, createEthereumClient } from './src/analysis/analyze';
const report = await analyzeTransaction(hash, createEthereumClient(rpcUrl));
```

There is only a placeholder home page. No API endpoint or analysis UI is added in this milestone.

## Implemented

- Strict 32-byte transaction hash validation, with lowercase normalization. Whitespace is rejected.
- Mainnet chain-ID verification, `getTransaction`, `getTransactionReceipt`, pending detection, and transaction/receipt consistency checks. Lookup/RPC errors propagate to callers. Reverted transactions return no findings.
- Deterministic receipt-log parsing: ERC20 Approval has three topics plus one uint256 data word; ERC721 Approval has four topics and empty data. ApprovalForAll has three topics and one canonical bool data word.
- Canonical address padding, lengths, topic counts, and bool values are validated. Unrelated logs are ignored; malformed approval logs produce diagnostics without discarding other findings.
- ERC165 probes at the receipt block with a 30,000 gas limit, including the ERC165 and invalid interface checks. Exactly one supported NFT interface gives ERC721 or ERC1155. Failed, unsupported, or dual-interface results remain UNKNOWN. Results are cached per emitting contract within one analysis.
- Typed discriminated PermissionFinding union with event provenance, owner, emitting contract, delegate, amount/token ID/boolean and SET/REVOKE semantics. uint256 values remain bigint without precision loss. Findings retain individual events in log order, including repeated changes.

## Interpretation and limits

These are event observations, not proof of current authority or of a contract's honest standard implementation. ERC20/ERC721 labels for Approval refer to standard log structure. An arbitrary contract can emit matching events or misreport ERC165 support. Findings are not filtered to transaction.from: smart accounts and internal calls can emit approvals for other owners.

The original `analyzeTransaction` API remains receipt-only: its `currentAuthority` stays NOT_CHECKED. Use the combined API below for verified residual authority. Historical ERC165 queries may require an archive-capable RPC and describe end-of-block state, not the exact transaction execution instant. Block evidence consistency is checked, but neither milestone provides finality guarantees.

## Milestone 2: residual authority

```ts
import { analyzeTransactionWithResidualAuthority } from './src/analysis/residual';
const report = await analyzeTransactionWithResidualAuthority(hash);
// report.transaction: unchanged Milestone 1 evidence
// report.residualAuthority: current block, per-finding state, aggregate risk
```

Alternatively call `evaluateResidualAuthority(findings, client)` with an injectable client.

- Each result separates `transactionFinding` and `transactionEffect` from `currentState`. Non-zero/true events are GRANTED_OR_UPDATED: receipt logs cannot establish whether a previous approval existed. Zero/false events are REVOKED.
- Current status is ACTIVE, INACTIVE or UNKNOWN. UNKNOWN has null risk and an explicit reason; contract reverts, RPC failures, empty/malformed ABI returns and unsupported operator standards never imply revoked authority.
- ERC20 calls allowance(owner, spender). Zero is LOW, finite non-zero is MEDIUM, and exactly maxUint256 is HIGH.
- Individual ERC721 calls getApproved(tokenId) and ownerOf(tokenId). The original non-zero approved address and owner must both still match for ACTIVE/MEDIUM. Changed/cleared approvals or changed ownership are INACTIVE/LOW. Burned/nonexistent token call failures remain UNKNOWN.
- ERC721/ERC1155 operators call isApprovedForAll(owner, operator): true is ACTIVE/HIGH; false is INACTIVE/LOW. The Milestone 1 UNKNOWN standard remains UNKNOWN.
- Reads use one freshly captured mainnet block number, recorded in the result. Raw ABI return words are validated strictly. A number-pinned snapshot is not a finality or reorganization guarantee.
- `blastRadius.verifiedRisk` is the maximum among verified active supported findings, defaulting to LOW. Always display `verification`, `unknownCount`, and the reason alongside it: INCOMPLETE/LOW does not mean all permissions are inactive. `snapshotError` separately records failure to establish current state.
- Findings describe permissions observed in this transaction, not an exhaustive wallet authorization inventory. A changed NFT delegate is shown as current evidence but is not attributed to the original permission. Repeated receipt events remain separate. Risk is authority scope, not asset value, exploit likelihood, or a safety rating.

### Optional live verification

Set ETHEREUM_RPC_URL to an Ethereum mainnet HTTP endpoint, then run:

```sh
npx vitest run verification/live.test.ts
```

The opt-in check discovers two recent USDC Approval transactions and runs the combined engine against their real receipts and current allowances. It prints transaction hashes, receipt/state blocks, findings and classifications. Without the environment variable this test is skipped; deterministic tests require no endpoint. Live NFT/operator coverage is not implied by this small ERC20 smoke check.

Report fields contain bigint; a future JSON endpoint must serialize those as decimal strings. The library accepts an injectable client for deterministic testing. No wallet connection, database, AI, multi-chain, Permit2, reputation scanning, or revocation actions.

## Standards

- https://eips.ethereum.org/EIPS/eip-20
- https://eips.ethereum.org/EIPS/eip-721
- https://eips.ethereum.org/EIPS/eip-1155
- https://eips.ethereum.org/EIPS/eip-165

## Time budget

Hard total project cap: 10 hours, including subsequent development, testing, polish, deployment, demo and submission. Milestone 1 began approximately 2026-09-11 17:21 UTC. See MILESTONE-1.md and MILESTONE-2.md for time and validation results. Prior development time was not established; do not assume it is zero if work happened elsewhere. Milestone 3 UI has not been started.

## Windows build note

The development and build scripts explicitly use Webpack. On the verification machine Next.js could load its WASM compiler, but native SWC bindings were unavailable, so Turbopack could not run. Webpack is the supported fallback. Dependency versions are pinned and package-lock.json is included. Registry access on this machine required Node's Windows system CA support (`NODE_USE_SYSTEM_CA=1`); TLS verification was not disabled.
