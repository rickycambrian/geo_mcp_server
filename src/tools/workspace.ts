import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  Account,
  Graph,
  personalSpace,
  daoSpace,
  TESTNET_RPC_URL,
} from '@geoprotocol/geo-sdk';
import { createPublicClient, http } from 'viem';
import type { EditSession } from '../state/session.js';
import { query, normalizeToUUID } from '../api/client.js';
import { ensureWalletConfigured, normalizeAddress, normalizeBytes16Hex } from '../utils/wallet.js';

const publicClient = createPublicClient({ transport: http(TESTNET_RPC_URL) });

const NOTE_META_PREFIX = '[kf.note.meta]';
const TASK_META_PREFIX = '[kf.task.meta]';

const SYSTEM_IDS = {
  POST_TYPE: 'f3d4461486b74d2583d89709c9d84f65',
  PROJECT_TYPE: '484a18c5030a499cb0f2ef588ff16d50',
  GOAL_TYPE: '0fecaded7c584a719a02e1cb49800e27',
  MARKDOWN_CONTENT: 'e3e363d1dd294ccb8e6ff3b76d99bc33',
} as const;

type WorkspaceKind = 'note' | 'task' | 'project';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function ok(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  };
}

function err(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}

function buildMetaDescription(prefix: string, meta: Record<string, string>, body: string): string {
  const compact = Object.fromEntries(
    Object.entries(meta).filter(([, value]) => typeof value === 'string' && value.trim().length > 0),
  );
  return `${prefix}${JSON.stringify(compact)}\n${body}`;
}

function getTypeId(kind: WorkspaceKind): string {
  switch (kind) {
    case 'note':
      return SYSTEM_IDS.POST_TYPE;
    case 'task':
      return SYSTEM_IDS.GOAL_TYPE;
    case 'project':
      return SYSTEM_IDS.PROJECT_TYPE;
  }
}

async function ensureSpaceReady(session: EditSession): Promise<{ ok: true } | { ok: false; error: string }> {
  const ensured = await ensureWalletConfigured(session);
  if (!ensured.ok || !session.walletAddress || !session.smartAccountClient) {
    return { ok: false, error: ensured.ok ? 'Wallet not configured.' : ensured.error };
  }
  if (!session.spaceId) {
    return { ok: false, error: 'Space not set up. Call setup_space first.' };
  }
  return { ok: true };
}

export function registerWorkspaceTools(server: McpServer, session: EditSession): void {
  server.tool(
    'resolve_workspace_entities',
    'Resolve workspace entities by kind and optional name search.',
    {
      kind: z.enum(['note', 'task', 'project']),
      name: z.string().optional().describe('Optional name search'),
      spaceId: z.string().optional().describe('Optional dashless space ID'),
      first: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    },
    async ({ kind, name, spaceId, first, offset }) => {
      try {
        const typeId = getTypeId(kind);
        const filter: Record<string, unknown> = {
          typeIds: { contains: [normalizeToUUID(typeId)] },
        };
        if (spaceId) {
          filter.spaceIds = { contains: [normalizeToUUID(spaceId)] };
        }
        if (name) {
          filter.name = { includesInsensitive: name };
        }

        const gql = `
          query ListWorkspaceEntities($first: Int, $offset: Int, $filter: EntityFilter) {
            entitiesConnection(first: $first, offset: $offset, filter: $filter) {
              totalCount
              nodes {
                id
                name
                description
                typeIds
                spaceIds
                createdAt
                updatedAt
              }
            }
          }
        `;

        const data = await query<{
          entitiesConnection: {
            totalCount: number;
            nodes: Array<Record<string, unknown>>;
          };
        }>(gql, {
          first: first ?? 20,
          offset: offset ?? 0,
          filter,
        });

        return ok({
          kind,
          entities: data.entitiesConnection.nodes ?? [],
          totalCount: data.entitiesConnection.totalCount ?? 0,
        });
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    'upsert_workspace_entity',
    'Create/update a workspace note/task/project and publish privately or as a DAO proposal.',
    {
      kind: z.enum(['note', 'task', 'project']),
      name: z.string().describe('Entity name/title'),
      entityId: z.string().optional().describe('Existing entity ID to update'),
      description: z.string().optional().describe('Plain text description'),
      markdownContent: z.string().optional().describe('Markdown body for note entities'),
      noteType: z.string().optional(),
      tags: z.string().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      dueDate: z.string().optional(),
      visibility: z.enum(['private', 'public']).default('private'),
      daoSpaceAddress: z.string().optional(),
      daoSpaceId: z.string().optional(),
      votingMode: z.enum(['FAST', 'SLOW']).optional(),
    },
    async ({
      kind,
      name,
      entityId,
      description,
      markdownContent,
      noteType,
      tags,
      status,
      priority,
      dueDate,
      visibility,
      daoSpaceAddress,
      daoSpaceId,
      votingMode,
    }) => {
      const ready = await ensureSpaceReady(session);
      if (!ready.ok || !session.walletAddress || !session.smartAccountClient || !session.spaceId) {
        return err(ready.ok ? 'Wallet/space not configured.' : ready.error);
      }

      if (visibility === 'public' && (!daoSpaceAddress || !daoSpaceId || !votingMode)) {
        return err('Public upsert requires daoSpaceAddress, daoSpaceId, and votingMode.');
      }

      try {
        const values: Array<Record<string, unknown>> = [];
        if (kind === 'note') {
          values.push({
            property: SYSTEM_IDS.MARKDOWN_CONTENT,
            type: 'text',
            value: markdownContent ?? '',
          });
        }

        let normalizedDescription = description ?? '';
        if (kind === 'note') {
          normalizedDescription = buildMetaDescription(
            NOTE_META_PREFIX,
            { noteType: noteType ?? 'general', tags: tags ?? '' },
            normalizedDescription,
          );
        } else if (kind === 'task') {
          normalizedDescription = buildMetaDescription(
            TASK_META_PREFIX,
            {
              status: status ?? 'pending',
              priority: priority ?? 'medium',
              dueDate: dueDate ?? '',
            },
            normalizedDescription,
          );
        }

        const mutation = entityId
          ? Graph.updateEntity({
            id: entityId,
            name,
            description: normalizedDescription,
            ...(values.length > 0 ? { values: values as never } : {}),
          })
          : Graph.createEntity({
            name,
            description: normalizedDescription,
            types: [getTypeId(kind)],
            ...(values.length > 0 ? { values: values as never } : {}),
          });

        const { accountId, ops: accountOps } = Account.make(session.walletAddress);
        const allOps = [...accountOps, ...mutation.ops];

        if (visibility === 'private') {
          const { editId, cid, to, calldata } = await personalSpace.publishEdit({
            name: `upsert_workspace_entity:${kind}:${name}`,
            spaceId: session.spaceId,
            ops: allOps,
            author: accountId,
            network: 'TESTNET',
          });
          const txHash = await session.smartAccountClient.sendTransaction({ to, data: calldata });
          await publicClient.waitForTransactionReceipt({ hash: txHash });
          return ok({
            entityId: mutation.id,
            publishMode: 'published',
            txHash,
            editId,
            cid,
          });
        }

        const normalizedDaoSpaceAddress = normalizeAddress(daoSpaceAddress!, 'daoSpaceAddress');
        const normalizedDaoSpaceId = normalizeBytes16Hex(daoSpaceId!, 'daoSpaceId');
        const normalizedCallerSpaceId = normalizeBytes16Hex(session.spaceId, 'callerSpaceId');
        const proposal = await daoSpace.proposeEdit({
          name: `upsert_workspace_entity:${kind}:${name}`,
          ops: allOps,
          author: accountId,
          daoSpaceAddress: normalizedDaoSpaceAddress,
          callerSpaceId: normalizedCallerSpaceId,
          daoSpaceId: normalizedDaoSpaceId,
          votingMode: votingMode!,
          network: 'TESTNET',
        });
        const txHash = await session.smartAccountClient.sendTransaction({
          to: proposal.to,
          data: proposal.calldata,
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });

        return ok({
          entityId: mutation.id,
          publishMode: 'proposal',
          proposalId: proposal.proposalId,
          txHash,
          editId: proposal.editId,
          cid: proposal.cid,
        });
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    'delete_workspace_entity',
    'Delete a workspace entity and publish the change privately or as a DAO proposal.',
    {
      entityId: z.string(),
      kind: z.enum(['note', 'task', 'project']).optional(),
      visibility: z.enum(['private', 'public']).default('private'),
      daoSpaceAddress: z.string().optional(),
      daoSpaceId: z.string().optional(),
      votingMode: z.enum(['FAST', 'SLOW']).optional(),
    },
    async ({ entityId, kind, visibility, daoSpaceAddress, daoSpaceId, votingMode }) => {
      const ready = await ensureSpaceReady(session);
      if (!ready.ok || !session.walletAddress || !session.smartAccountClient || !session.spaceId) {
        return err(ready.ok ? 'Wallet/space not configured.' : ready.error);
      }

      if (visibility === 'public' && (!daoSpaceAddress || !daoSpaceId || !votingMode)) {
        return err('Public delete requires daoSpaceAddress, daoSpaceId, and votingMode.');
      }

      try {
        const deletion = Graph.deleteEntity({ id: entityId });
        const { accountId, ops: accountOps } = Account.make(session.walletAddress);
        const allOps = [...accountOps, ...deletion.ops];

        if (visibility === 'private') {
          const { editId, cid, to, calldata } = await personalSpace.publishEdit({
            name: `delete_workspace_entity:${kind ?? 'entity'}:${entityId}`,
            spaceId: session.spaceId,
            ops: allOps,
            author: accountId,
            network: 'TESTNET',
          });
          const txHash = await session.smartAccountClient.sendTransaction({ to, data: calldata });
          await publicClient.waitForTransactionReceipt({ hash: txHash });
          return ok({
            entityId,
            publishMode: 'published',
            txHash,
            editId,
            cid,
          });
        }

        const normalizedDaoSpaceAddress = normalizeAddress(daoSpaceAddress!, 'daoSpaceAddress');
        const normalizedDaoSpaceId = normalizeBytes16Hex(daoSpaceId!, 'daoSpaceId');
        const normalizedCallerSpaceId = normalizeBytes16Hex(session.spaceId, 'callerSpaceId');
        const proposal = await daoSpace.proposeEdit({
          name: `delete_workspace_entity:${kind ?? 'entity'}:${entityId}`,
          ops: allOps,
          author: accountId,
          daoSpaceAddress: normalizedDaoSpaceAddress,
          callerSpaceId: normalizedCallerSpaceId,
          daoSpaceId: normalizedDaoSpaceId,
          votingMode: votingMode!,
          network: 'TESTNET',
        });
        const txHash = await session.smartAccountClient.sendTransaction({
          to: proposal.to,
          data: proposal.calldata,
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });

        return ok({
          entityId,
          publishMode: 'proposal',
          proposalId: proposal.proposalId,
          txHash,
          editId: proposal.editId,
          cid: proposal.cid,
        });
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error));
      }
    },
  );
}

