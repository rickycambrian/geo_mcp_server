---
name: wallet-approval-mode
description: Reference for the dual-mode wallet architecture (PRIVATE_KEY vs APPROVAL). Use when adding new write tools, modifying transaction flows, or debugging pending transaction issues in the Geo MCP server.
---

# Wallet Approval Mode

The Geo MCP server supports two wallet modes that determine how write operations handle blockchain transactions:

- **PRIVATE_KEY** (default): Server holds the private key, signs and sends transactions immediately.
- **APPROVAL**: Server returns unsigned transaction data as `{ status: 'pending_signature', ... }` for external wallet signing.

## Core Architecture

### executeTransaction() — the dual-mode abstraction

All write operations use `executeTransaction(session, request)` instead of calling `smartAccountClient.sendTransaction()` directly.

**File**: `src/utils/tx-executor.ts`

```typescript
const txResult = await executeTransaction(session, {
  to: contractAddress,
  data: calldata,
  description: 'Human-readable action description',
  toolName: 'publish_edit',
  metadata: { editId, cid },
});

if (txResult.mode === 'pending_approval') {
  return ok({ status: 'pending_signature', ...txResult.pendingTx });
}
// mode === 'executed' — continue with existing flow using txResult.txHash
```

### Session state for APPROVAL mode

**File**: `src/state/session.ts`

The `EditSession` class tracks:
- `walletMode: 'PRIVATE_KEY' | 'APPROVAL'`
- `pendingTransactions: PendingTransaction[]` — unsigned txs waiting for external signing
- `continuations: Map<string, TransactionContinuation>` — maps pendingTxId to next step

`clear()` resets pendingTransactions and continuations along with ops/artifacts.

`getStatus()` returns `mode: 'approval'` when `walletMode === 'APPROVAL' && walletAddress !== null`.

### configure_wallet extension

**File**: `src/tools/spaces.ts`

The tool accepts optional `walletAddress` and `walletMode` params:
- `walletMode='APPROVAL'` + `walletAddress` configures without private key
- Does NOT call `getSmartAccountWalletClient`
- Sets `session.walletMode` and `session.walletAddress`

### ensureWalletConfigured() early return

**File**: `src/utils/wallet.ts`

APPROVAL mode check goes BEFORE the private key cascade:
```typescript
if (session.walletMode === 'APPROVAL' && session.walletAddress) {
  return { ok: true, address: session.walletAddress as Hex };
}
```

## Multi-Transaction Continuation Chain

The most complex pattern: `propose_dao_edit` triggers a 3-tx chain (propose -> vote -> execute), split across `submit_signed_transaction` continuations.

### Flow in APPROVAL mode:

1. `propose_dao_edit` calls `executeTransaction()` for the propose tx
   - Returns `{ status: 'pending_signature', ...pendingTx }`
   - Registers continuation: `{ pendingTxId, onComplete: 'auto_vote', context: { callerSpaceId, daoSpaceId, ... } }`

2. User signs, gateway calls `submit_signed_transaction({ pendingTxId, txHash })`
   - Waits for receipt, finds continuation with `onComplete: 'auto_vote'`
   - Builds vote calldata via `buildVoteCalldata()`
   - Calls `executeTransaction()` for the vote tx
   - Returns new `{ continuation: { type: 'auto_vote', pendingTx: votePendingTx } }`
   - Registers next continuation: `{ pendingTxId: votePendingTx.id, onComplete: 'auto_execute' }`

3. User signs vote, gateway calls `submit_signed_transaction` again
   - Checks `getLatestProposalInformation()` — might be auto-executed with the vote
   - If not executed, checks `isSupportThresholdReached()`
   - If threshold met, builds execute calldata, returns another pending tx
   - If threshold not met, returns success with `executed: false`

### Key implementation details:

- Each step in the chain is a separate `submit_signed_transaction` call
- The gateway's `detectGeoTransactionRequest()` detects continuations too (the `submit_signed_transaction` tool is in the GEO_WRITE_TOOLS set)
- The `auto_execute` step reads on-chain state to decide whether to execute (proposal may auto-execute with the vote)

## Adding a New Write Tool

When adding a new tool that sends a blockchain transaction:

1. Import `executeTransaction` from `../utils/tx-executor.js`
2. Replace `smartAccountClient.sendTransaction()` with:
   ```typescript
   const txResult = await executeTransaction(session, {
     to, data, description: 'What this tx does', toolName: 'my_tool',
     metadata: { relevantIds },
   });
   ```
3. Handle the `pending_approval` branch:
   ```typescript
   if (txResult.mode === 'pending_approval') {
     return ok({ status: 'pending_signature', ...txResult.pendingTx });
   }
   ```
4. For multi-tx flows, register a continuation after the first tx:
   ```typescript
   session.addContinuation({
     pendingTxId: txResult.pendingTx!.id,
     onComplete: 'auto_vote', // or custom type
     context: { ...neededForNextStep },
   });
   ```
5. Add continuation handling in `submit_signed_transaction` if using a new `onComplete` type
6. Add the tool name to `GEO_WRITE_TOOLS` in `rickydata_SDK/packages/core/src/geo-wallet/detect.ts`

## Refactored sendTransaction sites (21 total)

- **spaces.ts** (8): setup_space, publish_edit, propose_dao_edit (+ autoVoteAndExecute split), upsert_canvas_workflow (private + public)
- **governance.ts** (5): vote_on_proposal, propose_accept_editor, propose_remove_editor, propose_accept_subspace, propose_remove_subspace
- **workspace.ts** (4): upsert_workspace_entity (private + public), delete_workspace_entity (private + public)
- **submit_signed_transaction** (4 internal): auto_vote, auto_execute fallthrough paths

## Gateway Integration

The gateway (`mcp-agent-gateway/src/chat/chat-service.ts`) detects `{ status: 'pending_signature' }` in MCP tool results and:
1. Emits `transaction_signing_request` SSE event to the frontend
2. Blocks via `approvalGate.waitForApproval(approvalId, 120_000)`
3. On approval with txHash, calls `submit_signed_transaction` on the MCP server
4. Feeds the result back into the LLM loop (handles continuation responses)
5. On rejection, returns error to the LLM

The marketplace frontend renders `GeoTransactionPrompt.tsx` — a modal with wagmi's `useSendTransaction()`, countdown timer, and reject/retry flow.
