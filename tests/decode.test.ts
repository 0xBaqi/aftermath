import { describe, expect, it } from 'vitest';
import { maxUint256, padHex, zeroAddress } from 'viem';
import { decodePermissionLog, validateTransactionHash } from '../src/analysis/decode';
import { context, delegate, erc20, erc721, hash, operator, uint } from './fixtures';

describe('transaction hash validation', () => {
  it('accepts and normalizes a full hash', () => expect(validateTransactionHash(hash.toUpperCase().replace('0X', '0x'))).toBe(hash));
  it.each([null, undefined, 123, '', '0x', 'ab'.repeat(32), `0x${'g'.repeat(64)}`, `${hash}00`, hash.slice(0, -1), ` ${hash}`, `${hash}\n`])('rejects invalid input %s', value => expect(() => validateTransactionHash(value)).toThrow());
});

describe('standard receipt decoding', () => {
  it.each([0n, 42n, maxUint256])('preserves ERC20 amount %s exactly', amount => {
    expect(decodePermissionLog(erc20(amount), context)).toMatchObject({ type: 'finding', finding: { kind: 'ERC20_ALLOWANCE', amount, spender: delegate, change: amount === 0n ? 'REVOKE' : 'SET', currentAuthority: 'NOT_CHECKED' } });
  });
  it.each([0n, 42n, maxUint256])('distinguishes indexed ERC721 token ID %s', tokenId => {
    expect(decodePermissionLog(erc721(tokenId), context)).toMatchObject({ type: 'finding', finding: { kind: 'ERC721_TOKEN_APPROVAL', tokenId, approved: delegate, change: 'SET' } });
  });
  it('recognizes zero-address NFT approval clearing', () => {
    const log = erc721();
    log.topics = [log.topics[0], log.topics[1], padHex(zeroAddress), log.topics[3]];
    expect(decodePermissionLog(log, context)).toMatchObject({ type: 'finding', finding: { change: 'REVOKE' } });
  });
  it.each([true, false])('decodes operator approval %s without guessing a standard', approved => {
    expect(decodePermissionLog(operator(approved), context)).toMatchObject({ type: 'finding', finding: { kind: 'OPERATOR_APPROVAL', standard: 'UNKNOWN', approved, change: approved ? 'SET' : 'REVOKE' } });
  });
  it('ignores unrelated and empty topics', () => {
    expect(decodePermissionLog({ ...erc20(), topics: [] }, context)).toEqual({ type: 'ignored' });
    expect(decodePermissionLog({ ...erc20(), topics: [uint(123n)] }, context)).toEqual({ type: 'ignored' });
  });
  it.each([
    { ...erc20(), topics: erc20().topics.slice(0, 2) },
    { ...erc20(), data: '0x' },
    { ...erc20(), data: `${uint(1n)}00` },
    { ...erc20(), data: '0xzz' },
    { ...erc721(), data: uint(1n) },
    { ...erc721(), topics: [...erc721().topics, uint(0n)] },
    { ...erc721(), topics: [...erc20().topics, '0x01'] },
    { ...erc20(), topics: [erc20().topics[0], uint(maxUint256), erc20().topics[2]] },
    { ...operator(), data: uint(2n) },
    { ...operator(), topics: [...operator().topics, uint(1n)] },
    { ...erc20(), address: '0x123' },
    { ...erc20(), logIndex: -1 },
  ])('reports malformed approval %#', log => {
    expect(decodePermissionLog(log as ReturnType<typeof erc20>, context).type).toBe('malformed');
  });
});
