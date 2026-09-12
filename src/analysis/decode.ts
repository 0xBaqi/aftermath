import { getAddress, keccak256, stringToHex, zeroAddress } from 'viem';
import type { Address, Hash, Hex } from 'viem';
import type { DecodeResult, FindingContext, ReceiptLog } from './types';

export const APPROVAL_TOPIC = keccak256(stringToHex('Approval(address,address,uint256)'));
export const APPROVAL_FOR_ALL_TOPIC = keccak256(stringToHex('ApprovalForAll(address,address,bool)'));
const word = /^0x[0-9a-fA-F]{64}(?![\s\S])/;
const addressWord = /^0x0{24}[0-9a-fA-F]{40}(?![\s\S])/;

export function validateTransactionHash(input: unknown): Hash {
  if (typeof input !== 'string' || input.length !== 66 || !/^0x[0-9a-fA-F]{64}(?![\s\S])/.test(input)) {
    throw new Error('Transaction hash must be 0x followed by exactly 64 hexadecimal characters.');
  }
  return input.toLowerCase() as Hash;
}

function address(topic: Hex): Address {
  if (!addressWord.test(topic)) throw new Error('Non-canonical indexed address');
  return getAddress(`0x${topic.slice(-40)}`);
}

export function decodePermissionLog(log: ReceiptLog, context: FindingContext): DecodeResult {
  const signature = log.topics[0]?.toLowerCase();
  if (signature !== APPROVAL_TOPIC && signature !== APPROVAL_FOR_ALL_TOPIC) return { type: 'ignored' };
  try {
    if (!Number.isSafeInteger(log.logIndex) || log.logIndex < 0) throw new Error('Invalid log index');
    if (!/^0x[0-9a-fA-F]{40}(?![\s\S])/.test(log.address)) throw new Error('Invalid emitting contract');
    if (log.topics.length !== 3 && log.topics.length !== 4) throw new Error('Invalid topic count');
    const base = {
      ...context, chainId: 1 as const, logIndex: log.logIndex,
      contract: getAddress(log.address), owner: address(log.topics[1]),
      evidence: 'RECEIPT_LOG' as const, currentAuthority: 'NOT_CHECKED' as const,
    };
    const delegate = address(log.topics[2]);
    if (signature === APPROVAL_TOPIC) {
      if (log.topics.length === 3 && word.test(log.data)) {
        const amount = BigInt(log.data);
        return { type: 'finding', finding: { ...base, kind: 'ERC20_ALLOWANCE', standard: 'ERC20', spender: delegate, amount, change: amount === 0n ? 'REVOKE' : 'SET' } };
      }
      if (log.topics.length === 4 && word.test(log.topics[3]) && log.data === '0x') {
        return { type: 'finding', finding: { ...base, kind: 'ERC721_TOKEN_APPROVAL', standard: 'ERC721', approved: delegate, tokenId: BigInt(log.topics[3]), change: delegate === zeroAddress ? 'REVOKE' : 'SET' } };
      }
      throw new Error('Approval does not match standard ERC20 or ERC721 log structure');
    }
    if (log.topics.length !== 3 || !word.test(log.data) || (BigInt(log.data) !== 0n && BigInt(log.data) !== 1n)) {
      throw new Error('ApprovalForAll requires three topics and one canonical boolean word');
    }
    const approved = BigInt(log.data) === 1n;
    return { type: 'finding', finding: { ...base, kind: 'OPERATOR_APPROVAL', standard: 'UNKNOWN', operator: delegate, approved, change: approved ? 'SET' : 'REVOKE' } };
  } catch (error) {
    return { type: 'malformed', logIndex: log.logIndex, reason: error instanceof Error ? error.message : 'Malformed approval log' };
  }
}


