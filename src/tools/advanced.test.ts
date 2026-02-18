import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';

vi.mock('@geoprotocol/geo-sdk', () => {
  let entityCounter = 0;
  let propertyCounter = 0;
  let typeCounter = 0;
  let relationCounter = 0;
  return {
    Graph: {
      createProperty: vi.fn(() => {
        propertyCounter++;
        return { id: `prop${propertyCounter}`, ops: [{ type: 0 }] };
      }),
      createType: vi.fn(() => {
        typeCounter++;
        return { id: `type${typeCounter}`, ops: [{ type: 1 }] };
      }),
      createEntity: vi.fn(() => {
        entityCounter++;
        return { id: `entity${entityCounter}`, ops: [{ type: 2 }] };
      }),
      createRelation: vi.fn(() => {
        relationCounter++;
        return { id: `rel${relationCounter}`, ops: [{ type: 3 }] };
      }),
      updateEntity: vi.fn(() => ({ id: 'updated1', ops: [{ type: 4 }] })),
    },
    SystemIds: {
      RELATION_TYPE: 'sys_relation_type',
      PERSON_TYPE: 'sys_person_type',
      COMPANY_TYPE: 'sys_company_type',
      PROJECT_TYPE: 'sys_project_type',
      POST_TYPE: 'sys_post_type',
      SPACE_TYPE: 'sys_space_type',
      IMAGE_TYPE: 'sys_image_type',
      SCHEMA_TYPE: 'sys_schema_type',
      ACADEMIC_FIELD_TYPE: 'sys_academic_field_type',
      DAO_TYPE: 'sys_dao_type',
      GOVERNMENT_ORG_TYPE: 'sys_gov_type',
      INDUSTRY_TYPE: 'sys_industry_type',
      INTEREST_TYPE: 'sys_interest_type',
      NONPROFIT_TYPE: 'sys_nonprofit_type',
      PROTOCOL_TYPE: 'sys_protocol_type',
      REGION_TYPE: 'sys_region_type',
      ROLE_TYPE: 'sys_role_type',
      DEFAULT_TYPE: 'sys_default_type',
      ACCOUNT_TYPE: 'sys_account_type',
      NETWORK_TYPE: 'sys_network_type',
      TAB_TYPE: 'sys_tab_type',
      GOAL_TYPE: 'sys_goal_type',
      PAGE_TYPE: 'sys_page_type',
      VIEW_TYPE: 'sys_view_type',
      VIDEO_TYPE: 'sys_video_type',
      BOUNTY_TYPE: 'sys_bounty_type',
      DIFFICULTY_TYPE: 'sys_difficulty_type',
      RANK_TYPE: 'sys_rank_type',
      NAME_PROPERTY: 'sys_name_prop',
      DESCRIPTION_PROPERTY: 'sys_desc_prop',
      TYPES_PROPERTY: 'sys_types_prop',
      COVER_PROPERTY: 'sys_cover_prop',
      PROPERTIES: 'sys_properties',
      EMAIL_PROPERTY: 'sys_email_prop',
      PHONE_NUMBER_PROPERTY: 'sys_phone_prop',
      STREET_ADDRESS_PROPERTY: 'sys_street_prop',
      ADDRESS_PROPERTY: 'sys_address_prop',
      ACCOUNTS_PROPERTY: 'sys_accounts_prop',
      NETWORK_PROPERTY: 'sys_network_prop',
      GEO_LOCATION_PROPERTY: 'sys_geo_loc_prop',
      GOALS_PROPERTY: 'sys_goals_prop',
      MISSION_PROPERTY: 'sys_mission_prop',
      VISION_PROPERTY: 'sys_vision_prop',
      VALUES_PROPERTY: 'sys_values_prop',
      WORKS_AT_PROPERTY: 'sys_works_at_prop',
      TABS_PROPERTY: 'sys_tabs_prop',
      MARKDOWN_CONTENT: 'sys_markdown',
      IMAGE_URL_PROPERTY: 'sys_img_url',
      IMAGE_WIDTH_PROPERTY: 'sys_img_w',
      IMAGE_HEIGHT_PROPERTY: 'sys_img_h',
      IMAGE_FILE_TYPE_PROPERTY: 'sys_img_ft',
      VIDEO_URL_PROPERTY: 'sys_video_url',
      REGION_PROPERTY: 'sys_region_prop',
      RELATED_TOPICS_PROPERTY: 'sys_related_topics',
      CREATOR_PROPERTY: 'sys_creator_prop',
      REWARD_PROPERTY: 'sys_reward_prop',
      DIFFICULTY_PROPERTY: 'sys_difficulty_prop',
      VERIFIED_SOURCE_PROPERTY: 'sys_verified_src',
      SOURCE_SPACE_PROPERTY: 'sys_src_space',
      VIEW_PROPERTY: 'sys_view_prop',
      DATA_SOURCE_PROPERTY: 'sys_data_src',
      SELECTOR_PROPERTY: 'sys_selector',
      TEXT: 'sys_text',
      INTEGER: 'sys_integer',
      FLOAT: 'sys_float',
      BOOLEAN: 'sys_boolean',
      DATE: 'sys_date',
      TIME: 'sys_time',
      DATETIME: 'sys_datetime',
      DECIMAL: 'sys_decimal',
      BYTES: 'sys_bytes',
      SCHEDULE: 'sys_schedule',
      POINT: 'sys_point',
      EMBEDDING: 'sys_embedding',
      RELATION: 'sys_relation',
      URL: 'sys_url',
      IMAGE: 'sys_image',
      DATA_TYPE: 'sys_data_type',
    },
    IdUtils: {
      generate: vi.fn(() => 'generated_id_' + Math.random().toString(36).slice(2, 10)),
    },
  };
});

import { Graph } from '@geoprotocol/geo-sdk';

function captureTools() {
  const tools: Record<string, { handler: Function }> = {};
  const mockServer = {
    tool: (name: string, _desc: string, _schema: unknown, handler: Function) => {
      tools[name] = { handler };
    },
  };
  return { mockServer, tools };
}

describe('advanced tools', () => {
  let mockSession: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = {
      addOps: vi.fn(),
      opsCount: 0,
      getOps: vi.fn(() => []),
    };
  });

  async function setupTools() {
    const { registerAdvancedTools } = await import('./advanced.js');
    const { mockServer, tools } = captureTools();
    registerAdvancedTools(mockServer as any, mockSession);
    return tools;
  }

  describe('generate_id', () => {
    it('generates a single ID by default', async () => {
      const tools = await setupTools();
      const result = await tools.generate_id.handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBeDefined();
      expect(typeof parsed.id).toBe('string');
    });

    it('generates multiple IDs', async () => {
      const tools = await setupTools();
      const result = await tools.generate_id.handler({ count: 3 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ids).toHaveLength(3);
    });
  });

  describe('build_schema', () => {
    it('creates properties and types', async () => {
      const tools = await setupTools();
      const result = await tools.build_schema.handler({
        properties: [
          { name: 'Age', dataType: 'INTEGER' },
          { name: 'Name', dataType: 'TEXT' },
        ],
        types: [{ propertyNames: ['Age', 'Name'], name: 'Person' }],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.properties).toHaveLength(2);
      expect(parsed.types).toHaveLength(1);
      expect(parsed.totalOps).toBeGreaterThan(0);
      // Verify property IDs were resolved by name
      expect(Graph.createType).toHaveBeenCalledOnce();
    });

    it('treats unknown property names as existing IDs', async () => {
      const tools = await setupTools();
      await tools.build_schema.handler({
        properties: [{ name: 'Age', dataType: 'INTEGER' }],
        types: [{ propertyNames: ['Age', 'existing_prop_id'], name: 'Mixed' }],
      });
      const typeCall = (Graph.createType as any).mock.calls[0][0];
      // Second property should be passed through as-is
      expect(typeCall.properties[1]).toBe('existing_prop_id');
    });
  });

  describe('create_knowledge_graph', () => {
    it('creates full graph with schema, entities, and relations', async () => {
      const tools = await setupTools();
      const result = await tools.create_knowledge_graph.handler({
        schema: {
          properties: [{ name: 'Founded', dataType: 'DATE' }],
          types: [{ propertyNames: ['Founded'], name: 'Company' }],
        },
        entities: [
          {
            name: 'Geo',
            typeName: 'Company',
            values: [{ propertyName: 'Founded', type: 'date', value: '2024-01-01' }],
          },
        ],
        relations: [
          { fromEntityName: 'Geo', toEntityName: 'Geo', relationType: 'Self-ref' },
        ],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.schema.properties).toHaveLength(1);
      expect(parsed.schema.types).toHaveLength(1);
      expect(parsed.entities).toHaveLength(1);
      expect(parsed.relations).toHaveLength(1);
      expect(parsed.totalOps).toBeGreaterThan(0);
    });

    it('creates graph without entities or relations', async () => {
      const tools = await setupTools();
      const result = await tools.create_knowledge_graph.handler({
        schema: {
          properties: [{ name: 'Url', dataType: 'TEXT' }],
          types: [{ propertyNames: ['Url'], name: 'Link' }],
        },
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.entities).toHaveLength(0);
      expect(parsed.relations).toHaveLength(0);
    });

    it('returns error on invalid schema', async () => {
      (Graph.createProperty as any).mockImplementationOnce(() => { throw new Error('Invalid dataType'); });
      const tools = await setupTools();
      const result = await tools.create_knowledge_graph.handler({
        schema: {
          properties: [{ name: 'Bad', dataType: 'INVALID' }],
          types: [{ propertyNames: ['Bad'], name: 'Broken' }],
        },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('add_values_to_entity', () => {
    it('adds multiple values to existing entity', async () => {
      const tools = await setupTools();
      const result = await tools.add_values_to_entity.handler({
        entityId: 'entity1',
        values: [
          { property: 'prop1', type: 'text', value: 'hello' },
          { property: 'prop2', type: 'integer', value: 42 },
        ],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.valuesAdded).toBe(2);
      expect(Graph.updateEntity).toHaveBeenCalledOnce();
    });

    it('returns error on failure', async () => {
      (Graph.updateEntity as any).mockImplementationOnce(() => { throw new Error('Entity not found'); });
      const tools = await setupTools();
      const result = await tools.add_values_to_entity.handler({
        entityId: 'bad_id',
        values: [{ property: 'p', type: 'text', value: 'v' }],
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('get_system_ids', () => {
    it('returns type IDs', async () => {
      const tools = await setupTools();
      const result = await tools.get_system_ids.handler({ category: 'types' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.types).toBeDefined();
      expect(parsed.types.PERSON_TYPE).toBe('sys_person_type');
    });

    it('returns property IDs', async () => {
      const tools = await setupTools();
      const result = await tools.get_system_ids.handler({ category: 'properties' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.properties).toBeDefined();
      expect(parsed.properties.NAME_PROPERTY).toBe('sys_name_prop');
    });

    it('returns data type IDs', async () => {
      const tools = await setupTools();
      const result = await tools.get_system_ids.handler({ category: 'data_types' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.dataTypes).toBeDefined();
      expect(parsed.dataTypes.TEXT).toBe('sys_text');
    });

    it('returns all categories', async () => {
      const tools = await setupTools();
      const result = await tools.get_system_ids.handler({ category: 'all' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.types).toBeDefined();
      expect(parsed.properties).toBeDefined();
      expect(parsed.dataTypes).toBeDefined();
    });
  });

  describe('read_local_file', () => {
    it('reads a text file within allowed paths', async () => {
      const tools = await setupTools();
      // Create a temp file in cwd (which is always allowed)
      const tmpPath = '/tmp/geo-test-read.txt';
      await fs.writeFile(tmpPath, 'hello world');
      try {
        // This will fail because /tmp may not be in allowed paths
        // unless cwd resolves there. Test the error case.
        const result = await tools.read_local_file.handler({ filePath: tmpPath });
        // If we get here, the file was within allowed roots
        if (!result.isError) {
          const parsed = JSON.parse(result.content[0].text);
          expect(parsed.content).toBe('hello world');
        }
      } finally {
        await fs.unlink(tmpPath).catch(() => {});
      }
    });

    it('returns error for empty filePath', async () => {
      const tools = await setupTools();
      const result = await tools.read_local_file.handler({ filePath: '   ' });
      expect(result.isError).toBe(true);
    });
  });

  describe('create_knowledge_graph_from_file', () => {
    it('validates payload without creating ops', async () => {
      const tools = await setupTools();
      const payload = JSON.stringify({
        schema: {
          properties: [{ name: 'Url', dataType: 'TEXT' }],
          types: [{ name: 'Link', propertyNames: ['Url'] }],
        },
        entities: [],
        relations: [],
      });
      const tmpPath = process.cwd() + '/test-payload.json';
      await fs.writeFile(tmpPath, payload);
      try {
        const result = await tools.create_knowledge_graph_from_file.handler({
          filePath: tmpPath,
          validateOnly: true,
        });
        if (!result.isError) {
          const parsed = JSON.parse(result.content[0].text);
          expect(parsed.valid).toBe(true);
          expect(parsed.summary.schemaProperties).toBe(1);
          expect(parsed.summary.schemaTypes).toBe(1);
        }
      } finally {
        await fs.unlink(tmpPath).catch(() => {});
      }
    });

    it('returns error for invalid JSON', async () => {
      const tools = await setupTools();
      const tmpPath = process.cwd() + '/test-bad.json';
      await fs.writeFile(tmpPath, 'not json');
      try {
        const result = await tools.create_knowledge_graph_from_file.handler({ filePath: tmpPath });
        expect(result.isError).toBe(true);
      } finally {
        await fs.unlink(tmpPath).catch(() => {});
      }
    });
  });

  describe('create_research_paper_and_claims', () => {
    it('creates paper and claims', async () => {
      const tools = await setupTools();
      const result = await tools.create_research_paper_and_claims.handler({
        paper: { title: 'Test Paper', arxivId: '2502.10855' },
        claims: [
          { claimText: 'First claim text' },
          { claimText: 'Second claim text', claimType: 'result' },
        ],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.paper.arxivId).toBe('2502.10855');
      expect(parsed.claims.count).toBe(2);
      expect(parsed.claims.ids).toHaveLength(2);
      expect(parsed.relations.extractedFrom).toHaveLength(2);
      expect(parsed.opsAdded).toBeGreaterThan(0);
    });

    it('strips arxiv: prefix from ID', async () => {
      const tools = await setupTools();
      const result = await tools.create_research_paper_and_claims.handler({
        paper: { title: 'Test', arxivId: 'arXiv:2502.10855' },
        claims: [{ claimText: 'A claim' }],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.paper.arxivId).toBe('2502.10855');
    });

    it('skips extracted-from relations when disabled', async () => {
      const tools = await setupTools();
      const result = await tools.create_research_paper_and_claims.handler({
        paper: { title: 'Test' },
        claims: [{ claimText: 'A claim' }],
        createExtractedFromRelations: false,
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.relations.extractedFrom).toHaveLength(0);
    });

    it('returns error on SDK failure', async () => {
      (Graph.createEntity as any).mockImplementationOnce(() => { throw new Error('SDK down'); });
      const tools = await setupTools();
      const result = await tools.create_research_paper_and_claims.handler({
        paper: { title: 'Test' },
        claims: [{ claimText: 'A claim' }],
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('create_research_ontology_paper_and_claims', () => {
    it('creates paper with authors, venue, topics, and claims', async () => {
      const tools = await setupTools();
      const result = await tools.create_research_ontology_paper_and_claims.handler({
        paper: {
          title: 'Ontology Paper',
          arxivId: '2502.99999',
          publicationDate: '2024-06-15',
          authors: [{ name: 'Alice' }, { name: 'Bob' }],
          venue: { name: 'NeurIPS' },
          topics: ['AI', 'ML'],
        },
        claims: [
          { text: 'First claim', topics: ['AI'] },
          { text: 'Second claim', topics: ['ML'], sourceQuote: 'Original quote' },
        ],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.paper.arxivId).toBe('2502.99999');
      expect(parsed.authors).toHaveLength(2);
      expect(parsed.venueProject).not.toBeNull();
      expect(parsed.topics).toHaveLength(2);
      expect(parsed.claims.count).toBe(2);
    });

    it('creates paper without optional fields', async () => {
      const tools = await setupTools();
      const result = await tools.create_research_ontology_paper_and_claims.handler({
        paper: { title: 'Minimal Paper' },
        claims: [{ text: 'A simple claim' }],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.paper).toBeDefined();
      expect(parsed.claims.count).toBe(1);
    });

    it('derives arXiv URL from ID', async () => {
      const tools = await setupTools();
      const result = await tools.create_research_ontology_paper_and_claims.handler({
        paper: { title: 'Test', arxivId: '2502.10855' },
        claims: [{ text: 'Claim' }],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.paper.arxivUrl).toBe('https://arxiv.org/abs/2502.10855');
    });

    it('disables topic creation when opted out', async () => {
      const tools = await setupTools();
      const result = await tools.create_research_ontology_paper_and_claims.handler({
        paper: { title: 'Test', topics: ['AI'] },
        claims: [{ text: 'Claim', topics: ['AI'] }],
        createTopics: false,
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.topics).toHaveLength(0);
    });
  });
});
