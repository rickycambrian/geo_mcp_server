/**
 * Transaction executor that supports both PRIVATE_KEY and APPROVAL wallet modes.
 *
 * In PRIVATE_KEY mode, transactions are sent immediately via the smart account client.
 * In APPROVAL mode, transactions are returned as unsigned pending items for the caller to sign.
 */
import { createPublicClient, http } from 'viem';
import { TESTNET_RPC_URL, IdUtils } from '@geoprotocol/geo-sdk';
// Shared public client for receipt waiting and contract reads
export const publicClient = createPublicClient({ transport: http(TESTNET_RPC_URL) });
/**
 * Execute or queue a transaction depending on the session's wallet mode.
 *
 * - PRIVATE_KEY mode: sends via smartAccountClient, waits for receipt, returns txHash.
 * - APPROVAL mode: creates a PendingTransaction, stores it in session, returns it.
 */
export async function executeTransaction(session, request) {
    if (session.walletMode === 'APPROVAL') {
        const id = IdUtils.generate();
        const pendingTx = {
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
//# sourceMappingURL=tx-executor.js.map