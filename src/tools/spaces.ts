import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  personalSpace,
  daoSpace,
  getSmartAccountWalletClient,
  TESTNET_RPC_URL,
  Account,
} from '@geoprotocol/geo-sdk';
import { SpaceRegistryAbi } from '@geoprotocol/geo-sdk/abis';
import { TESTNET } from '@geoprotocol/geo-sdk/contracts';
import { createPublicClient, type Hex, http } from 'viem';
import { z } from 'zod';
import { type EditSession } from '../state/session.js';
import type { GeoSmartAccount } from '@geoprotocol/geo-sdk';

let smartAccountClient: GeoSmartAccount | null = null;

async function ensureWalletConfigured(
  session: EditSession,
  privateKeyOverride?: string,
): Promise<{ ok: true; address: Hex } | { ok: false; error: string }> {
  // If already configured for this session, we're done.
  if (session.privateKey && session.walletAddress && smartAccountClient) {
    return { ok: true, address: session.walletAddress as Hex };
  }

  const privateKey = privateKeyOverride ?? session.privateKey ?? process.env.GEO_PRIVATE_KEY;
  if (!privateKey) {
    return {
      ok: false,
      error:
        'Wallet not configured. Configure GEO_PRIVATE_KEY secret (recommended) or call configure_wallet with a privateKey.',
    };
  }

  try {
    const client = await getSmartAccountWalletClient({ privateKey: privateKey as Hex });
    smartAccountClient = client;
    session.privateKey = privateKey;
    session.walletAddress = client.account.address;
    return { ok: true, address: client.account.address };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to configure wallet: ${error instanceof Error ? error.message : String(error)}`,
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
      if (!ensured.ok || !session.walletAddress || !smartAccountClient) {
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
        const address = session.walletAddress as Hex;
        const alreadyHasSpace = await personalSpace.hasSpace({ address });
        let created = false;

        if (!alreadyHasSpace) {
          const { to, calldata } = personalSpace.createSpace();
          const txHash = await smartAccountClient.sendTransaction({
            to,
            data: calldata,
          });
          const publicClient = createPublicClient({
            transport: http(TESTNET_RPC_URL),
          });
          await publicClient.waitForTransactionReceipt({ hash: txHash });
          created = true;
        }

        // Look up space ID from the registry contract
        const publicClient = createPublicClient({
          transport: http(TESTNET_RPC_URL),
        });
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
      if (!ensured.ok || !smartAccountClient) {
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

        const publicClient = createPublicClient({
          transport: http(TESTNET_RPC_URL),
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
      if (!ensured.ok || !smartAccountClient) {
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

        const publicClient = createPublicClient({
          transport: http(TESTNET_RPC_URL),
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

function withHexPrefix(value: string): `0x${string}` {
  const trimmed = value.trim().toLowerCase();
  return (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as `0x${string}`;
}

function normalizeAddress(value: string, field: string): `0x${string}` {
  const normalized = withHexPrefix(value);
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${field} must be an EVM address (20-byte hex, with or without 0x prefix)`);
  }
  return normalized;
}

function normalizeBytes16Hex(value: string, field: string): `0x${string}` {
  const normalized = withHexPrefix(value);
  if (!/^0x[0-9a-f]{32}$/.test(normalized)) {
    throw new Error(`${field} must be bytes16 hex (0x followed by 32 hex chars). Received: ${value}`);
  }
  return normalized;
}
