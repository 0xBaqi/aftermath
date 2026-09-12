import type { analyzeTransactionWithResidualAuthority } from '../analysis/residual';

// Exact decimal strings preserve bigint evidence across the JSON boundary.
export type JsonValue<T> = T extends bigint ? string : T extends readonly (infer U)[] ? JsonValue<U>[] : T extends object ? { [K in keyof T]: JsonValue<T[K]> } : T;
export type InspectionReport = JsonValue<Awaited<ReturnType<typeof analyzeTransactionWithResidualAuthority>>>;
export type InspectionFinding = InspectionReport['residualAuthority']['findings'][number];
const MAX_UINT = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
export function effectLabel({ transactionFinding: f }: InspectionFinding) {
  if (f.change === 'REVOKE') return f.kind === 'ERC20_ALLOWANCE' ? 'ALLOWANCE SET TO ZERO' : f.kind === 'ERC721_TOKEN_APPROVAL' ? 'INDIVIDUAL APPROVAL CLEARED' : 'OPERATOR APPROVAL REVOKED';
  if (f.kind === 'ERC20_ALLOWANCE') return f.amount === MAX_UINT ? 'UNLIMITED ERC-20 APPROVAL' : 'FINITE ERC-20 APPROVAL';
  return f.kind === 'ERC721_TOKEN_APPROVAL' ? 'INDIVIDUAL NFT APPROVAL' : 'OPERATOR APPROVAL';
}
export function stateLabel({ transactionFinding: f, currentState: s }: InspectionFinding) {
  if (s.status === 'UNKNOWN') return 'UNKNOWN';
  if (s.status === 'INACTIVE') return f.change === 'REVOKE' ? 'INACTIVE NOW' : f.kind === 'OPERATOR_APPROVAL' ? 'REVOKED SINCE' : 'NO LONGER ACTIVE';
  if (f.change === 'REVOKE') return 'ACTIVE NOW';
  if (f.kind === 'ERC20_ALLOWANCE' && s.allowance !== f.amount) return 'ACTIVE · AMOUNT CHANGED';
  return 'ACTIVE NOW';
}
export function currentValue({ currentState: s }: InspectionFinding) {
  if (s.status === 'UNKNOWN') return 'Could not verify current authority.';
  if (s.allowance !== undefined) return s.allowance === MAX_UINT ? 'Unlimited allowance (maxUint256)' : `${s.allowance} raw units`;
  if (s.operatorApproved !== undefined) return `isApprovedForAll = ${s.operatorApproved}`;
  return s.status === 'ACTIVE' ? 'Recorded owner and delegate match.' : 'Recorded approval or ownership changed.';
}
