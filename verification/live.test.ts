import { expect, it } from 'vitest';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { mainnet } from 'viem/chains';
import { writeFileSync } from 'node:fs';
import { analyzeTransactionWithResidualAuthority } from '../src/analysis/residual';

// Opt-in only: never make deterministic tests depend on network availability.
it.skipIf(!process.env.ETHEREUM_RPC_URL)('verifies real Ethereum approval transactions', async () => {
  const client = createPublicClient({ chain: mainnet, transport: http(process.env.ETHEREUM_RPC_URL, { timeout: 20_000, retryCount: 0 }) });
  const head = await client.getBlockNumber({ cacheTime: 0 });
  const logs = await client.getLogs({
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    event: parseAbiItem('event Approval(address indexed owner, address indexed spender, uint256 value)'),
    fromBlock: head - 30n, toBlock: head,
  });
  const hashes = [...new Set(logs.map(log => log.transactionHash).filter(hash => hash !== null))].slice(-2);
  expect(hashes.length).toBeGreaterThan(0);
  const records = [];
  for (const hash of hashes) {
    const report = await analyzeTransactionWithResidualAuthority(hash, client);
    const supported = report.residualAuthority.findings.filter(f => f.transactionFinding.kind === 'ERC20_ALLOWANCE');
    expect(supported.length).toBeGreaterThan(0);
    expect(supported.every(f => f.currentState.status !== 'UNKNOWN')).toBe(true);
    records.push({ transactionHash: hash, receiptBlock: report.transaction.blockNumber,
      stateBlock: report.residualAuthority.blockNumber, findings: report.residualAuthority.findings,
      blastRadius: report.residualAuthority.blastRadius });
  }
  const json = JSON.stringify(records, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2);
  console.log(json);
  if (process.env.LIVE_REPORT_PATH) writeFileSync(process.env.LIVE_REPORT_PATH, json + '\n');
}, 120_000);
