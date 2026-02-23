/**
 * Stateless read/query MCP tools for the Geo knowledge graph.
 * All queries go through the GraphQL API — no session state needed.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, normalizeToUUID, toDashlessUUID } from '../api/client.js';
import { ok, err } from './helpers.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Convert selected fields of an object from dashed UUIDs to dashless hex. */
function dashlessIds<T extends Record<string, unknown>>(obj: T, ...fields: string[]): T {
  const out = { ...obj };
  for (const field of fields) {
    const val = out[field];
    if (typeof val === 'string' && val.includes('-')) {
      (out as Record<string, unknown>)[field] = toDashlessUUID(val);
    } else if (Array.isArray(val)) {
      (out as Record<string, unknown>)[field] = val.map((v) =>
        typeof v === 'string' && v.includes('-') ? toDashlessUUID(v) : v,
      );
    }
  }
  return out;
}

/** Recursively convert all UUID-looking string values in an object to dashless. */
function dashlessDeep(obj: unknown): unknown {
  if (typeof obj === 'string') {
    // Match dashed UUID pattern
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(obj)) {
      return toDashlessUUID(obj);
    }
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(dashlessDeep);
  if (obj !== null && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
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
  string
  language
  unit
  boolean
  number
  point
  time
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
`;

// ── Registration ─────────────────────────────────────────────────────

export function registerReadTools(server: McpServer): void {
  // ── 1. search_entities ─────────────────────────────────────────────
  server.tool(
    'search_entities',
    'Full-text search for entities in the Geo knowledge graph. Returns matching entities with basic metadata.',
    {
      query: z.string().describe('Search query string'),
      spaceId: z.string().optional().describe('Filter to a specific space (dashless hex ID)'),
      first: z.number().int().min(1).max(100).optional().describe('Max results to return (default 20)'),
      offset: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
      typeIds: z.array(z.string()).optional().describe('Client-side filter: only return entities matching these type IDs'),
    },
    async ({ query: searchQuery, spaceId, first, offset, typeIds }) => {
      try {
        const limit = first ?? 20;
        const skip = offset ?? 0;

        const gql = `
          query Search($query: String!, $first: Int, $offset: Int) {
            search(query: $query, first: $first, offset: $offset) {
              ${ENTITY_SUMMARY_FIELDS}
            }
          }
        `;

        const data = await query<{ search: Array<Record<string, unknown>> }>(gql, {
          query: searchQuery,
          first: limit,
          offset: skip,
        });

        let results = (data.search ?? []).map((e) =>
          dashlessIds(e, 'id', 'typeIds', 'spaceIds'),
        );

        // Client-side type filter
        if (typeIds && typeIds.length > 0) {
          const filterSet = new Set(typeIds.map((id) => id.replace(/-/g, '').toLowerCase()));
          results = results.filter((e) => {
            const entityTypes = e.typeIds as string[] | undefined;
            return entityTypes?.some((t) => filterSet.has(String(t).toLowerCase()));
          });
        }

        // Client-side space filter
        if (spaceId) {
          const normalizedSpaceId = spaceId.replace(/-/g, '').toLowerCase();
          results = results.filter((e) => {
            const entitySpaces = e.spaceIds as string[] | undefined;
            return entitySpaces?.some((s) => String(s).toLowerCase() === normalizedSpaceId);
          });
        }

        return ok({ results, totalCount: results.length });
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── 2. get_entity ──────────────────────────────────────────────────
  server.tool(
    'get_entity',
    'Get full details of a single entity by ID, including values, relations, backlinks, and types.',
    {
      id: z.string().describe('Entity ID (dashless hex)'),
    },
    async ({ id }) => {
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

        const data = await query<{ entity: Record<string, unknown> | null }>(gql, { id: uuid });
        if (!data.entity) {
          return err(`Entity not found: ${id}`);
        }

        return ok(dashlessDeep(data.entity));
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── 3. list_entities ───────────────────────────────────────────────
  server.tool(
    'list_entities',
    'List entities with optional filters for space, type, and name. Supports pagination.',
    {
      first: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
      offset: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
      spaceIds: z.array(z.string()).optional().describe('Filter by space IDs (dashless hex)'),
      typeIds: z.array(z.string()).optional().describe('Filter by type IDs (dashless hex)'),
      name: z.string().optional().describe('Case-insensitive name substring filter'),
    },
    async ({ first, offset, spaceIds, typeIds, name }) => {
      try {
        const limit = first ?? 20;
        const skip = offset ?? 0;

        // Build filter object
        const filter: Record<string, unknown> = {};
        if (name) {
          filter.name = { includesInsensitive: name };
        }
        if (spaceIds && spaceIds.length > 0) {
          filter.spaceIds = { contains: spaceIds.map(normalizeToUUID) };
        }
        if (typeIds && typeIds.length > 0) {
          filter.typeIds = { contains: typeIds.map(normalizeToUUID) };
        }

        const hasFilter = Object.keys(filter).length > 0;

        const gql = `
          query ListEntities($first: Int, $offset: Int${hasFilter ? ', $filter: EntityFilter' : ''}) {
            entitiesConnection${hasFilter ? '(first: $first, offset: $offset, filter: $filter)' : '(first: $first, offset: $offset)'} {
              totalCount
              nodes {
                ${ENTITY_SUMMARY_FIELDS}
                createdAt
              }
            }
          }
        `;

        const variables: Record<string, unknown> = { first: limit, offset: skip };
        if (hasFilter) variables.filter = filter;

        const data = await query<{
          entitiesConnection: { totalCount: number; nodes: Array<Record<string, unknown>> };
        }>(gql, variables);

        const entities = (data.entitiesConnection.nodes ?? []).map((e) =>
          dashlessIds(e, 'id', 'typeIds', 'spaceIds'),
        );

        return ok({ entities, totalCount: data.entitiesConnection.totalCount });
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── 4. get_space ───────────────────────────────────────────────────
  server.tool(
    'get_space',
    'Get details of a single space by ID, including editor/member counts and recent proposals.',
    {
      id: z.string().describe('Space ID (dashless hex)'),
    },
    async ({ id }) => {
      try {
        const uuid = normalizeToUUID(id);

        const gql = `
          query GetSpace($id: UUID!) {
            space(id: $id) {
              id
              type
              daoAddress
              spaceAddress
              mainVotingAddress
              membershipAddress
              personalAddress
              editorsConnection { totalCount }
              membersConnection { totalCount }
              proposalsConnection(first: 10, orderBy: [CREATED_AT_DESC]) {
                totalCount
                nodes {
                  id
                  votingMode
                  startTime
                  endTime
                  createdAt
                }
              }
            }
          }
        `;

        const data = await query<{ space: Record<string, unknown> | null }>(gql, { id: uuid });
        if (!data.space) {
          return err(`Space not found: ${id}`);
        }

        return ok(dashlessDeep(data.space));
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── 5. list_spaces ─────────────────────────────────────────────────
  server.tool(
    'list_spaces',
    'List spaces with optional type filter. Supports pagination.',
    {
      first: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
      offset: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
      type: z.enum(['PERSONAL', 'PUBLIC', 'DAO']).optional().describe('Filter by space type (PUBLIC maps to DAO)'),
    },
    async ({ first, offset, type }) => {
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
                daoAddress
                spaceAddress
                editorsConnection { totalCount }
                membersConnection { totalCount }
              }
            }
          }
        `;

        const variables: Record<string, unknown> = { first: limit, offset: skip };
        if (hasFilter) {
          variables.filter = { type: { is: apiType } };
        }

        const data = await query<{
          spacesConnection: { totalCount: number; nodes: Array<Record<string, unknown>> };
        }>(gql, variables);

        const spaces = (data.spacesConnection.nodes ?? []).map((s) =>
          dashlessIds(s, 'id'),
        );

        return ok({ spaces, totalCount: data.spacesConnection.totalCount });
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── 6. get_type ────────────────────────────────────────────────────
  server.tool(
    'get_type',
    'Get details of a type definition by ID. Types are entities, so this returns the entity with its values and properties.',
    {
      id: z.string().describe('Type ID (dashless hex)'),
    },
    async ({ id }) => {
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

        const data = await query<{ entity: Record<string, unknown> | null }>(gql, { id: uuid });
        if (!data.entity) {
          return err(`Type not found: ${id}`);
        }

        return ok(dashlessDeep(data.entity));
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── 7. list_types ──────────────────────────────────────────────────
  server.tool(
    'list_types',
    'List type definitions in a specific space. Returns type entities with basic metadata.',
    {
      spaceId: z.string().describe('Space ID (dashless hex)'),
      first: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
      offset: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
    },
    async ({ spaceId, first, offset }) => {
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

        const data = await query<{ typesList: Array<Record<string, unknown>> }>(gql, {
          spaceId: uuid,
          first: limit,
          offset: skip,
        });

        const types = (data.typesList ?? []).map((t) =>
          dashlessIds(t, 'id', 'typeIds', 'spaceIds'),
        );

        return ok({ types, totalCount: types.length });
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── 8. get_proposals ───────────────────────────────────────────────
  server.tool(
    'get_proposals',
    'List proposals for a specific space, ordered by creation time (newest first).',
    {
      spaceId: z.string().describe('Space ID (dashless hex)'),
      first: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
      offset: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
    },
    async ({ spaceId, first, offset }) => {
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
                proposalVotesConnection { totalCount }
              }
            }
          }
        `;

        const data = await query<{
          proposalsConnection: { totalCount: number; nodes: Array<Record<string, unknown>> };
        }>(gql, {
          first: limit,
          offset: skip,
          filter: { spaceId: { is: uuid } },
        });

        const proposals = (data.proposalsConnection.nodes ?? []).map((p) =>
          dashlessIds(p, 'id', 'spaceId'),
        );

        return ok({ proposals, totalCount: data.proposalsConnection.totalCount });
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── 9. get_proposal ────────────────────────────────────────────────
  server.tool(
    'get_proposal',
    'Get full details of a single proposal by ID, including vote breakdown.',
    {
      id: z.string().describe('Proposal ID (dashless hex)'),
    },
    async ({ id }) => {
      try {
        const uuid = normalizeToUUID(id);

        const gql = `
          query GetProposal($id: UUID!) {
            proposal(id: $id) {
              id
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

        const data = await query<{ proposal: Record<string, unknown> | null }>(gql, { id: uuid });
        if (!data.proposal) {
          return err(`Proposal not found: ${id}`);
        }

        return ok(dashlessDeep(data.proposal));
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── 10. get_proposal_votes ─────────────────────────────────────────
  server.tool(
    'get_proposal_votes',
    'List votes for a specific proposal. Returns voter IDs, vote direction, and timestamps.',
    {
      proposalId: z.string().describe('Proposal ID (dashless hex)'),
      first: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
      offset: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
    },
    async ({ proposalId, first, offset }) => {
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

        const data = await query<{
          proposalVotesConnection: { totalCount: number; nodes: Array<Record<string, unknown>> };
        }>(gql, {
          first: limit,
          offset: skip,
          filter: { proposalId: { is: uuid } },
        });

        const votes = (data.proposalVotesConnection.nodes ?? []).map((v) =>
          dashlessIds(v, 'proposalId', 'voterId', 'spaceId'),
        );

        return ok({ votes, totalCount: data.proposalVotesConnection.totalCount });
      } catch (error) {
        return err(error);
      }
    },
  );
}
