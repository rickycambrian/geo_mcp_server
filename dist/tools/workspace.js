import { z } from 'zod';
import { Account, Graph, personalSpace, daoSpace, } from '@geoprotocol/geo-sdk';
import { query, normalizeToUUID } from '../api/client.js';
import { ensureWalletConfigured, normalizeAddress, normalizeBytes16Hex } from '../utils/wallet.js';
import { executeTransaction } from '../utils/tx-executor.js';
const NOTE_META_PREFIX = '[kf.note.meta]';
const TASK_META_PREFIX = '[kf.task.meta]';
const SYSTEM_IDS = {
    POST_TYPE: 'f3d4461486b74d2583d89709c9d84f65',
    PROJECT_TYPE: '484a18c5030a499cb0f2ef588ff16d50',
    GOAL_TYPE: '0fecaded7c584a719a02e1cb49800e27',
    MARKDOWN_CONTENT: 'e3e363d1dd294ccb8e6ff3b76d99bc33',
};
function isObject(value) {
    return typeof value === 'object' && value !== null;
}
function ok(data) {
    return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
    };
}
function err(message) {
    return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true,
    };
}
function buildMetaDescription(prefix, meta, body) {
    const compact = Object.fromEntries(Object.entries(meta).filter(([, value]) => typeof value === 'string' && value.trim().length > 0));
    return `${prefix}${JSON.stringify(compact)}\n${body}`;
}
function getTypeId(kind) {
    switch (kind) {
        case 'note':
            return SYSTEM_IDS.POST_TYPE;
        case 'task':
            return SYSTEM_IDS.GOAL_TYPE;
        case 'project':
            return SYSTEM_IDS.PROJECT_TYPE;
    }
}
async function ensureSpaceReady(session) {
    const ensured = await ensureWalletConfigured(session);
    if (!ensured.ok || !session.walletAddress) {
        return { ok: false, error: ensured.ok ? 'Wallet not configured.' : ensured.error };
    }
    if (session.walletMode !== 'APPROVAL' && !session.smartAccountClient) {
        return { ok: false, error: 'Wallet not configured.' };
    }
    if (!session.spaceId) {
        return { ok: false, error: 'Space not set up. Call setup_space first.' };
    }
    return { ok: true };
}
export function registerWorkspaceTools(server, session) {
    server.tool('resolve_workspace_entities', 'Resolve workspace entities by kind and optional name search.', {
        kind: z.enum(['note', 'task', 'project']),
        name: z.string().optional().describe('Optional name search'),
        spaceId: z.string().optional().describe('Optional dashless space ID'),
        first: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
    }, { readOnlyHint: true }, async ({ kind, name, spaceId, first, offset }) => {
        try {
            const typeId = getTypeId(kind);
            const filter = {
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
            const data = await query(gql, {
                first: first ?? 20,
                offset: offset ?? 0,
                filter,
            });
            return ok({
                kind,
                entities: data.entitiesConnection.nodes ?? [],
                totalCount: data.entitiesConnection.totalCount ?? 0,
            });
        }
        catch (error) {
            return err(error instanceof Error ? error.message : String(error));
        }
    });
    server.tool('upsert_workspace_entity', 'Create/update a workspace note/task/project and publish privately or as a DAO proposal.', {
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
    }, { readOnlyHint: false }, async ({ kind, name, entityId, description, markdownContent, noteType, tags, status, priority, dueDate, visibility, daoSpaceAddress, daoSpaceId, votingMode, }) => {
        const ready = await ensureSpaceReady(session);
        if (!ready.ok || !session.walletAddress || !session.spaceId) {
            return err(ready.ok ? 'Wallet/space not configured.' : ready.error);
        }
        if (visibility === 'public' && (!daoSpaceAddress || !daoSpaceId || !votingMode)) {
            return err('Public upsert requires daoSpaceAddress, daoSpaceId, and votingMode.');
        }
        try {
            const values = [];
            if (kind === 'note') {
                values.push({
                    property: SYSTEM_IDS.MARKDOWN_CONTENT,
                    type: 'text',
                    value: markdownContent ?? '',
                });
            }
            let normalizedDescription = description ?? '';
            if (kind === 'note') {
                normalizedDescription = buildMetaDescription(NOTE_META_PREFIX, { noteType: noteType ?? 'general', tags: tags ?? '' }, normalizedDescription);
            }
            else if (kind === 'task') {
                normalizedDescription = buildMetaDescription(TASK_META_PREFIX, {
                    status: status ?? 'pending',
                    priority: priority ?? 'medium',
                    dueDate: dueDate ?? '',
                }, normalizedDescription);
            }
            const mutation = entityId
                ? Graph.updateEntity({
                    id: entityId,
                    name,
                    description: normalizedDescription,
                    ...(values.length > 0 ? { values: values } : {}),
                })
                : Graph.createEntity({
                    name,
                    description: normalizedDescription,
                    types: [getTypeId(kind)],
                    ...(values.length > 0 ? { values: values } : {}),
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
                const txResult = await executeTransaction(session, {
                    to,
                    data: calldata,
                    description: `Publish workspace ${kind}: ${name}`,
                    toolName: 'upsert_workspace_entity',
                    metadata: { entityId: mutation.id, editId, cid },
                });
                if (txResult.mode === 'pending_approval') {
                    return ok({ status: 'pending_signature', ...txResult.pendingTx, entityId: mutation.id, editId, cid });
                }
                return ok({
                    entityId: mutation.id,
                    publishMode: 'published',
                    txHash: txResult.txHash,
                    editId,
                    cid,
                });
            }
            const normalizedDaoSpaceAddress = normalizeAddress(daoSpaceAddress, 'daoSpaceAddress');
            const normalizedDaoSpaceId = normalizeBytes16Hex(daoSpaceId, 'daoSpaceId');
            const normalizedCallerSpaceId = normalizeBytes16Hex(session.spaceId, 'callerSpaceId');
            const proposal = await daoSpace.proposeEdit({
                name: `upsert_workspace_entity:${kind}:${name}`,
                ops: allOps,
                author: accountId,
                daoSpaceAddress: normalizedDaoSpaceAddress,
                callerSpaceId: normalizedCallerSpaceId,
                daoSpaceId: normalizedDaoSpaceId,
                votingMode: votingMode,
                network: 'TESTNET',
            });
            const txResult = await executeTransaction(session, {
                to: proposal.to,
                data: proposal.calldata,
                description: `Propose workspace ${kind}: ${name}`,
                toolName: 'upsert_workspace_entity',
                metadata: { entityId: mutation.id, proposalId: proposal.proposalId, editId: proposal.editId, cid: proposal.cid },
            });
            if (txResult.mode === 'pending_approval') {
                return ok({ status: 'pending_signature', ...txResult.pendingTx, entityId: mutation.id, proposalId: proposal.proposalId });
            }
            return ok({
                entityId: mutation.id,
                publishMode: 'proposal',
                proposalId: proposal.proposalId,
                txHash: txResult.txHash,
                editId: proposal.editId,
                cid: proposal.cid,
            });
        }
        catch (error) {
            return err(error instanceof Error ? error.message : String(error));
        }
    });
    server.tool('delete_workspace_entity', 'Delete a workspace entity and publish the change privately or as a DAO proposal.', {
        entityId: z.string(),
        kind: z.enum(['note', 'task', 'project']).optional(),
        visibility: z.enum(['private', 'public']).default('private'),
        daoSpaceAddress: z.string().optional(),
        daoSpaceId: z.string().optional(),
        votingMode: z.enum(['FAST', 'SLOW']).optional(),
    }, { destructiveHint: true }, async ({ entityId, kind, visibility, daoSpaceAddress, daoSpaceId, votingMode }) => {
        const ready = await ensureSpaceReady(session);
        if (!ready.ok || !session.walletAddress || !session.spaceId) {
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
                const txResult = await executeTransaction(session, {
                    to,
                    data: calldata,
                    description: `Delete workspace entity: ${entityId}`,
                    toolName: 'delete_workspace_entity',
                    metadata: { entityId, editId, cid },
                });
                if (txResult.mode === 'pending_approval') {
                    return ok({ status: 'pending_signature', ...txResult.pendingTx, entityId, editId, cid });
                }
                return ok({
                    entityId,
                    publishMode: 'published',
                    txHash: txResult.txHash,
                    editId,
                    cid,
                });
            }
            const normalizedDaoSpaceAddress = normalizeAddress(daoSpaceAddress, 'daoSpaceAddress');
            const normalizedDaoSpaceId = normalizeBytes16Hex(daoSpaceId, 'daoSpaceId');
            const normalizedCallerSpaceId = normalizeBytes16Hex(session.spaceId, 'callerSpaceId');
            const proposal = await daoSpace.proposeEdit({
                name: `delete_workspace_entity:${kind ?? 'entity'}:${entityId}`,
                ops: allOps,
                author: accountId,
                daoSpaceAddress: normalizedDaoSpaceAddress,
                callerSpaceId: normalizedCallerSpaceId,
                daoSpaceId: normalizedDaoSpaceId,
                votingMode: votingMode,
                network: 'TESTNET',
            });
            const txResult = await executeTransaction(session, {
                to: proposal.to,
                data: proposal.calldata,
                description: `Propose delete workspace entity: ${entityId}`,
                toolName: 'delete_workspace_entity',
                metadata: { entityId, proposalId: proposal.proposalId, editId: proposal.editId, cid: proposal.cid },
            });
            if (txResult.mode === 'pending_approval') {
                return ok({ status: 'pending_signature', ...txResult.pendingTx, entityId, proposalId: proposal.proposalId });
            }
            return ok({
                entityId,
                publishMode: 'proposal',
                proposalId: proposal.proposalId,
                txHash: txResult.txHash,
                editId: proposal.editId,
                cid: proposal.cid,
            });
        }
        catch (error) {
            return err(error instanceof Error ? error.message : String(error));
        }
    });
}
//# sourceMappingURL=workspace.js.map