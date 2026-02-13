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

export function registerSpaceTools(server: McpServer, session: EditSession): void {
  // ── configure_wallet ──────────────────────────────────────────────
  server.tool(
    'configure_wallet',
    'Configure the wallet with a private key to enable publishing',
    { privateKey: z.string().describe('Hex private key with 0x prefix') },
    async ({ privateKey }) => {
      try {
        const client = await getSmartAccountWalletClient({
          privateKey: privateKey as Hex,
        });
        smartAccountClient = client;
        session.privateKey = privateKey;
        session.walletAddress = client.account.address;

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                address: client.account.address,
                message: 'Wallet configured successfully',
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
                error: `Failed to configure wallet: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── setup_space ───────────────────────────────────────────────────
  server.tool(
    'setup_space',
    'Ensure personal space exists and get space ID',
    {},
    async () => {
      if (!session.privateKey || !session.walletAddress || !smartAccountClient) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Wallet not configured. Call configure_wallet first.',
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
      if (!session.privateKey || !smartAccountClient) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Wallet not configured. Call configure_wallet first.',
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
      if (!session.privateKey || !smartAccountClient) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Wallet not configured. Call configure_wallet first.',
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

        const { editId, cid, to, calldata, proposalId } = await daoSpace.proposeEdit({
          name,
          ops: allOps,
          author: accountId,
          daoSpaceAddress: daoSpaceAddress as `0x${string}`,
          callerSpaceId: (`0x` + session.spaceId) as `0x${string}`,
          daoSpaceId: daoSpaceId as `0x${string}`,
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

        const opsProposed = ops.length;
        session.clear();

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
      session.clear();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              message: 'Session cleared',
              previousOpsCount,
            }),
          },
        ],
      };
    },
  );
}
