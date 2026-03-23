/**
 * Transaction executor that supports both PRIVATE_KEY and APPROVAL wallet modes.
 *
 * In PRIVATE_KEY mode, transactions are sent immediately via the smart account client.
 * In APPROVAL mode, transactions are returned as unsigned pending items for the caller to sign.
 */
import { createPublicClient, http } from 'viem';
import { TESTNET_RPC_URL, IdUtils } from '@geoprotocol/geo-sdk';
import type { EditSession } from '../state/session.js';

// Shared public client for receipt waiting and contract reads
export const publicClient = createPublicClient({ transport: http(TESTNET_RPC_URL) });

export interface PendingTransaction {
  id: string;           // dashless UUID
  to: `0x${string}`;
  data: `0x${string}`;
  value?: string;       // bigint as string for JSON safety
  description: string;  // Human-readable: "Publish edit to personal space"
  toolName: string;     // Which tool generated this
  metadata?: Record<string, unknown>; // editId, cid, proposalId, etc.
}

export interface TxRequest {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
  description: string;
  toolName: string;
  metadata?: Record<string, unknown>;
}

export interface TxResult {
  mode: 'executed' | 'pending_approval';
  txHash?: string;
  pendingTx?: PendingTransaction;
}

export type ContinuationType = 'auto_vote' | 'auto_execute' | 'done';

export interface TransactionContinuation {
  pendingTxId: string;
  onComplete: ContinuationType;
  context: Record<string, unknown>; // callerSpaceId, daoSpaceId, proposalId, etc.
}

/**
 * Execute or queue a transaction depending on the session's wallet mode.
 *
 * - PRIVATE_KEY mode: sends via smartAccountClient, waits for receipt, returns txHash.
 * - APPROVAL mode: creates a PendingTransaction, stores it in session, returns it.
 */
export async function executeTransaction(
  session: EditSession,
  request: TxRequest,
): Promise<TxResult> {
  if (session.walletMode === 'APPROVAL') {
    const id = IdUtils.generate();
    const pendingTx: PendingTransaction = {
      id,
      to: request.to,
      data: request.data,
      ...(request.value !== undefined ? { value: request.value.toString() } : {}),
      description: request.description,
      toolName: request.toolName,
      metadata: request.metadata,
    };
    session.addPendingTransaction(pendingTx);
    return { mode: 'pending_approval', pendingTx };
  }

  // PRIVATE_KEY mode — send immediately
  const client = session.smartAccountClient;
  if (!client) {
    throw new Error('Smart account client not available. Call configure_wallet first.');
  }

  const txHash = await client.sendTransaction({
    to: request.to,
    data: request.data,
    ...(request.value !== undefined ? { value: request.value } : {}),
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  return { mode: 'executed', txHash };
}
