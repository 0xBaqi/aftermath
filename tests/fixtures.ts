import { padHex, toHex } from 'viem';
import type { Address, Hash, Hex } from 'viem';
import type { ReceiptLog } from '../src/analysis/types';
// Fixed standard signature hashes, independent of the production signature calculation.
export const approval = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925' as Hex;
export const forAll = '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31' as Hex;
export const owner = '0x1111111111111111111111111111111111111111' as Address;
export const delegate = '0x2222222222222222222222222222222222222222' as Address;
export const contract = '0x3333333333333333333333333333333333333333' as Address;
export const hash = `0x${'ab'.repeat(32)}` as Hash;
export const blockHash = `0x${'cd'.repeat(32)}` as Hash;
export const context = { transactionHash: hash, blockNumber: 123n };
export const uint = (value: bigint) => toHex(value, { size: 32 });
export function erc20(value = 42n): ReceiptLog {
  return { address: contract, topics: [approval, padHex(owner), padHex(delegate)], data: uint(value), logIndex: 0 };
}
export function erc721(tokenId = 42n): ReceiptLog {
  return { ...erc20(), topics: [...erc20().topics, uint(tokenId)], data: '0x' };
}
export function operator(approved = true): ReceiptLog {
  return { ...erc20(), topics: [forAll, padHex(owner), padHex(delegate)], data: uint(approved ? 1n : 0n) };
}
