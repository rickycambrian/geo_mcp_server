import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the GraphQL client before importing read tools
vi.mock('../api/client.js', () => ({
  query: vi.fn(),
  normalizeToUUID: vi.fn((id: string) => {
    const hex = id.replace(/-/g, '').toLowerCase();
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }),
  toDashlessUUID: vi.fn((dashed: string) => dashed.replace(/-/g, '').toLowerCase()),
}));

import { query as mockQuery } from '../api/client.js';

// Helper to capture tool handlers from server.tool registrations
function captureTools() {
  const tools: Record<string, { handler: Function; schema: unknown }> = {};
  const mockServer = {
    tool: (name: string, _desc: string, schema: unknown, ...rest: unknown[]) => {
      const handler = rest.length > 1 ? rest[1] as Function : rest[0] as Function;
      tools[name] = { handler, schema };
    },
  };
  return { mockServer, tools };
}

describe('read tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Dynamically import to pick up mocks
  async function setupTools() {
    const { registerReadTools } = await import('./read.js');
    const { mockServer, tools } = captureTools();
    registerReadTools(mockServer as any);
    return tools;
  }

  describe('search_entities', () => {
    it('queries GraphQL and returns dashless IDs', async () => {
      const tools = await setupTools();
      (mockQuery as any).mockResolvedValue({
        search: [
          {
            id: '96f859ef-a1ca-4b22-9372-c86ad58b694b',
            name: 'Test Entity',
            description: 'A test',
            typeIds: ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'],
            spaceIds: ['11111111-2222-3333-4444-555555555555'],
          },
        ],
      });

      const result = await tools.search_entities.handler({ query: 'test', first: 10, offset: 0 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].id).toBe('96f859efa1ca4b229372c86ad58b694b');
      expect(parsed.results[0].typeIds[0]).toBe('aaaaaaaabbbbccccddddeeeeeeeeeeee');
    });

    it('filters by typeIds client-side', async () => {
      const tools = await setupTools();
      (mockQuery as any).mockResolvedValue({
        search: [
          { id: 'aa-bb-cc-dd-ee', name: 'A', typeIds: ['type1'], spaceIds: [] },
          { id: 'ff-00-11-22-33', name: 'B', typeIds: ['type2'], spaceIds: [] },
        ],
      });

      const result = await tools.search_entities.handler({
        query: 'test',
        typeIds: ['type1'],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].name).toBe('A');
    });
  });

  describe('get_entity', () => {
    it('returns entity details with dashless IDs', async () => {
      const tools = await setupTools();
      (mockQuery as any).mockResolvedValue({
        entity: {
          id: '96f859ef-a1ca-4b22-9372-c86ad58b694b',
          name: 'Test',
          description: 'desc',
          typeIds: [],
          spaceIds: [],
          valuesList: [],
          relationsList: [],
          relationsWhereEntityList: [],
          types: [],
          createdAt: '2024-01-01',
          updatedAt: '2024-01-02',
        },
      });

      const result = await tools.get_entity.handler({ id: '96f859efa1ca4b229372c86ad58b694b' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe('96f859efa1ca4b229372c86ad58b694b');
      expect(parsed.name).toBe('Test');
    });

    it('returns error for not found', async () => {
      const tools = await setupTools();
      (mockQuery as any).mockResolvedValue({ entity: null });

      const result = await tools.get_entity.handler({ id: '96f859efa1ca4b229372c86ad58b694b' });
      expect(result.isError).toBe(true);
    });
  });

  describe('list_entities', () => {
    it('passes filters to GraphQL', async () => {
      const tools = await setupTools();
      (mockQuery as any).mockResolvedValue({
        entitiesConnection: {
          totalCount: 1,
          nodes: [{ id: 'aa-bb-cc-dd-ee', name: 'Found', typeIds: [], spaceIds: [], createdAt: '2024' }],
        },
      });

      const result = await tools.list_entities.handler({ name: 'Found', first: 5 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.totalCount).toBe(1);
      expect(parsed.entities).toHaveLength(1);
    });
  });

  describe('get_space', () => {
    it('returns space with nested counts', async () => {
      const tools = await setupTools();
      (mockQuery as any).mockResolvedValue({
        space: {
          id: '11111111-2222-3333-4444-555555555555',
          type: 'DAO',
          daoAddress: '0xabc',
          spaceAddress: '0xdef',
          mainVotingAddress: '0x123',
          membershipAddress: '0x456',
          personalAddress: null,
          editorsConnection: { totalCount: 3 },
          membersConnection: { totalCount: 10 },
          proposalsConnection: { totalCount: 5, nodes: [] },
        },
      });

      const result = await tools.get_space.handler({ id: '11111111222233334444555555555555' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.type).toBe('DAO');
      expect(parsed.editorsConnection.totalCount).toBe(3);
    });

    it('returns error for not found', async () => {
      const tools = await setupTools();
      (mockQuery as any).mockResolvedValue({ space: null });

      const result = await tools.get_space.handler({ id: '11111111222233334444555555555555' });
      expect(result.isError).toBe(true);
    });
  });

  describe('list_spaces', () => {
    it('maps PUBLIC to DAO', async () => {
      const tools = await setupTools();
      (mockQuery as any).mockResolvedValue({
        spacesConnection: { totalCount: 0, nodes: [] },
      });

      await tools.list_spaces.handler({ type: 'PUBLIC' });
      const call = (mockQuery as any).mock.calls[0];
      expect(call[1].filter.type.is).toBe('DAO');
    });
  });

  describe('get_proposals', () => {
    it('queries proposals for space', async () => {
      const tools = await setupTools();
      (mockQuery as any).mockResolvedValue({
        proposalsConnection: {
          totalCount: 2,
          nodes: [
            { id: 'aa-bb-cc-dd-ee', spaceId: '11-22-33-44-55', votingMode: 'FAST', proposalVotesConnection: { totalCount: 1 } },
          ],
        },
      });

      const result = await tools.get_proposals.handler({ spaceId: 'aabbccddeeff0011aabbccddeeff0011' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.totalCount).toBe(2);
    });
  });

  describe('get_proposal', () => {
    it('returns proposal with votes', async () => {
      const tools = await setupTools();
      (mockQuery as any).mockResolvedValue({
        proposal: {
          id: 'aa-bb-cc-dd-ee',
          spaceId: '11-22-33-44-55',
          votingMode: 'FAST',
          proposalVotesConnection: { totalCount: 0, nodes: [] },
        },
      });

      const result = await tools.get_proposal.handler({ id: 'aabbccddeeff0011aabbccddeeff0011' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.votingMode).toBe('FAST');
    });
  });

  describe('get_proposal_votes', () => {
    it('returns votes for proposal', async () => {
      const tools = await setupTools();
      (mockQuery as any).mockResolvedValue({
        proposalVotesConnection: {
          totalCount: 1,
          nodes: [
            { proposalId: 'aa-bb-cc-dd-ee', voterId: '11-22-33-44-55', spaceId: 'ff-00-11-22-33', vote: 'FOR', createdAt: '2024' },
          ],
        },
      });

      const result = await tools.get_proposal_votes.handler({ proposalId: 'aabbccddeeff0011aabbccddeeff0011' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.votes).toHaveLength(1);
      expect(parsed.totalCount).toBe(1);
    });
  });

  describe('get_page_content', () => {
    it('returns ordered text blocks for an entity', async () => {
      const tools = await setupTools();

      // First call: entity query returning relations with two Blocks
      (mockQuery as any).mockResolvedValueOnce({
        entity: {
          id: 'aabbccdd-1122-3344-5566-778899aabbcc',
          name: 'Test Page',
          relationsList: [
            {
              id: 'rel-1',
              toEntityId: '11111111-1111-1111-1111-111111111111',
              typeId: 'blocks-type-id',
              position: 'b',
              typeEntity: { id: 'blocks-type-id', name: 'Blocks' },
              toEntity: { id: '11111111-1111-1111-1111-111111111111', name: 'Block B' },
            },
            {
              id: 'rel-2',
              toEntityId: '22222222-2222-2222-2222-222222222222',
              typeId: 'blocks-type-id',
              position: 'a',
              typeEntity: { id: 'blocks-type-id', name: 'Blocks' },
              toEntity: { id: '22222222-2222-2222-2222-222222222222', name: 'Block A' },
            },
          ],
        },
      });

      // Second call: batch query for block entities
      (mockQuery as any).mockResolvedValueOnce({
        block_0: {
          id: '22222222-2222-2222-2222-222222222222',
          name: 'Block A',
          valuesList: [
            { id: 'v1', text: '# Introduction\nWelcome to Geo.', property: { name: 'Markdown content' } },
          ],
        },
        block_1: {
          id: '11111111-1111-1111-1111-111111111111',
          name: 'Block B',
          valuesList: [
            { id: 'v2', text: '## Chapter 1\nThis is the first chapter.', property: { name: 'Markdown content' } },
          ],
        },
      });

      const result = await tools.get_page_content.handler({ entityId: 'aabbccdd11223344556677889 9aabbcc'.replace(/ /g, '') });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.name).toBe('Test Page');
      expect(parsed.blocks).toHaveLength(2);
      // Sorted by position: 'a' before 'b'
      expect(parsed.blocks[0].position).toBe('a');
      expect(parsed.blocks[0].type).toBe('text');
      expect(parsed.blocks[0].content).toBe('# Introduction\nWelcome to Geo.');
      expect(parsed.blocks[0].name).toBe('Block A');

      expect(parsed.blocks[1].position).toBe('b');
      expect(parsed.blocks[1].type).toBe('text');
      expect(parsed.blocks[1].content).toBe('## Chapter 1\nThis is the first chapter.');
      expect(parsed.blocks[1].name).toBe('Block B');
    });

    it('returns mixed text and image blocks', async () => {
      const tools = await setupTools();

      (mockQuery as any).mockResolvedValueOnce({
        entity: {
          id: 'aabbccdd-1122-3344-5566-778899aabbcc',
          name: 'Page with Images',
          relationsList: [
            {
              id: 'rel-1',
              toEntityId: '11111111-1111-1111-1111-111111111111',
              typeId: 'blocks-type-id',
              position: 'a',
              typeEntity: { id: 'blocks-type-id', name: 'Blocks' },
              toEntity: { id: '11111111-1111-1111-1111-111111111111', name: 'Text Block' },
            },
            {
              id: 'rel-2',
              toEntityId: '22222222-2222-2222-2222-222222222222',
              typeId: 'blocks-type-id',
              position: 'b',
              typeEntity: { id: 'blocks-type-id', name: 'Blocks' },
              toEntity: { id: '22222222-2222-2222-2222-222222222222', name: 'Image Block' },
            },
            {
              id: 'rel-3',
              toEntityId: '33333333-3333-3333-3333-333333333333',
              typeId: 'blocks-type-id',
              position: 'c',
              typeEntity: { id: 'blocks-type-id', name: 'Blocks' },
              toEntity: { id: '33333333-3333-3333-3333-333333333333', name: 'Another Text Block' },
            },
          ],
        },
      });

      (mockQuery as any).mockResolvedValueOnce({
        block_0: {
          id: '11111111-1111-1111-1111-111111111111',
          name: 'Text Block',
          valuesList: [
            { id: 'v1', text: 'Some markdown text.', property: { name: 'Markdown content' } },
          ],
        },
        block_1: {
          id: '22222222-2222-2222-2222-222222222222',
          name: 'Image Block',
          valuesList: [
            { id: 'v2', text: null, property: { name: 'Image URL' } },
          ],
        },
        block_2: {
          id: '33333333-3333-3333-3333-333333333333',
          name: 'Another Text Block',
          valuesList: [
            { id: 'v3', text: 'More markdown.', property: { name: 'Markdown content' } },
          ],
        },
      });

      const result = await tools.get_page_content.handler({ entityId: 'aabbccdd112233445566778899aabbcc' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.blocks).toHaveLength(3);
      expect(parsed.blocks[0].type).toBe('text');
      expect(parsed.blocks[0].content).toBe('Some markdown text.');

      expect(parsed.blocks[1].type).toBe('image');
      expect(parsed.blocks[1].content).toBeNull();

      expect(parsed.blocks[2].type).toBe('text');
      expect(parsed.blocks[2].content).toBe('More markdown.');
    });

    it('returns empty blocks array when entity has no Blocks relations', async () => {
      const tools = await setupTools();

      (mockQuery as any).mockResolvedValueOnce({
        entity: {
          id: 'aabbccdd-1122-3344-5566-778899aabbcc',
          name: 'Empty Page',
          relationsList: [
            {
              id: 'rel-1',
              toEntityId: '11111111-1111-1111-1111-111111111111',
              typeId: 'some-type-id',
              position: 'a',
              typeEntity: { id: 'some-type-id', name: 'SomeOtherRelation' },
              toEntity: { id: '11111111-1111-1111-1111-111111111111', name: 'Not a Block' },
            },
          ],
        },
      });

      const result = await tools.get_page_content.handler({ entityId: 'aabbccdd112233445566778899aabbcc' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.name).toBe('Empty Page');
      expect(parsed.blocks).toEqual([]);
      // Should not have made a second query for batch blocks
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('returns block with null content when block entity has no Markdown content', async () => {
      const tools = await setupTools();

      (mockQuery as any).mockResolvedValueOnce({
        entity: {
          id: 'aabbccdd-1122-3344-5566-778899aabbcc',
          name: 'Page with Missing Content',
          relationsList: [
            {
              id: 'rel-1',
              toEntityId: '11111111-1111-1111-1111-111111111111',
              typeId: 'blocks-type-id',
              position: 'a',
              typeEntity: { id: 'blocks-type-id', name: 'Blocks' },
              toEntity: { id: '11111111-1111-1111-1111-111111111111', name: 'Block Without MD' },
            },
          ],
        },
      });

      // Block entity exists but has no valuesList entries with "Markdown content"
      (mockQuery as any).mockResolvedValueOnce({
        block_0: {
          id: '11111111-1111-1111-1111-111111111111',
          name: 'Block Without MD',
          valuesList: [
            { id: 'v1', text: 'some value', property: { name: 'Description' } },
          ],
        },
      });

      const result = await tools.get_page_content.handler({ entityId: 'aabbccdd112233445566778899aabbcc' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.blocks).toHaveLength(1);
      expect(parsed.blocks[0].type).toBe('image');
      expect(parsed.blocks[0].content).toBeNull();
      expect(parsed.blocks[0].entityId).toBe('11111111111111111111111111111111');
      expect(parsed.blocks[0].name).toBe('Block Without MD');
    });

    it('returns error when entity is not found', async () => {
      const tools = await setupTools();

      (mockQuery as any).mockResolvedValueOnce({ entity: null });

      const result = await tools.get_page_content.handler({ entityId: 'aabbccdd112233445566778899aabbcc' });
      expect(result.isError).toBe(true);
    });

    it('handles block entity not found in batch query', async () => {
      const tools = await setupTools();

      (mockQuery as any).mockResolvedValueOnce({
        entity: {
          id: 'aabbccdd-1122-3344-5566-778899aabbcc',
          name: 'Page with Missing Block',
          relationsList: [
            {
              id: 'rel-1',
              toEntityId: '11111111-1111-1111-1111-111111111111',
              typeId: 'blocks-type-id',
              position: 'a',
              typeEntity: { id: 'blocks-type-id', name: 'Blocks' },
              toEntity: { id: '11111111-1111-1111-1111-111111111111', name: 'Missing Block' },
            },
          ],
        },
      });

      // Batch query returns null for the block (entity deleted or inaccessible)
      (mockQuery as any).mockResolvedValueOnce({
        block_0: null,
      });

      const result = await tools.get_page_content.handler({ entityId: 'aabbccdd112233445566778899aabbcc' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.blocks).toHaveLength(1);
      expect(parsed.blocks[0].type).toBe('text');
      expect(parsed.blocks[0].content).toBeNull();
      expect(parsed.blocks[0].name).toBe('Missing Block');
    });
  });
});
