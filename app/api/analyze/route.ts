import { analyzeTransactionWithResidualAuthority } from '../../../src/analysis/residual';
import { validateTransactionHash } from '../../../src/analysis/decode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
const failure = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status, headers });
export async function POST(request: Request) {
  let hash: string;
  try { const body = await request.json(); hash = validateTransactionHash(body?.hash); }
  catch { return failure(400, 'INVALID_HASH', 'Enter a transaction hash: 0x followed by exactly 64 hexadecimal characters.'); }
  if (!process.env.ETHEREUM_RPC_URL) return failure(503, 'RPC_NOT_CONFIGURED', 'Ethereum RPC is not configured on this server. Analysis is unavailable.');
  try {
    const report = await analyzeTransactionWithResidualAuthority(hash);
    return new Response(JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString() : value), { headers: { ...headers, 'Content-Type': 'application/json' } });
  } catch (error) {
    // Provider errors can contain credentials. Only known engine messages may cross this boundary.
    const message = error instanceof Error ? error.message : '';
    if (message === 'Transaction is pending; a mined receipt is required.') return failure(409, 'PENDING_TRANSACTION', message);
    if (message === 'Only Ethereum mainnet (chain ID 1) is supported.') return failure(503, 'WRONG_CHAIN', 'The server RPC must use Ethereum mainnet.');
    if (message === 'Transaction and receipt do not match; retry after chain reorganization or RPC inconsistency.') return failure(502, 'INCONSISTENT_RECEIPT', message);
    return failure(502, 'RPC_FAILURE', 'Could not retrieve the Ethereum transaction and receipt. Check that the hash is mined on mainnet, then retry.');
  }
}
