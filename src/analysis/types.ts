import type { Address, Hash, Hex } from 'viem';

export type ReceiptLog = {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  logIndex: number;
};

type FindingBase = {
  chainId: 1;
  transactionHash: Hash;
  blockNumber: bigint;
  logIndex: number;
  contract: Address;
  owner: Address;
  evidence: 'RECEIPT_LOG';
  currentAuthority: 'NOT_CHECKED';
};

export type PermissionFinding = FindingBase & (
  | { kind: 'ERC20_ALLOWANCE'; standard: 'ERC20'; spender: Address; amount: bigint; change: 'SET' | 'REVOKE' }
  | { kind: 'ERC721_TOKEN_APPROVAL'; standard: 'ERC721'; approved: Address; tokenId: bigint; change: 'SET' | 'REVOKE' }
  | { kind: 'OPERATOR_APPROVAL'; standard: 'ERC721' | 'ERC1155' | 'UNKNOWN'; operator: Address; approved: boolean; change: 'SET' | 'REVOKE' }
);

export type FindingContext = Pick<FindingBase, 'transactionHash' | 'blockNumber'>;
export type DecodeResult =
  | { type: 'finding'; finding: PermissionFinding }
  | { type: 'ignored' }
  | { type: 'malformed'; logIndex: number; reason: string };
