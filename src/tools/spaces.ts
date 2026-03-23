import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  personalSpace,
  daoSpace,
  Account,
  Graph,
} from '@geoprotocol/geo-sdk';
import { SpaceRegistryAbi, DaoSpaceAbi } from '@geoprotocol/geo-sdk/abis';
import { TESTNET } from '@geoprotocol/geo-sdk/contracts';
import { type Hex, encodeFunctionData, encodeAbiParameters } from 'viem';
import { z } from 'zod';
import { type EditSession } from '../state/session.js';
import {
  ensureWalletConfigured,
  normalizeAddress,
  normalizeBytes16Hex,
} from '../utils/wallet.js';
import {
  executeTransaction,
  publicClient,
  type TxResult,
} from '../utils/tx-executor.js';

function stableStringify(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') {
      const entries = Object.entries(input as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b));
      return Object.fromEntries(entries.map(([key, val]) => [key, normalize(val)]));
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

// ── DAO auto-vote helpers (same pattern as clear-dao-space script) ────────
// keccak256('GOVERNANCE.PROPOSAL_VOTED')
const PROPOSAL_VOTED_ACTION =
  '0x4ebf5f29676cedf7e2e4d346a8433289278f95a9fda73691dc1ce24574d5819e' as `0x${string}`;
// keccak256('GOVERNANCE.PROPOSAL_EXECUTED')
const PROPOSAL_EXECUTED_ACTION =
  '0x62a60c0a9681612871e0dafa0f24bb0c83cbdde8be5a6299979c88d382369e96' as `0x${string}`;
// DAOSpace VoteOption enum: None=0, Yes=1, No=2, Abstain=3
const VoteOption = { None: 0, Yes: 1, No: 2, Abstain: 3 } as const;

function bytes16ToBytes32(b16: string): `0x${string}` {
  return ('0x' + b16.slice(2) + '0'.repeat(32)) as `0x${string}`;
}

/** Build vote calldata for a DAO proposal. */
export function buildVoteCalldata(
  callerSpaceId: string,
  daoSpaceIdHex: string,
  proposalId: string,
): { to: `0x${string}`; data: `0x${string}` } {
  const callerSpaceIdHex = callerSpaceId.startsWith('0x')
    ? callerSpaceId as `0x${string}`
    : `0x${callerSpaceId}` as `0x${string}`;
  const daoIdHex = daoSpaceIdHex.startsWith('0x')
    ? daoSpaceIdHex as `0x${string}`
    : `0x${daoSpaceIdHex}` as `0x${string}`;
  const proposalIdHex = proposalId.startsWith('0x')
    ? proposalId as `0x${string}`
    : `0x${proposalId}` as `0x${string}`;

  const voteData = encodeAbiParameters(
    [
      { type: 'bytes16', name: 'proposalId' },
      { type: 'uint8', name: 'voteOption' },
    ],
    [proposalIdHex, VoteOption.Yes],
  );

  const calldata = encodeFunctionData({
    abi: SpaceRegistryAbi,
    functionName: 'enter',
    args: [
      callerSpaceIdHex,
      daoIdHex,
      PROPOSAL_VOTED_ACTION,
      bytes16ToBytes32(proposalIdHex),
      voteData,
      '0x',
    ],
  });

  return { to: TESTNET.SPACE_REGISTRY_ADDRESS, data: calldata };
}

/** Build execute calldata for a DAO proposal. */
export function buildExecuteCalldata(
  callerSpaceId: string,
  daoSpaceIdHex: string,
  proposalId: string,
): { to: `0x${string}`; data: `0x${string}` } {
  const callerSpaceIdHex = callerSpaceId.startsWith('0x')
    ? callerSpaceId as `0x${string}`
    : `0x${callerSpaceId}` as `0x${string}`;
  const daoIdHex = daoSpaceIdHex.startsWith('0x')
    ? daoSpaceIdHex as `0x${string}`
    : `0x${daoSpaceIdHex}` as `0x${string}`;
  const proposalIdHex = proposalId.startsWith('0x')
    ? proposalId as `0x${string}`
    : `0x${proposalId}` as `0x${string}`;

  const execData = encodeAbiParameters(
    [{ type: 'bytes16', name: 'proposalId' }],
    [proposalIdHex],
  );

  const calldata = encodeFunctionData({
    abi: SpaceRegistryAbi,
    functionName: 'enter',
    args: [
      callerSpaceIdHex,
      daoIdHex,
      PROPOSAL_EXECUTED_ACTION,
      bytes16ToBytes32(proposalIdHex),
      execData,
      '0x',
    ],
  });

  return { to: TESTNET.SPACE_REGISTRY_ADDRESS, data: calldata };
}

/** Vote YES on a DAO proposal and auto-execute if threshold is met. */
async function autoVoteAndExecute(
  session: EditSession,
  callerSpaceId: string,
  daoSpaceIdHex: string,
  daoSpaceAddress: string,
  proposalId: string,
): Promise<{ voteTxHash?: string; votePendingTx?: TxResult; executed: boolean; execTxHash?: string; execPendingTx?: TxResult }> {
  const proposalIdHex = proposalId.startsWith('0x')
    ? proposalId as `0x${string}`
    : `0x${proposalId}` as `0x${string}`;

  // 1. Vote YES
  const { to: voteTo, data: voteCalldata } = buildVoteCalldata(callerSpaceId, daoSpaceIdHex, proposalId);
  const voteResult = await executeTransaction(session, {
    to: voteTo,
    data: voteCalldata,
    description: `Vote YES on proposal ${proposalId}`,
    toolName: 'auto_vote',
    metadata: { proposalId, callerSpaceId, daoSpaceIdHex, daoSpaceAddress },
  });

  if (voteResult.mode === 'pending_approval') {
    // In APPROVAL mode, register continuation for auto_execute after vote is confirmed
    session.addContinuation({
      pendingTxId: voteResult.pendingTx!.id,
      onComplete: 'auto_execute',
      context: { callerSpaceId, daoSpaceIdHex, daoSpaceAddress, proposalId },
    });
    return { votePendingTx: voteResult, executed: false };
  }

  // PRIVATE_KEY mode — vote already sent, check execution status
  // 2. Check if proposal auto-executed with the vote
  const infoAfter = await publicClient.readContract({
    address: daoSpaceAddress as `0x${string}`,
    abi: DaoSpaceAbi,
    functionName: 'getLatestProposalInformation',
    args: [proposalIdHex],
  });

  const executed = (infoAfter as readonly unknown[])[0] as boolean;
  if (executed) {
    return { voteTxHash: voteResult.txHash, executed: true };
  }

  // 3. If not auto-executed, check threshold and execute manually
  const thresholdReached = await publicClient.readContract({
    address: daoSpaceAddress as `0x${string}`,
    abi: DaoSpaceAbi,
    functionName: 'isSupportThresholdReached',
    args: [proposalIdHex],
  });

  if (thresholdReached) {
    const { to: execTo, data: execCalldata } = buildExecuteCalldata(callerSpaceId, daoSpaceIdHex, proposalId);
    const execResult = await executeTransaction(session, {
      to: execTo,
      data: execCalldata,
      description: `Execute proposal ${proposalId}`,
      toolName: 'auto_execute',
      metadata: { proposalId },
    });

    return { voteTxHash: voteResult.txHash, executed: true, execTxHash: execResult.txHash };
  }

  return { voteTxHash: voteResult.txHash, executed: false };
}

function ensureWalletReady(
  session: EditSession,
): string | null {
  // In APPROVAL mode, smartAccountClient is not needed — just need walletAddress
  if (session.walletMode === 'APPROVAL') {
    return session.walletAddress ? null : 'Wallet not configured.';
  }
  return session.smartAccountClient ? null : 'Wallet not configured.';
}

async function ensureCallerSpace(session: EditSession): Promise<{ ok: true } | { ok: false; error: string }> {
  const ensured = await ensureWalletConfigured(session);
  if (!ensured.ok || !session.walletAddress) {
    return { ok: false, error: ensured.ok ? 'Wallet not configured.' : ensured.error };
  }

  const walletErr = ensureWalletReady(session);
  if (walletErr) return { ok: false, error: walletErr };

  if (session.spaceId) {
    return { ok: true };
  }

  try {
    const address = session.walletAddress as Hex;
    const alreadyHasSpace = await personalSpace.hasSpace({ address });
    if (!alreadyHasSpace) {
      const { to, calldata } = personalSpace.createSpace();
      const txResult = await executeTransaction(session, {
        to,
        data: calldata,
        description: 'Create personal space',
        toolName: 'setup_space',
      });
      if (txResult.mode === 'pending_approval') {
        return { ok: false, error: 'Space creation requires transaction approval. Please sign the pending transaction and retry.' };
      }
    }

    const spaceIdHex = await publicClient.readContract({
      address: TESTNET.SPACE_REGISTRY_ADDRESS,
      abi: SpaceRegistryAbi,
      functionName: 'addressToSpaceId',
      args: [address],
    });
    session.spaceId = (spaceIdHex as string).slice(2, 34).toLowerCase();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to resolve caller space: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function registerSpaceTools(server: McpServer, session: EditSession): void {
  // ── configure_wallet ──────────────────────────────────────────────
  server.tool(
    'configure_wallet',
    'Configure wallet to enable write operations. Use walletMode=APPROVAL with walletAddress for transaction-return mode (no private key needed). Without any config, the server runs in read-only mode.',
    {
      privateKey: z
        .string()
        .optional()
        .describe('Hex private key with 0x prefix (optional; if omitted uses GEO_PRIVATE_KEY secret)'),
      walletAddress: z
        .string()
        .optional()
        .describe('Wallet address for APPROVAL mode (no private key needed)'),
      walletMode: z
        .enum(['PRIVATE_KEY', 'APPROVAL'])
        .optional()
        .describe('Wallet mode: PRIVATE_KEY (default, auto-signs) or APPROVAL (returns unsigned tx data)'),
    },
    { idempotentHint: true },
    async ({ privateKey, walletAddress, walletMode }) => {
      // APPROVAL mode: set address without private key
      if (walletMode === 'APPROVAL' && walletAddress) {
        try {
          const normalized = normalizeAddress(walletAddress, 'walletAddress');
          session.walletMode = 'APPROVAL';
          session.walletAddress = normalized;
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  address: normalized,
                  mode: 'approval',
                  message: 'Wallet configured in approval mode. Write operations will return unsigned transaction data for external signing.',
                }),
              },
            ],
          };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }],
            isError: true,
          };
        }
      }

      // PRIVATE_KEY mode (default)
      const ensured = await ensureWalletConfigured(session, privateKey);
      if (!ensured.ok) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: ensured.error }) }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              address: ensured.address,
              mode: 'private_key',
              message: 'Wallet configured successfully',
              source: privateKey ? 'provided' : 'env',
            }),
          },
        ],
      };
    },
  );

  // ── setup_space ───────────────────────────────────────────────────
  server.tool(
    'setup_space',
    'Ensure personal space exists and get space ID. Requires configured wallet.',
    {},
    { readOnlyHint: false },
    async () => {
      const ensured = await ensureWalletConfigured(session);
      if (!ensured.ok || !session.walletAddress) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: ensured.ok ? 'Wallet not configured.' : ensured.error,
              }),
            },
          ],
          isError: true,
        };
      }

      const walletErr = ensureWalletReady(session);
      if (walletErr) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: walletErr }) }],
          isError: true,
        };
      }

      try {
        const address = session.walletAddress as Hex;
        const alreadyHasSpace = await personalSpace.hasSpace({ address });
        let created = false;

        if (!alreadyHasSpace) {
          const { to, calldata } = personalSpace.createSpace();
          const txResult = await executeTransaction(session, {
            to,
            data: calldata,
            description: 'Create personal space',
            toolName: 'setup_space',
          });
          if (txResult.mode === 'pending_approval') {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    status: 'pending_signature',
                    ...txResult.pendingTx,
                    message: 'Space creation requires transaction approval. Sign the transaction and call submit_signed_transaction, then retry setup_space.',
                  }),
                },
              ],
            };
          }
          created = true;
        }

        // Look up space ID from the registry contract
        const spaceIdHex = await publicClient.readContract({
          address: TESTNET.SPACE_REGISTRY_ADDRESS,
          abi: SpaceRegistryAbi,
          functionName: 'addressToSpaceId',
          args: [address],
        });

        // Convert bytes16 hex (0x + 32 chars + 32 zero-padding) to 32-char hex string
        const spaceId = (spaceIdHex as string).slice(2, 34).toLowerCase();
        session.spaceId = spaceId;

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                spaceId,
                address: session.walletAddress,
                created,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Failed to setup space: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── publish_edit ──────────────────────────────────────────────────
  server.tool(
    'publish_edit',
    'Publish all accumulated ops as an edit to personal space',
    { name: z.string().describe('Name for the edit') },
    { readOnlyHint: false },
    async ({ name }) => {
      const ensured = await ensureWalletConfigured(session);
      if (!ensured.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: ensured.error,
              }),
            },
          ],
          isError: true,
        };
      }

      const walletErr = ensureWalletReady(session);
      if (walletErr) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: walletErr }) }],
          isError: true,
        };
      }

      if (!session.spaceId) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Space not set up. Call setup_space first.',
              }),
            },
          ],
          isError: true,
        };
      }

      const ops = session.getOps();
      if (ops.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'No ops accumulated. Create some entities/properties/types first.',
              }),
            },
          ],
          isError: true,
        };
      }

      try {
        // Create an account entity to use as author
        const { accountId, ops: accountOps } = Account.make(session.walletAddress!);
        const allOps = [...accountOps, ...ops];

        const { editId, cid, to, calldata } = await personalSpace.publishEdit({
          name,
          spaceId: session.spaceId,
          ops: allOps,
          author: accountId,
          network: 'TESTNET',
        });

        const txResult = await executeTransaction(session, {
          to,
          data: calldata,
          description: 'Publish edit to personal space',
          toolName: 'publish_edit',
          metadata: { editId, cid },
        });

        if (txResult.mode === 'pending_approval') {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  status: 'pending_signature',
                  ...txResult.pendingTx,
                  editId,
                  cid,
                  opsCount: ops.length,
                }),
              },
            ],
          };
        }

        const opsPublished = ops.length;
        session.setLastPublishedOps(ops);
        session.clear();

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                editId,
                cid,
                txHash: txResult.txHash,
                opsPublished,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Failed to publish edit: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── propose_dao_edit ──────────────────────────────────────────────
  server.tool(
    'propose_dao_edit',
    'Propose accumulated ops as a DAO edit',
    {
      name: z.string().describe('Name for the edit'),
      daoSpaceAddress: z.string().describe('DAO space contract address (0x hex)'),
      daoSpaceId: z.string().describe('DAO space ID (0x hex bytes16)'),
      votingMode: z.enum(['FAST', 'SLOW']).default('FAST').describe('Voting mode'),
    },
    { readOnlyHint: false },
    async ({ name, daoSpaceAddress, daoSpaceId, votingMode }) => {
      const ensured = await ensureWalletConfigured(session);
      if (!ensured.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: ensured.error,
              }),
            },
          ],
          isError: true,
        };
      }

      const walletErr = ensureWalletReady(session);
      if (walletErr) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: walletErr }) }],
          isError: true,
        };
      }

      if (!session.spaceId) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Space not set up. Call setup_space first.',
              }),
            },
          ],
          isError: true,
        };
      }

      const pendingOps = session.getOps();
      const opsToPropose = pendingOps.length > 0 ? pendingOps : session.getLastPublishedOps();
      if (opsToPropose.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'No ops accumulated. Create some entities/properties/types first.',
              }),
            },
          ],
          isError: true,
        };
      }

      try {
        const normalizedDaoSpaceAddress = normalizeAddress(daoSpaceAddress, 'daoSpaceAddress');
        const normalizedDaoSpaceId = normalizeBytes16Hex(daoSpaceId, 'daoSpaceId');
        const normalizedCallerSpaceId = normalizeBytes16Hex(session.spaceId, 'callerSpaceId');

        // Create an account entity to use as author
        const { accountId, ops: accountOps } = Account.make(session.walletAddress!);
        const allOps = [...accountOps, ...opsToPropose];

        const { editId, cid, to, calldata, proposalId } = await daoSpace.proposeEdit({
          name,
          ops: allOps,
          author: accountId,
          daoSpaceAddress: normalizedDaoSpaceAddress,
          callerSpaceId: normalizedCallerSpaceId,
          daoSpaceId: normalizedDaoSpaceId,
          votingMode,
          network: 'TESTNET',
        });

        const txResult = await executeTransaction(session, {
          to,
          data: calldata,
          description: `Propose DAO edit: ${name}`,
          toolName: 'propose_dao_edit',
          metadata: { editId, cid, proposalId },
        });

        if (txResult.mode === 'pending_approval') {
          // Register continuation: after propose tx is signed, auto-vote
          session.addContinuation({
            pendingTxId: txResult.pendingTx!.id,
            onComplete: 'auto_vote',
            context: {
              callerSpaceId: normalizedCallerSpaceId,
              daoSpaceIdHex: normalizedDaoSpaceId,
              daoSpaceAddress: normalizedDaoSpaceAddress,
              proposalId,
            },
          });

          const opsProposed = opsToPropose.length;
          session.clear({ includeLastPublished: true });

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  status: 'pending_signature',
                  ...txResult.pendingTx,
                  editId,
                  cid,
                  proposalId,
                  opsProposed,
                  message: 'DAO proposal created. Sign the transaction, then call submit_signed_transaction to vote and execute.',
                }),
              },
            ],
          };
        }

        // Auto-vote YES and execute so entities appear immediately
        let voteResult: { voteTxHash?: string; executed: boolean; execTxHash?: string } | undefined;
        try {
          voteResult = await autoVoteAndExecute(
            session,
            normalizedCallerSpaceId,
            normalizedDaoSpaceId,
            normalizedDaoSpaceAddress,
            proposalId,
          );
        } catch (voteErr) {
          console.error(`Auto-vote failed for proposal ${proposalId}:`, voteErr);
        }

        const opsProposed = opsToPropose.length;
        session.clear({ includeLastPublished: true });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                editId,
                cid,
                proposalId,
                txHash: txResult.txHash,
                opsProposed,
                voted: voteResult?.voteTxHash ? true : false,
                voteTxHash: voteResult?.voteTxHash,
                executed: voteResult?.executed ?? false,
                execTxHash: voteResult?.execTxHash,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Failed to propose DAO edit: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── upsert_canvas_workflow ───────────────────────────────────────
  server.tool(
    'upsert_canvas_workflow',
    'Create/update a canvas workflow entity and publish privately or via DAO proposal',
    {
      name: z.string().describe('Workflow name'),
      description: z.string().optional().describe('Optional workflow description'),
      nodes: z.array(z.unknown()).describe('Canvas workflow nodes'),
      connections: z.array(z.unknown()).describe('Canvas workflow connections'),
      workflowId: z.string().optional().describe('Existing workflow entity ID to update'),
      visibility: z.enum(['private', 'public']).default('private'),
      daoSpaceAddress: z.string().optional().describe('DAO space contract address (required for public)'),
      daoSpaceId: z.string().optional().describe('DAO space bytes16 ID (required for public)'),
      votingMode: z.enum(['FAST', 'SLOW']).optional().describe('Voting mode for DAO proposals'),
    },
    { readOnlyHint: false },
    async ({
      name,
      description,
      nodes,
      connections,
      workflowId,
      visibility,
      daoSpaceAddress,
      daoSpaceId,
      votingMode,
    }) => {
      const ensuredSpace = await ensureCallerSpace(session);
      if (!ensuredSpace.ok || !session.walletAddress || !session.spaceId) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: ensuredSpace.ok ? 'Wallet/space not configured.' : ensuredSpace.error }) }],
          isError: true,
        };
      }

      if (visibility === 'public' && (!daoSpaceAddress || !daoSpaceId || !votingMode)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Public workflow upsert requires daoSpaceAddress, daoSpaceId, and votingMode.',
              }),
            },
          ],
          isError: true,
        };
      }

      const payload = {
        version: 1,
        name,
        description: description ?? null,
        nodes,
        connections,
      };
      const encodedPayload = Buffer.from(stableStringify(payload), 'utf8').toString('base64');
      const canonicalDescription = `canvas-workflow:v1:${encodedPayload}`;

      try {
        const entityResult = workflowId
          ? Graph.updateEntity({ id: workflowId, name, description: canonicalDescription })
          : Graph.createEntity({ name, description: canonicalDescription });
        const resolvedWorkflowId = entityResult.id;
        const workflowOps = entityResult.ops;

        const { accountId, ops: accountOps } = Account.make(session.walletAddress);
        const allOps = [...accountOps, ...workflowOps];

        if (visibility === 'private') {
          const { editId, cid, to, calldata } = await personalSpace.publishEdit({
            name: `upsert_canvas_workflow:${name}`,
            spaceId: session.spaceId,
            ops: allOps,
            author: accountId,
            network: 'TESTNET',
          });

          const txResult = await executeTransaction(session, {
            to,
            data: calldata,
            description: `Publish canvas workflow: ${name}`,
            toolName: 'upsert_canvas_workflow',
            metadata: { editId, cid, workflowId: resolvedWorkflowId },
          });

          if (txResult.mode === 'pending_approval') {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    status: 'pending_signature',
                    ...txResult.pendingTx,
                    workflowId: resolvedWorkflowId,
                    editId,
                    cid,
                  }),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  workflowId: resolvedWorkflowId,
                  publishMode: 'published',
                  txHash: txResult.txHash,
                  editId,
                  cid,
                }),
              },
            ],
          };
        }

        const normalizedDaoSpaceAddress = normalizeAddress(daoSpaceAddress!, 'daoSpaceAddress');
        const normalizedDaoSpaceId = normalizeBytes16Hex(daoSpaceId!, 'daoSpaceId');
        const normalizedCallerSpaceId = normalizeBytes16Hex(session.spaceId, 'callerSpaceId');
        const { editId, cid, to, calldata, proposalId } = await daoSpace.proposeEdit({
          name: `upsert_canvas_workflow:${name}`,
          ops: allOps,
          author: accountId,
          daoSpaceAddress: normalizedDaoSpaceAddress,
          callerSpaceId: normalizedCallerSpaceId,
          daoSpaceId: normalizedDaoSpaceId,
          votingMode: votingMode!,
          network: 'TESTNET',
        });

        const txResult = await executeTransaction(session, {
          to,
          data: calldata,
          description: `Propose canvas workflow: ${name}`,
          toolName: 'upsert_canvas_workflow',
          metadata: { editId, cid, proposalId, workflowId: resolvedWorkflowId },
        });

        if (txResult.mode === 'pending_approval') {
          session.addContinuation({
            pendingTxId: txResult.pendingTx!.id,
            onComplete: 'auto_vote',
            context: {
              callerSpaceId: normalizedCallerSpaceId,
              daoSpaceIdHex: normalizedDaoSpaceId,
              daoSpaceAddress: normalizedDaoSpaceAddress,
              proposalId,
            },
          });

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  status: 'pending_signature',
                  ...txResult.pendingTx,
                  workflowId: resolvedWorkflowId,
                  proposalId,
                  editId,
                  cid,
                }),
              },
            ],
          };
        }

        // Auto-vote YES and execute the proposal so entities appear immediately
        let voteResult: { voteTxHash?: string; executed: boolean; execTxHash?: string } | undefined;
        try {
          voteResult = await autoVoteAndExecute(
            session,
            normalizedCallerSpaceId,
            normalizedDaoSpaceId,
            normalizedDaoSpaceAddress,
            proposalId,
          );
        } catch (voteErr) {
          // Log but don't fail — the proposal was still created successfully
          console.error(`Auto-vote failed for proposal ${proposalId}:`, voteErr);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                workflowId: resolvedWorkflowId,
                publishMode: 'proposal',
                proposalId,
                txHash: txResult.txHash,
                editId,
                cid,
                voted: voteResult?.voteTxHash ? true : false,
                voteTxHash: voteResult?.voteTxHash,
                executed: voteResult?.executed ?? false,
                execTxHash: voteResult?.execTxHash,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Failed to upsert canvas workflow: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── submit_signed_transaction ──────────────────────────────────────
  server.tool(
    'submit_signed_transaction',
    'Submit a signed transaction hash for a pending approval-mode transaction. Handles continuations (auto-vote, auto-execute) automatically.',
    {
      pendingTxId: z.string().describe('ID of the pending transaction'),
      txHash: z.string().describe('The transaction hash after signing and broadcasting'),
    },
    { readOnlyHint: false },
    async ({ pendingTxId, txHash }) => {
      const pendingTx = session.getPendingTransaction(pendingTxId);
      if (!pendingTx) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Pending transaction ${pendingTxId} not found.` }) }],
          isError: true,
        };
      }

      try {
        // Wait for the submitted tx receipt
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
        session.removePendingTransaction(pendingTxId);

        // Check for continuation
        const continuation = session.getContinuation(pendingTxId);
        if (continuation) {
          session.removeContinuation(pendingTxId);
          const ctx = continuation.context;

          if (continuation.onComplete === 'auto_vote') {
            // Build vote calldata and return as new pending tx
            const { to, data } = buildVoteCalldata(
              ctx.callerSpaceId as string,
              ctx.daoSpaceIdHex as string,
              ctx.proposalId as string,
            );
            const voteResult = await executeTransaction(session, {
              to,
              data,
              description: `Vote YES on proposal ${ctx.proposalId}`,
              toolName: 'auto_vote',
              metadata: { proposalId: ctx.proposalId },
            });

            if (voteResult.mode === 'pending_approval') {
              // Register next continuation: after vote, try to execute
              session.addContinuation({
                pendingTxId: voteResult.pendingTx!.id,
                onComplete: 'auto_execute',
                context: ctx,
              });

              return {
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify({
                      txHash,
                      receipt: { status: receipt.status, blockNumber: Number(receipt.blockNumber) },
                      continuation: {
                        type: 'auto_vote',
                        pendingTx: voteResult.pendingTx,
                        message: 'Proposal submitted. Sign the vote transaction next.',
                      },
                    }),
                  },
                ],
              };
            }

            // PRIVATE_KEY mode fallthrough (shouldn't happen in APPROVAL flow, but handle gracefully)
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    txHash,
                    receipt: { status: receipt.status, blockNumber: Number(receipt.blockNumber) },
                    voteTxHash: voteResult.txHash,
                  }),
                },
              ],
            };
          }

          if (continuation.onComplete === 'auto_execute') {
            // Check if proposal was already executed by the vote
            const proposalIdHex = (ctx.proposalId as string).startsWith('0x')
              ? ctx.proposalId as `0x${string}`
              : `0x${ctx.proposalId}` as `0x${string}`;

            const infoAfter = await publicClient.readContract({
              address: (ctx.daoSpaceAddress as string) as `0x${string}`,
              abi: DaoSpaceAbi,
              functionName: 'getLatestProposalInformation',
              args: [proposalIdHex],
            });

            const alreadyExecuted = (infoAfter as readonly unknown[])[0] as boolean;
            if (alreadyExecuted) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify({
                      txHash,
                      receipt: { status: receipt.status, blockNumber: Number(receipt.blockNumber) },
                      executed: true,
                      message: 'Proposal was auto-executed with the vote.',
                    }),
                  },
                ],
              };
            }

            // Check threshold
            const thresholdReached = await publicClient.readContract({
              address: (ctx.daoSpaceAddress as string) as `0x${string}`,
              abi: DaoSpaceAbi,
              functionName: 'isSupportThresholdReached',
              args: [proposalIdHex],
            });

            if (thresholdReached) {
              const { to, data } = buildExecuteCalldata(
                ctx.callerSpaceId as string,
                ctx.daoSpaceIdHex as string,
                ctx.proposalId as string,
              );
              const execResult = await executeTransaction(session, {
                to,
                data,
                description: `Execute proposal ${ctx.proposalId}`,
                toolName: 'auto_execute',
                metadata: { proposalId: ctx.proposalId },
              });

              if (execResult.mode === 'pending_approval') {
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: JSON.stringify({
                        txHash,
                        receipt: { status: receipt.status, blockNumber: Number(receipt.blockNumber) },
                        continuation: {
                          type: 'auto_execute',
                          pendingTx: execResult.pendingTx,
                          message: 'Vote submitted. Sign the execute transaction to finalize.',
                        },
                      }),
                    },
                  ],
                };
              }

              return {
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify({
                      txHash,
                      receipt: { status: receipt.status, blockNumber: Number(receipt.blockNumber) },
                      executed: true,
                      execTxHash: execResult.txHash,
                    }),
                  },
                ],
              };
            }

            // Threshold not reached
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    txHash,
                    receipt: { status: receipt.status, blockNumber: Number(receipt.blockNumber) },
                    executed: false,
                    message: 'Vote submitted but threshold not yet reached for execution.',
                  }),
                },
              ],
            };
          }
        }

        // No continuation — simple submit
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                txHash,
                receipt: { status: receipt.status, blockNumber: Number(receipt.blockNumber) },
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Failed to process signed transaction: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── get_session_status ────────────────────────────────────────────
  server.tool(
    'get_session_status',
    'Get current session state',
    {},
    { readOnlyHint: true },
    async () => {
      const status = session.getStatus();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(status),
          },
        ],
      };
    },
  );

  // ── clear_session ─────────────────────────────────────────────────
  server.tool(
    'clear_session',
    'Clear all accumulated ops',
    {},
    { readOnlyHint: true },
    async () => {
      const previousOpsCount = session.opsCount;
      const previousLastPublishedOpsCount = session.getLastPublishedOps().length;
      const previousPendingTxCount = session.pendingTransactions.length;
      session.clear({ includeLastPublished: true });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              message: 'Session cleared',
              previousOpsCount,
              previousLastPublishedOpsCount,
              previousPendingTxCount,
            }),
          },
        ],
      };
    },
  );
}
