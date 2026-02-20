import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  personalSpace,
  daoSpace,
  TESTNET_RPC_URL,
  Account,
  Graph,
} from '@geoprotocol/geo-sdk';
import { SpaceRegistryAbi } from '@geoprotocol/geo-sdk/abis';
import { TESTNET } from '@geoprotocol/geo-sdk/contracts';
import { createPublicClient, type Hex, http } from 'viem';
import { z } from 'zod';
import { type EditSession } from '../state/session.js';
import {
  ensureWalletConfigured,
  normalizeAddress,
  normalizeBytes16Hex,
} from '../utils/wallet.js';

// Shared public client – created once per process instead of on every tool call.
const publicClient = createPublicClient({ transport: http(TESTNET_RPC_URL) });

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

async function ensureCallerSpace(session: EditSession): Promise<{ ok: true } | { ok: false; error: string }> {
  const ensured = await ensureWalletConfigured(session);
  if (!ensured.ok || !session.walletAddress || !session.smartAccountClient) {
    return { ok: false, error: ensured.ok ? 'Wallet not configured.' : ensured.error };
  }

  if (session.spaceId) {
    return { ok: true };
  }

  try {
    const address = session.walletAddress as Hex;
    const alreadyHasSpace = await personalSpace.hasSpace({ address });
    if (!alreadyHasSpace) {
      const { to, calldata } = personalSpace.createSpace();
      const txHash = await session.smartAccountClient.sendTransaction({ to, data: calldata });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
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
    'Configure the wallet with a private key to enable publishing',
    {
      privateKey: z
        .string()
        .optional()
        .describe('Hex private key with 0x prefix (optional; if omitted uses GEO_PRIVATE_KEY secret)'),
    },
    async ({ privateKey }) => {
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
    'Ensure personal space exists and get space ID',
    {},
    async () => {
      const ensured = await ensureWalletConfigured(session);
      if (!ensured.ok || !session.walletAddress || !session.smartAccountClient) {
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

      try {
        const smartAccountClient = session.smartAccountClient;
        const address = session.walletAddress as Hex;
        const alreadyHasSpace = await personalSpace.hasSpace({ address });
        let created = false;

        if (!alreadyHasSpace) {
          const { to, calldata } = personalSpace.createSpace();
          const txHash = await smartAccountClient.sendTransaction({
            to,
            data: calldata,
          });
          await publicClient.waitForTransactionReceipt({ hash: txHash });
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
    async ({ name }) => {
      const ensured = await ensureWalletConfigured(session);
      if (!ensured.ok || !session.smartAccountClient) {
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
        const smartAccountClient = session.smartAccountClient;
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

        const txHash = await smartAccountClient.sendTransaction({
          to,
          data: calldata,
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });

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
                txHash,
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
    async ({ name, daoSpaceAddress, daoSpaceId, votingMode }) => {
      const ensured = await ensureWalletConfigured(session);
      if (!ensured.ok || !session.smartAccountClient) {
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
        const smartAccountClient = session.smartAccountClient;
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

        const txHash = await smartAccountClient.sendTransaction({
          to,
          data: calldata,
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });

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
                txHash,
                opsProposed,
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
      if (!ensuredSpace.ok || !session.walletAddress || !session.smartAccountClient || !session.spaceId) {
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

        const smartAccountClient = session.smartAccountClient;
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

          const txHash = await smartAccountClient.sendTransaction({ to, data: calldata });
          await publicClient.waitForTransactionReceipt({ hash: txHash });

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  workflowId: resolvedWorkflowId,
                  publishMode: 'published',
                  txHash,
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

        const txHash = await smartAccountClient.sendTransaction({ to, data: calldata });
        await publicClient.waitForTransactionReceipt({ hash: txHash });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                workflowId: resolvedWorkflowId,
                publishMode: 'proposal',
                proposalId,
                txHash,
                editId,
                cid,
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

  // ── get_session_status ────────────────────────────────────────────
  server.tool(
    'get_session_status',
    'Get current session state',
    {},
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
    async () => {
      const previousOpsCount = session.opsCount;
      const previousLastPublishedOpsCount = session.getLastPublishedOps().length;
      session.clear({ includeLastPublished: true });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              message: 'Session cleared',
              previousOpsCount,
              previousLastPublishedOpsCount,
            }),
          },
        ],
      };
    },
  );
}
