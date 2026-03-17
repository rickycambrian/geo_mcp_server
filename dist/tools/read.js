import { z } from 'zod';
import { query, normalizeToUUID, toDashlessUUID } from '../api/client.js';
import { ok, err } from './helpers.js';
// ── Helpers ──────────────────────────────────────────────────────────
/** Convert selected fields of an object from dashed UUIDs to dashless hex. */
function dashlessIds(obj, ...fields) {
    const out = { ...obj };
    for (const field of fields) {
        const val = out[field];
        if (typeof val === 'string' && val.includes('-')) {
            out[field] = toDashlessUUID(val);
        }
        else if (Array.isArray(val)) {
            out[field] = val.map((v) => typeof v === 'string' && v.includes('-') ? toDashlessUUID(v) : v);
        }
    }
    return out;
}
/** Recursively convert all UUID-looking string values in an object to dashless. */
function dashlessDeep(obj) {
    if (typeof obj === 'string') {
        // Match dashed UUID pattern
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(obj)) {
            return toDashlessUUID(obj);
        }
        return obj;
    }
    if (Array.isArray(obj))
        return obj.map(dashlessDeep);
    if (obj !== null && typeof obj === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(obj)) {
            out[k] = dashlessDeep(v);
        }
        return out;
    }
    return obj;
}
// ── GraphQL fragments ────────────────────────────────────────────────
const ENTITY_SUMMARY_FIELDS = `
  id
  name
  description
  typeIds
  spaceIds
`;
const VALUE_FIELDS = `
  id
  propertyId
  entityId
  spaceId
  text
  language
  unit
  boolean
  integer
  float
  decimal
  date
  datetime
  point
  time
  bytes
  property {
    name
    dataTypeName
  }
`;
const RELATION_FIELDS = `
  id
  fromEntityId
  toEntityId
  typeId
  spaceId
  position
  fromSpaceId
  toSpaceId
  verified
  typeEntity { id name }
  fromEntity { id name }
  toEntity { id name }
`;
// ── Registration ─────────────────────────────────────────────────────
export function registerReadTools(server) {
    // ── 1. search_entities ─────────────────────────────────────────────
    server.tool('search_entities', 'Full-text search for entities in the Geo knowledge graph. Returns matching entities with basic metadata.', {
        query: z.string().describe('Search query string'),
        spaceId: z.string().optional().describe('Filter to a specific space (dashless hex ID)'),
        first: z.number().int().min(1).max(100).optional().describe('Max results to return (default 20)'),
        offset: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
        typeIds: z.array(z.string()).optional().describe('Client-side filter: only return entities matching these type IDs'),
    }, { readOnlyHint: true }, async ({ query: searchQuery, spaceId, first, offset, typeIds }) => {
        try {
            const limit = first ?? 20;
            const skip = offset ?? 0;
            // Use server-side spaceId filter when available
            const hasSpaceId = !!spaceId;
            const gql = `
          query Search($query: String!, $first: Int, $offset: Int${hasSpaceId ? ', $spaceId: UUID' : ''}) {
            search(query: $query, first: $first, offset: $offset${hasSpaceId ? ', spaceId: $spaceId' : ''}) {
              ${ENTITY_SUMMARY_FIELDS}
            }
          }
        `;
            const variables = {
                query: searchQuery,
                first: limit,
                offset: skip,
            };
            if (hasSpaceId)
                variables.spaceId = normalizeToUUID(spaceId);
            const data = await query(gql, variables);
            let results = (data.search ?? []).map((e) => dashlessIds(e, 'id', 'typeIds', 'spaceIds'));
            // Client-side type filter
            if (typeIds && typeIds.length > 0) {
                const filterSet = new Set(typeIds.map((id) => id.replace(/-/g, '').toLowerCase()));
                results = results.filter((e) => {
                    const entityTypes = e.typeIds;
                    return entityTypes?.some((t) => filterSet.has(String(t).toLowerCase()));
                });
            }
            return ok({ results, totalCount: results.length });
        }
        catch (error) {
            return err(error);
        }
    });
    // ── 2. get_entity ──────────────────────────────────────────────────
    server.tool('get_entity', 'Get full details of a single entity by ID, including values, relations, backlinks, and types.', {
        id: z.string().describe('Entity ID (dashless hex)'),
    }, { readOnlyHint: true }, async ({ id }) => {
        try {
            const uuid = normalizeToUUID(id);
            const gql = `
          query GetEntity($id: UUID!) {
            entity(id: $id) {
              ${ENTITY_SUMMARY_FIELDS}
              createdAt
              updatedAt
              valuesList {
                ${VALUE_FIELDS}
              }
              relationsList {
                ${RELATION_FIELDS}
              }
              relationsWhereEntityList {
                ${RELATION_FIELDS}
              }
              types {
                id
                name
              }
            }
          }
        `;
            const data = await query(gql, { id: uuid });
            if (!data.entity) {
                return err(`Entity not found: ${id}`);
            }
            return ok(dashlessDeep(data.entity));
        }
        catch (error) {
            return err(error);
        }
    });
    // ── 3. list_entities ───────────────────────────────────────────────
    server.tool('list_entities', 'List entities with optional filters for space, type, and name. Supports pagination.', {
        first: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
        offset: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
        spaceIds: z.array(z.string()).optional().describe('Filter by space IDs (dashless hex)'),
        typeIds: z.array(z.string()).optional().describe('Filter by type IDs (dashless hex)'),
        name: z.string().optional().describe('Case-insensitive name substring filter'),
    }, { readOnlyHint: true }, async ({ first, offset, spaceIds, typeIds, name }) => {
        try {
            const limit = first ?? 20;
            const skip = offset ?? 0;
            // spaceId and typeId are top-level args on entitiesConnection (not inside filter)
            const spaceId = spaceIds?.[0] ? normalizeToUUID(spaceIds[0]) : undefined;
            const typeId = typeIds?.[0] ? normalizeToUUID(typeIds[0]) : undefined;
            // Name filter goes into the EntityFilter
            const filter = name
                ? { name: { includesInsensitive: name } }
                : undefined;
            // Build dynamic query args
            const argDefs = ['$first: Int', '$offset: Int'];
            const callArgs = ['first: $first', 'offset: $offset'];
            if (spaceId) {
                argDefs.push('$spaceId: UUID');
                callArgs.push('spaceId: $spaceId');
            }
            if (typeId) {
                argDefs.push('$typeId: UUID');
                callArgs.push('typeId: $typeId');
            }
            if (filter) {
                argDefs.push('$filter: EntityFilter');
                callArgs.push('filter: $filter');
            }
            const gql = `
          query ListEntities(${argDefs.join(', ')}) {
            entitiesConnection(${callArgs.join(', ')}) {
              totalCount
              nodes {
                ${ENTITY_SUMMARY_FIELDS}
                createdAt
              }
            }
          }
        `;
            const variables = { first: limit, offset: skip };
            if (spaceId)
                variables.spaceId = spaceId;
            if (typeId)
                variables.typeId = typeId;
            if (filter)
                variables.filter = filter;
            const data = await query(gql, variables);
            const entities = (data.entitiesConnection.nodes ?? []).map((e) => dashlessIds(e, 'id', 'typeIds', 'spaceIds'));
            return ok({ entities, totalCount: data.entitiesConnection.totalCount });
        }
        catch (error) {
            return err(error);
        }
    });
    // ── 4. get_space ───────────────────────────────────────────────────
    server.tool('get_space', 'Get details of a single space by ID, including editor/member counts and recent proposals.', {
        id: z.string().describe('Space ID (dashless hex)'),
    }, { readOnlyHint: true }, async ({ id }) => {
        try {
            const uuid = normalizeToUUID(id);
            const gql = `
          query GetSpace($id: UUID!) {
            space(id: $id) {
              id
              type
              address
              editors { totalCount }
              members { totalCount }
              proposalsConnection(first: 10, orderBy: [CREATED_AT_DESC]) {
                totalCount
                nodes {
                  id
                  name
                  votingMode
                  startTime
                  endTime
                  executedAt
                  createdAt
                  yesCount
                  noCount
                  abstainCount
                }
              }
            }
          }
        `;
            const data = await query(gql, { id: uuid });
            if (!data.space) {
                return err(`Space not found: ${id}`);
            }
            return ok(dashlessDeep(data.space));
        }
        catch (error) {
            return err(error);
        }
    });
    // ── 5. list_spaces ─────────────────────────────────────────────────
    server.tool('list_spaces', 'List spaces with optional type filter. Supports pagination.', {
        first: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
        offset: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
        type: z.enum(['PERSONAL', 'PUBLIC', 'DAO']).optional().describe('Filter by space type (PUBLIC maps to DAO)'),
    }, { readOnlyHint: true }, async ({ first, offset, type }) => {
        try {
            const limit = first ?? 20;
            const skip = offset ?? 0;
            // Map PUBLIC -> DAO for user-friendliness
            const apiType = type === 'PUBLIC' ? 'DAO' : type;
            const hasFilter = !!apiType;
            const gql = `
          query ListSpaces($first: Int, $offset: Int${hasFilter ? ', $filter: SpaceFilter' : ''}) {
            spacesConnection${hasFilter ? '(first: $first, offset: $offset, filter: $filter)' : '(first: $first, offset: $offset)'} {
              totalCount
              nodes {
                id
                type
                address
                editors { totalCount }
                members { totalCount }
              }
            }
          }
        `;
            const variables = { first: limit, offset: skip };
            if (hasFilter) {
                variables.filter = { type: { is: apiType } };
            }
            const data = await query(gql, variables);
            const spaces = (data.spacesConnection.nodes ?? []).map((s) => dashlessIds(s, 'id'));
            return ok({ spaces, totalCount: data.spacesConnection.totalCount });
        }
        catch (error) {
            return err(error);
        }
    });
    // ── 6. get_type ────────────────────────────────────────────────────
    server.tool('get_type', 'Get details of a type definition by ID. Types are entities, so this returns the entity with its values and properties.', {
        id: z.string().describe('Type ID (dashless hex)'),
    }, { readOnlyHint: true }, async ({ id }) => {
        try {
            const uuid = normalizeToUUID(id);
            const gql = `
          query GetType($id: UUID!) {
            entity(id: $id) {
              ${ENTITY_SUMMARY_FIELDS}
              createdAt
              updatedAt
              valuesList {
                ${VALUE_FIELDS}
              }
              relationsList {
                ${RELATION_FIELDS}
              }
              types {
                id
                name
              }
            }
          }
        `;
            const data = await query(gql, { id: uuid });
            if (!data.entity) {
                return err(`Type not found: ${id}`);
            }
            return ok(dashlessDeep(data.entity));
        }
        catch (error) {
            return err(error);
        }
    });
    // ── 7. list_types ──────────────────────────────────────────────────
    server.tool('list_types', 'List type definitions in a specific space. Returns type entities with basic metadata.', {
        spaceId: z.string().describe('Space ID (dashless hex)'),
        first: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
        offset: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
    }, { readOnlyHint: true }, async ({ spaceId, first, offset }) => {
        try {
            const uuid = normalizeToUUID(spaceId);
            const limit = first ?? 20;
            const skip = offset ?? 0;
            const gql = `
          query ListTypes($spaceId: UUID!, $first: Int, $offset: Int) {
            typesList(spaceId: $spaceId, first: $first, offset: $offset) {
              ${ENTITY_SUMMARY_FIELDS}
            }
          }
        `;
            const data = await query(gql, {
                spaceId: uuid,
                first: limit,
                offset: skip,
            });
            const types = (data.typesList ?? []).map((t) => dashlessIds(t, 'id', 'typeIds', 'spaceIds'));
            return ok({ types, totalCount: types.length });
        }
        catch (error) {
            return err(error);
        }
    });
    // ── 8. get_proposals ───────────────────────────────────────────────
    server.tool('get_proposals', 'List proposals for a specific space, ordered by creation time (newest first).', {
        spaceId: z.string().describe('Space ID (dashless hex)'),
        first: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
        offset: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
    }, { readOnlyHint: true }, async ({ spaceId, first, offset }) => {
        try {
            const uuid = normalizeToUUID(spaceId);
            const limit = first ?? 20;
            const skip = offset ?? 0;
            const gql = `
          query GetProposals($first: Int, $offset: Int, $filter: ProposalFilter) {
            proposalsConnection(first: $first, offset: $offset, filter: $filter, orderBy: [CREATED_AT_DESC]) {
              totalCount
              nodes {
                id
                name
                spaceId
                proposedBy
                votingMode
                startTime
                endTime
                quorum
                threshold
                executedAt
                createdAt
                createdAtBlock
                yesCount
                noCount
                abstainCount
                proposalVotesConnection { totalCount }
              }
            }
          }
        `;
            const data = await query(gql, {
                first: limit,
                offset: skip,
                filter: { spaceId: { is: uuid } },
            });
            const proposals = (data.proposalsConnection.nodes ?? []).map((p) => dashlessIds(p, 'id', 'spaceId'));
            return ok({ proposals, totalCount: data.proposalsConnection.totalCount });
        }
        catch (error) {
            return err(error);
        }
    });
    // ── 9. get_proposal ────────────────────────────────────────────────
    server.tool('get_proposal', 'Get full details of a single proposal by ID, including vote breakdown.', {
        id: z.string().describe('Proposal ID (dashless hex)'),
    }, { readOnlyHint: true }, async ({ id }) => {
        try {
            const uuid = normalizeToUUID(id);
            const gql = `
          query GetProposal($id: UUID!) {
            proposal(id: $id) {
              id
              name
              spaceId
              proposedBy
              votingMode
              startTime
              endTime
              quorum
              threshold
              executedAt
              createdAt
              createdAtBlock
              yesCount
              noCount
              abstainCount
              proposalVotesConnection {
                totalCount
                nodes {
                  voterId
                  vote
                  createdAt
                  createdAtBlock
                }
              }
            }
          }
        `;
            const data = await query(gql, { id: uuid });
            if (!data.proposal) {
                return err(`Proposal not found: ${id}`);
            }
            return ok(dashlessDeep(data.proposal));
        }
        catch (error) {
            return err(error);
        }
    });
    // ── 10. get_proposal_votes ─────────────────────────────────────────
    server.tool('get_proposal_votes', 'List votes for a specific proposal. Returns voter IDs, vote direction, and timestamps.', {
        proposalId: z.string().describe('Proposal ID (dashless hex)'),
        first: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
        offset: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
    }, { readOnlyHint: true }, async ({ proposalId, first, offset }) => {
        try {
            const uuid = normalizeToUUID(proposalId);
            const limit = first ?? 20;
            const skip = offset ?? 0;
            const gql = `
          query GetProposalVotes($first: Int, $offset: Int, $filter: ProposalVoteFilter) {
            proposalVotesConnection(first: $first, offset: $offset, filter: $filter) {
              totalCount
              nodes {
                proposalId
                voterId
                spaceId
                vote
                createdAt
                createdAtBlock
              }
            }
          }
        `;
            const data = await query(gql, {
                first: limit,
                offset: skip,
                filter: { proposalId: { is: uuid } },
            });
            const votes = (data.proposalVotesConnection.nodes ?? []).map((v) => dashlessIds(v, 'proposalId', 'voterId', 'spaceId'));
            return ok({ votes, totalCount: data.proposalVotesConnection.totalCount });
        }
        catch (error) {
            return err(error);
        }
    });
    // ── 11. get_page_content ────────────────────────────────────────────
    server.tool('get_page_content', 'Get the ordered content blocks of a page entity. Returns text (Markdown) and image blocks in position order.', {
        entityId: z.string().describe('Entity ID (dashless hex) of the page to fetch content blocks for'),
    }, { readOnlyHint: true }, async ({ entityId }) => {
        try {
            const uuid = normalizeToUUID(entityId);
            // Step 1: Fetch entity with its relations
            const entityGql = `
          query GetEntity($id: UUID!) {
            entity(id: $id) {
              id
              name
              relationsList {
                id
                toEntityId
                typeId
                position
                typeEntity { id name }
                toEntity { id name }
              }
            }
          }
        `;
            const entityData = await query(entityGql, { id: uuid });
            if (!entityData.entity) {
                return err(`Entity not found: ${entityId}`);
            }
            // Step 2: Filter for Blocks relations
            const blocks = entityData.entity.relationsList.filter((r) => r.typeEntity?.name === 'Blocks');
            if (blocks.length === 0) {
                return ok({ entityId, name: entityData.entity.name, blocks: [] });
            }
            // Step 3: Sort by position (lexicographic)
            blocks.sort((a, b) => (a.position ?? '').localeCompare(b.position ?? ''));
            // Step 4: Batch-query all block entities using GraphQL aliases
            const aliasedQueries = blocks
                .map((b, i) => {
                const blockUuid = normalizeToUUID(b.toEntityId);
                return `block_${i}: entity(id: "${blockUuid}") { id name valuesList { id text property { name } } }`;
            })
                .join('\n          ');
            const batchGql = `query BatchBlocks { ${aliasedQueries} }`;
            const batchData = await query(batchGql);
            // Step 5 & 6: Extract content from each block
            const contentBlocks = blocks.map((b, i) => {
                const blockEntity = batchData[`block_${i}`];
                if (!blockEntity) {
                    return {
                        position: b.position,
                        type: 'text',
                        content: null,
                        entityId: toDashlessUUID(b.toEntityId),
                        name: b.toEntity?.name ?? null,
                    };
                }
                const mdValue = blockEntity.valuesList.find((v) => v.property?.name === 'Markdown content');
                if (mdValue?.text) {
                    return {
                        position: b.position,
                        type: 'text',
                        content: mdValue.text,
                        entityId: toDashlessUUID(blockEntity.id),
                        name: blockEntity.name,
                    };
                }
                // No Markdown content — check if it's an image block
                return {
                    position: b.position,
                    type: 'image',
                    content: null,
                    entityId: toDashlessUUID(blockEntity.id),
                    name: blockEntity.name,
                };
            });
            return ok({ entityId, name: entityData.entity.name, blocks: contentBlocks });
        }
        catch (error) {
            return err(error);
        }
    });
}
//# sourceMappingURL=read.js.map