import { AnalysisStageError } from '../../../src/analysis/analyze';
import { analyzeTransactionWithResidualAuthority as analyzeResidual } from '../../../src/analysis/residual';
import { validateTransactionHash } from '../../../src/analysis/decode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
const failure = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status, headers });

const stageMessage = {
  CHAIN_CHECK: 'Could not verify the Ethereum mainnet RPC.',
  TRANSACTION_FETCH: 'Ethereum transaction lookup failed.',
  RECEIPT_FETCH: 'Ethereum transaction receipt lookup failed.',
  LOG_PROCESSING: 'The receipt was retrieved, but permission-log processing failed.',
} as const;

export async function POST(request: Request) {
  let hash: string;
  try { const body = await request.json(); hash = validateTransactionHash(body?.hash); }
  catch { return failure(400, 'INVALID_HASH', 'Enter a transaction hash: 0x followed by exactly 64 hexadecimal characters.'); }
  if (!process.env.ETHEREUM_RPC_URL) return failure(503, 'RPC_NOT_CONFIGURED', 'Ethereum RPC is not configured on this server. Analysis is unavailable.');
  try {
    const report = await analyzeResidual(hash);
    return new Response(JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString() : value), { headers: { ...headers, 'Content-Type': 'application/json' } });
  } catch (error) {
    if (error instanceof AnalysisStageError) return failure(502, error.stage, stageMessage[error.stage]);
    const message = error instanceof Error ? error.message : '';
    if (message === 'Transaction is pending; a mined receipt is required.') return failure(409, 'PENDING_TRANSACTION', message);
    if (message === 'Only Ethereum mainnet (chain ID 1) is supported.') return failure(503, 'WRONG_CHAIN', 'The server RPC must use Ethereum mainnet.');
    if (message === 'Transaction and receipt do not match; retry after chain reorganization or RPC inconsistency.') return failure(502, 'INCONSISTENT_RECEIPT', message);
    return failure(502, 'ANALYSIS_FAILURE', 'The transaction could not be analyzed. Retry once; if it persists, the analyzer needs inspection.');
  }
}
