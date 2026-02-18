/**
 * Advanced high-level MCP tools that combine multiple SDK operations
 * for a better UX experience.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Graph, SystemIds, IdUtils } from '@geoprotocol/geo-sdk';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { EditSession } from '../state/session.js';

const GraphDataTypeEnum = z.enum([
  'TEXT',
  'INTEGER',
  'FLOAT',
  'BOOLEAN',
  'DATE',
  'TIME',
  'DATETIME',
  'SCHEDULE',
  'POINT',
  'BYTES',
  'DECIMAL',
  'EMBEDDING',
  'RELATION',
]);

const GraphValueTypeEnum = z.enum([
  'text',
  'integer',
  'float',
  'boolean',
  'date',
  'time',
  'datetime',
  'schedule',
  'point',
]);

const GraphTypeInputSchema = z
  .object({
    name: z.string().describe('Type name'),
    // Canonical field name used by the server and docs.
    propertyNames: z.array(z.string()).optional().describe('Property names (or property IDs) to attach to this type'),
    // Common LLM slip: uses `properties` instead of `propertyNames`.
    properties: z.array(z.string()).optional().describe('Alias for propertyNames'),
  })
  .superRefine((t, ctx) => {
    const hasPropertyNames = Array.isArray(t.propertyNames) && t.propertyNames.length > 0;
    const hasProperties = Array.isArray(t.properties) && t.properties.length > 0;
    if (!hasPropertyNames && !hasProperties) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either propertyNames or properties must be provided',
        path: ['propertyNames'],
      });
    }
  })
  .transform((t) => ({
    name: t.name,
    propertyNames: t.propertyNames ?? t.properties ?? [],
  }));

const GraphSchemaInputSchema = z.object({
  properties: z.array(
    z.object({
      name: z.string().describe('Property name'),
      dataType: GraphDataTypeEnum.describe('Data type'),
    }),
  ),
  types: z.array(GraphTypeInputSchema),
});

const GraphEntityValueInputSchema = z
  .object({
    propertyName: z.string().optional().describe('Property name (must match a property name from schema)'),
    // Common LLM slip: uses `property` from the lower-level Graph.createEntity API.
    property: z.string().optional().describe('Alias for propertyName'),
    type: GraphValueTypeEnum.describe('Value type'),
    value: z.union([z.string(), z.number(), z.boolean()]).describe('The value'),
  })
  .superRefine((v, ctx) => {
    if (!v.propertyName && !v.property) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either propertyName or property must be provided',
        path: ['propertyName'],
      });
    }
  })
  .transform((v) => ({
    propertyName: v.propertyName ?? v.property ?? '',
    type: v.type,
    value: v.value,
  }));

const GraphEntityInputSchema = z.object({
  name: z.string().describe('Entity name'),
  typeName: z
    .string()
    .optional()
    .describe(
      'Primary type name or type ID. Prefer a type name from schema, but you may pass a type ID to reference an existing type.',
    ),
  typeNames: z
    .array(z.string())
    .optional()
    .describe(
      'Additional type names or type IDs to assign (multi-typing). Each entry may be a type name from schema or an existing type ID.',
    ),
  values: z
    .array(
      GraphEntityValueInputSchema,
    )
    .optional()
    .describe('Property values for this entity'),
})
  .superRefine((entity, ctx) => {
    // Historically we required typeName, but LLMs sometimes omit it and provide only typeNames.
    // Accept that pattern as long as at least one type is provided.
    if (!entity.typeName && (!entity.typeNames || entity.typeNames.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either typeName or typeNames must be provided',
        path: ['typeName'],
      });
    }
  })
  .transform((entity) => {
    if (entity.typeName) return entity;
    const [primary, ...rest] = entity.typeNames ?? [];
    return {
      ...entity,
      typeName: primary,
      typeNames: rest.length > 0 ? rest : undefined,
    };
  });

const GraphRelationInputSchema = z.object({
  fromEntityName: z.string().describe('Name of the source entity'),
  toEntityName: z.string().describe('Name of the target entity'),
  relationType: z.string().describe('Relation type name'),
});

const CreateKnowledgeGraphInputSchema = z.object({
  schema: GraphSchemaInputSchema,
  entities: z.array(GraphEntityInputSchema).optional().describe('Entities to create'),
  relations: z.array(GraphRelationInputSchema).optional().describe('Relations between entities'),
});

type CreateKnowledgeGraphInput = z.infer<typeof CreateKnowledgeGraphInputSchema>;
type CreateKnowledgeGraphOutput = {
  schema: {
    properties: Array<{ name: string; id: string }>;
    types: Array<{ name: string; id: string }>;
    relationTypes: Array<{ name: string; id: string }>;
  };
  entities: Array<{ name: string; id: string }>;
  relations: Array<{ id: string }>;
  totalOps: number;
};

const MAX_LOCAL_FILE_BYTES = 1_000_000;
const MAX_LOCAL_FILE_PREVIEW_BYTES = 250_000;
const DEFAULT_CANONICAL_CLAIM_TYPE_ID = '96f859efa1ca4b229372c86ad58b694b';
const CANONICAL_RESEARCH_SCHEMA_IDS = {
  types: {
    researchPaper: '5296626122e04c2f8cebc2e0a864e84a',
    researchClaim: '7cccaa4f7e3542dea227910a67dcb083',
    researchAuthor: 'c2b804853c8e42bc9e2d7fa9db9f72d0',
    researchVenue: 'abbfb48854184502bfccae82de8a0781',
  },
  properties: {
    // Research Paper
    paperTitle: 'fcb6a0d48e6447589427c50396959fd4',
    abstract: '841be82f388a40429ddac7f4a4bb2ab2',
    arxivId: 'a2dca941b5604e6594efdf804aa125da',
    doi: '2b81eb1d736843dba560ba77363e0c14',
    publicationDate: '083e3f2ff16b493f91ca8f71b7439a73',
    pdfUrl: '503f7a3691c947aab7ef3838c22402c6',
    htmlUrl: '851c5073916642a0a66e44de72885f8e',
    arxivCategory: 'a20ce6ca37154316a43c9796904d8883',
    authorsJson: 'a0e9410bf89142208f85591e20b25bed',
    citationCount: 'd8381d27ee4144ed843fa0a5646d8565',
    claimCount: '656be50a208047e9a54bc4168b05f16b',
    topics: '640b0f39d3af4ba7af55380c09a66ba6',
    processingStatus: 'ce500244fb3144338300618b6127e6bf',
    processedAt: 'ae581b83bbb440628fc5603a557955ce',
    source: 'c8f4ce2a29224779816b4ffa089dea25',

    // Research Claim
    claimText: 'e43c247c6bfe45cfb0730a4cfea48870',
    claimType: 'c58847436e4244d0a572f39eb6f74372',
    section: 'a4f90bb88d0b4e87815ee37d5b13152f',
    pageNumber: 'ad3f600ff8734b79bfb99baacd780573',
    paragraphId: '3bd8744492084559a61d985f3ebd5b43',
    faithfulnessScore: '75d25ce465014ef5a3aa489f7172a00e',
    isAtomic: '9f2d2d9d742b4241b7111753d2cec20c',
    isDecontextualized: '0a5db51a22e64235b86e5231c5a4154c',
    confidence: '2368df25ceb8478297b7a1cd606d8b77',
    verificationStatus: 'f68ce99a44c14966971f1c2614cada9c',
    sourceSentence: 'd38bad0e728c443396807f2e9ae021fe',
    extractedEntitiesJson: '02cfa21e1e0f402a86a36fdf2aeaee44',
    extractedRelationsJson: 'd810c9be3fee42bab04399f88fa593d5',
  },
  relations: {
    extractedFrom: '3c54079f0357493ebed8d66e873b542e',
  },
} as const;

const ResearchAuthorInputSchema = z.object({
  name: z.string().min(1),
  affiliation: z.string().optional(),
  orcid: z.string().optional(),
});

const ResearchPaperInputSchema = z.object({
  title: z.string().min(1).describe('Full paper title'),
  abstract: z.string().optional(),
  arxivId: z.string().optional().describe('arXiv ID without prefix (e.g. 2502.10855)'),
  doi: z.string().optional(),
  publicationDate: z.string().optional().describe('ISO datetime or YYYY-MM-DD'),
  pdfUrl: z.string().optional(),
  htmlUrl: z.string().optional(),
  arxivCategory: z.string().optional(),
  authors: z.array(ResearchAuthorInputSchema).optional(),
  authorsJson: z.string().optional().describe('JSON string of authors (if already computed)'),
  topics: z.union([z.string(), z.array(z.string())]).optional(),
  source: z.string().optional().describe('e.g. \"arxiv\"'),
});

const ResearchClaimInputSchema = z.object({
  claimText: z.string().min(1),
  claimType: z
    .string()
    .optional()
    .describe('hypothesis|result|methodology|background|limitation|future_work|definition|comparison'),
  section: z.string().optional(),
  confidence: z.union([z.string(), z.number()]).optional(),
  isAtomic: z.boolean().optional(),
  isDecontextualized: z.boolean().optional(),
  sourceSentence: z.string().optional(),
  extractedEntities: z.unknown().optional(),
  extractedRelations: z.unknown().optional(),
  pageNumber: z.number().int().optional(),
  paragraphId: z.union([z.number().int(), z.string()]).optional(),
  faithfulnessScore: z.union([z.string(), z.number()]).optional(),
  verificationStatus: z.string().optional(),
});

function coerceIsoDatetime(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  // Accept full ISO values as-is.
  if (trimmed.includes('T')) return trimmed;
  // Accept YYYY-MM-DD and convert to midnight UTC.
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00.000Z`;
  return trimmed;
}

function shortText(input: string, max = 120): string {
  const cleaned = input.replace(/\\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

export function registerAdvancedTools(server: McpServer, session: EditSession): void {
  // ── generate_id ──────────────────────────────────────────────────────
  server.tool(
    'generate_id',
    'Generate one or more unique Geo knowledge graph IDs (dashless UUID v4)',
    {
      count: z.number().int().min(1).max(100).optional().describe('Number of IDs to generate (default 1)'),
    },
    async ({ count }) => {
      const n = count ?? 1;
      const ids = Array.from({ length: n }, () => IdUtils.generate());
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(n === 1 ? { id: ids[0] } : { ids }, null, 2),
          },
        ],
      };
    },
  );

  // ── build_schema ─────────────────────────────────────────────────────
  server.tool(
    'build_schema',
    'Build a complete schema (properties + types) in one call. Creates all properties first, then creates types that reference those properties by name.',
    {
      properties: z
        .array(
          z.object({
            name: z.string().describe('Property name'),
            dataType: GraphDataTypeEnum.describe('Data type for the property'),
            description: z.string().optional().describe('Optional description'),
          }),
        )
        .describe('Properties to create'),
      types: z
        .array(
          z
            .object({
              name: z.string().describe('Type name'),
              // Canonical field used by docs.
              propertyNames: z
                .array(z.string())
                .optional()
                .describe('Names of properties to attach (must match property names above or be existing property IDs)'),
              // Common LLM slip: uses `properties` instead of `propertyNames`.
              properties: z.array(z.string()).optional().describe('Alias for propertyNames'),
              description: z.string().optional().describe('Optional description'),
            })
            .superRefine((t, ctx) => {
              const hasPropertyNames = Array.isArray(t.propertyNames) && t.propertyNames.length > 0;
              const hasProperties = Array.isArray(t.properties) && t.properties.length > 0;
              if (!hasPropertyNames && !hasProperties) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: 'Either propertyNames or properties must be provided',
                  path: ['propertyNames'],
                });
              }
            })
            .transform((t) => ({
              ...t,
              propertyNames: t.propertyNames ?? t.properties ?? [],
            })),
        )
        .describe('Types to create'),
    },
    async ({ properties, types }) => {
      const propertyMap = new Map<string, string>();
      const createdProperties: Array<{ name: string; id: string }> = [];
      let totalOps = 0;

      // Create all properties
      for (const prop of properties) {
        const result = Graph.createProperty({
          name: prop.name,
          dataType: prop.dataType,
          description: prop.description,
        });
        propertyMap.set(prop.name, result.id);
        createdProperties.push({ name: prop.name, id: result.id });

        session.addOps(result.ops, {
          id: result.id,
          type: 'property',
          name: prop.name,
          opsCount: result.ops.length,
        });
        totalOps += result.ops.length;
      }

      // Create all types
      const createdTypes: Array<{ name: string; id: string }> = [];
      for (const t of types) {
        const propertyIds = t.propertyNames.map((name) => {
          const id = propertyMap.get(name);
          // If not found in current batch, treat as an existing property ID
          return id ?? name;
        });

        const result = Graph.createType({
          name: t.name,
          description: t.description,
          properties: propertyIds,
        });
        createdTypes.push({ name: t.name, id: result.id });

        session.addOps(result.ops, {
          id: result.id,
          type: 'type',
          name: t.name,
          opsCount: result.ops.length,
        });
        totalOps += result.ops.length;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { properties: createdProperties, types: createdTypes, totalOps },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ── create_knowledge_graph ───────────────────────────────────────────
  server.tool(
    'create_knowledge_graph',
    'Create a complete knowledge graph in one call: schema (properties + types), entities with values, and relations between entities. All name-based references are resolved automatically.',
    {
      schema: GraphSchemaInputSchema,
      entities: z.array(GraphEntityInputSchema).optional().describe('Entities to create'),
      relations: z.array(GraphRelationInputSchema).optional().describe('Relations between entities'),
    },
    async ({ schema, entities, relations }) => {
      try {
        const result = createKnowledgeGraph(session, { schema, entities, relations });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Failed to create knowledge graph: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── read_local_file ───────────────────────────────────────────────────
  server.tool(
    'read_local_file',
    'Read a local file from an allowed path. Useful for ingesting local research outputs, claim JSON, or markdown before publishing to Geo.',
    {
      filePath: z.string().describe('Absolute or relative file path to read'),
      maxBytes: z
        .number()
        .int()
        .min(1)
        .max(MAX_LOCAL_FILE_BYTES)
        .optional()
        .describe(`Maximum bytes to read (default ${MAX_LOCAL_FILE_PREVIEW_BYTES})`),
      output: z
        .enum(['text', 'base64'])
        .optional()
        .describe('Return mode for file content; use base64 for binary files'),
    },
    async ({ filePath, maxBytes, output }) => {
      try {
        const readResult = await readLocalFile(filePath, maxBytes, output ?? 'text');
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(readResult, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Failed to read local file: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── create_knowledge_graph_from_file ─────────────────────────────────
  server.tool(
    'create_knowledge_graph_from_file',
    'Read a local JSON file and create a complete knowledge graph in one call. Accepts either the raw create_knowledge_graph payload or one nested under payload/knowledgeGraph.',
    {
      filePath: z.string().describe('Path to a JSON file with graph payload'),
      maxBytes: z
        .number()
        .int()
        .min(1)
        .max(MAX_LOCAL_FILE_BYTES)
        .optional()
        .describe(`Maximum bytes to read from file (default ${MAX_LOCAL_FILE_BYTES})`),
      validateOnly: z
        .boolean()
        .optional()
        .describe('If true, validates and summarizes payload without creating ops'),
    },
    async ({ filePath, maxBytes, validateOnly }) => {
      try {
        const readResult = await readLocalFile(filePath, maxBytes ?? MAX_LOCAL_FILE_BYTES, 'text');
        if (readResult.truncated) {
          throw new Error('File exceeds maxBytes; increase maxBytes to load full JSON payload');
        }

        const raw = JSON.parse(readResult.content);
        const extracted = extractKnowledgeGraphPayload(raw);
        const payload = CreateKnowledgeGraphInputSchema.parse(extracted);

        if (validateOnly) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    source: {
                      requestedPath: filePath,
                      resolvedPath: readResult.path,
                      bytesRead: readResult.returnedBytes,
                    },
                    summary: {
                      schemaProperties: payload.schema.properties.length,
                      schemaTypes: payload.schema.types.length,
                      entities: payload.entities?.length ?? 0,
                      relations: payload.relations?.length ?? 0,
                    },
                    valid: true,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const result = createKnowledgeGraph(session, payload);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  source: {
                    requestedPath: filePath,
                    resolvedPath: readResult.path,
                    bytesRead: readResult.returnedBytes,
                  },
                  ...result,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Failed to create graph from file: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── add_values_to_entity ─────────────────────────────────────────────
  server.tool(
    'add_values_to_entity',
    'Add multiple property values to an existing entity in one call.',
    {
      entityId: z.string().describe('ID of the entity to update'),
      values: z
        .array(
              z.object({
                property: z.string().describe('Property ID'),
                type: GraphValueTypeEnum.describe('Value type'),
                value: z.union([z.string(), z.number(), z.boolean()]).describe('The value'),
              }),
            )
            .describe('Values to add'),
    },
    async ({ entityId, values }) => {
      try {
        const typedValues = values.map((v) => buildTypedValue(v.property, v.type, v.value));

        const result = Graph.updateEntity({
          id: entityId,
          values: typedValues,
        });

        session.addOps(result.ops, {
          id: result.id,
          type: 'entity',
          name: `Update entity ${entityId}`,
          opsCount: result.ops.length,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  entityId: result.id,
                  valuesAdded: values.length,
                  opsCount: result.ops.length,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Failed to add values: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── create_research_paper_and_claims ─────────────────────────────────
  server.tool(
    'create_research_paper_and_claims',
    'Create a Research Paper entity and multiple Research Claim entities using the canonical Geo research schema. Claim entities are always multi-typed with the canonical GeoBrowser Claim type so they show up in standard Claim views.',
    {
      paper: ResearchPaperInputSchema.describe('Paper metadata'),
      claims: z
        .array(ResearchClaimInputSchema)
        .min(1)
        .max(200)
        .describe('Claims extracted from the paper'),
      createExtractedFromRelations: z
        .boolean()
        .optional()
        .describe('If true, creates Extracted From relations from each claim to the paper (default true)'),
      canonicalClaimTypeId: z
        .string()
        .optional()
        .describe('Override canonical Claim type ID (default env GEO_CANONICAL_CLAIM_TYPE_ID or built-in)'),
      paperName: z
        .string()
        .optional()
        .describe('Optional override for the paper entity name (defaults to "Paper: <title> (arXiv:<id>)")'),
      paperDescription: z
        .string()
        .optional()
        .describe('Optional override for paper description'),
      claimNamePrefix: z
        .string()
        .optional()
        .describe('Prefix for claim entity names (default "Claim: ")'),
    },
    async ({
      paper,
      claims,
      createExtractedFromRelations,
      canonicalClaimTypeId,
      paperName,
      paperDescription,
      claimNamePrefix,
    }) => {
      try {
        const canonicalClaimType =
          (canonicalClaimTypeId ?? process.env.GEO_CANONICAL_CLAIM_TYPE_ID ?? '').trim()
          || DEFAULT_CANONICAL_CLAIM_TYPE_ID;

        const shouldCreateRelations = createExtractedFromRelations ?? true;
        const now = new Date().toISOString();

        const arxivId = paper.arxivId?.replace(/^arxiv:/i, '').trim() || undefined;
        const derivedPdfUrl = arxivId ? `https://arxiv.org/pdf/${arxivId}` : undefined;
        const derivedHtmlUrl = arxivId ? `https://arxiv.org/abs/${arxivId}` : undefined;

        const authorsJson =
          paper.authorsJson
          ?? (paper.authors ? JSON.stringify(paper.authors) : undefined);

        const topicsText =
          typeof paper.topics === 'string'
            ? paper.topics
            : (Array.isArray(paper.topics) ? JSON.stringify(paper.topics) : undefined);

        const paperEntityName =
          paperName
          ?? `Paper: ${paper.title}${arxivId ? ` (arXiv:${arxivId})` : ''}`;
        const paperEntityDescription =
          paperDescription ?? 'Research paper ingested via Geo MCP research tools.';

        const paperValues: NonNullable<Parameters<typeof Graph.createEntity>[0]['values']> = [];
        paperValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.paperTitle, 'text', paper.title));
        if (paper.abstract) {
          paperValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.abstract, 'text', paper.abstract));
        }
        if (arxivId) {
          paperValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.arxivId, 'text', arxivId));
        }
        if (paper.doi) {
          paperValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.doi, 'text', paper.doi));
        }
        const publicationDate = paper.publicationDate ? coerceIsoDatetime(paper.publicationDate) : undefined;
        if (publicationDate) {
          paperValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.publicationDate, 'datetime', publicationDate));
        }
        const pdfUrl = paper.pdfUrl ?? derivedPdfUrl;
        if (pdfUrl) {
          paperValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.pdfUrl, 'text', pdfUrl));
        }
        const htmlUrl = paper.htmlUrl ?? derivedHtmlUrl;
        if (htmlUrl) {
          paperValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.htmlUrl, 'text', htmlUrl));
        }
        if (paper.arxivCategory) {
          paperValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.arxivCategory, 'text', paper.arxivCategory));
        }
        if (authorsJson) {
          paperValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.authorsJson, 'text', authorsJson));
        }
        paperValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.claimCount, 'integer', claims.length));
        if (topicsText) {
          paperValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.topics, 'text', topicsText));
        }
        paperValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.processingStatus, 'text', 'draft'));
        paperValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.processedAt, 'datetime', now));
        paperValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.source, 'text', paper.source ?? 'arxiv'));

        const paperResult = Graph.createEntity({
          name: paperEntityName,
          description: paperEntityDescription,
          types: [CANONICAL_RESEARCH_SCHEMA_IDS.types.researchPaper],
          values: paperValues,
        });
        session.addOps(paperResult.ops, {
          id: paperResult.id,
          type: 'entity',
          name: paperEntityName,
          opsCount: paperResult.ops.length,
        });

        const claimIds: string[] = [];
        const relationIds: string[] = [];
        let opsAdded = paperResult.ops.length;

        const prefix = claimNamePrefix ?? 'Claim: ';
        for (let i = 0; i < claims.length; i++) {
          const claim = claims[i];
          const key = arxivId ? `arXiv:${arxivId}:${i + 1}` : `claim:${i + 1}`;
          const claimEntityName = `${prefix}${key} ${shortText(claim.claimText, 120)}`;
          const claimEntityDescription = shortText(claim.claimText, 280);

          const claimValues: NonNullable<Parameters<typeof Graph.createEntity>[0]['values']> = [];
          claimValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.claimText, 'text', claim.claimText));
          if (claim.claimType) {
            claimValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.claimType, 'text', claim.claimType));
          }
          if (claim.section) {
            claimValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.section, 'text', claim.section));
          }
          if (claim.pageNumber !== undefined) {
            claimValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.pageNumber, 'integer', claim.pageNumber));
          }
          if (claim.paragraphId !== undefined) {
            const n = typeof claim.paragraphId === 'string' ? Number(claim.paragraphId) : claim.paragraphId;
            if (Number.isFinite(n)) {
              claimValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.paragraphId, 'integer', n));
            }
          }
          if (claim.faithfulnessScore !== undefined) {
            claimValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.faithfulnessScore, 'text', String(claim.faithfulnessScore)));
          }
          if (claim.isAtomic !== undefined) {
            claimValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.isAtomic, 'boolean', claim.isAtomic));
          }
          if (claim.isDecontextualized !== undefined) {
            claimValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.isDecontextualized, 'boolean', claim.isDecontextualized));
          }
          if (claim.confidence !== undefined) {
            claimValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.confidence, 'text', String(claim.confidence)));
          }
          if (claim.verificationStatus) {
            claimValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.verificationStatus, 'text', claim.verificationStatus));
          }
          if (claim.sourceSentence) {
            claimValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.sourceSentence, 'text', claim.sourceSentence));
          }
          if (claim.extractedEntities !== undefined) {
            claimValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.extractedEntitiesJson, 'text', JSON.stringify(claim.extractedEntities)));
          }
          if (claim.extractedRelations !== undefined) {
            claimValues.push(buildTypedValue(CANONICAL_RESEARCH_SCHEMA_IDS.properties.extractedRelationsJson, 'text', JSON.stringify(claim.extractedRelations)));
          }

          const claimResult = Graph.createEntity({
            name: claimEntityName,
            description: claimEntityDescription,
            types: [
              CANONICAL_RESEARCH_SCHEMA_IDS.types.researchClaim,
              canonicalClaimType,
            ],
            values: claimValues,
          });
          session.addOps(claimResult.ops, {
            id: claimResult.id,
            type: 'entity',
            name: claimEntityName,
            opsCount: claimResult.ops.length,
          });

          claimIds.push(claimResult.id);
          opsAdded += claimResult.ops.length;

          if (shouldCreateRelations) {
            const rel = Graph.createRelation({
              fromEntity: claimResult.id,
              toEntity: paperResult.id,
              type: CANONICAL_RESEARCH_SCHEMA_IDS.relations.extractedFrom,
            });
            session.addOps(rel.ops, {
              id: rel.id,
              type: 'relation',
              name: `${claimResult.id} -> ${paperResult.id} (Extracted From)`,
              opsCount: rel.ops.length,
            });
            relationIds.push(rel.id);
            opsAdded += rel.ops.length;
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  paper: {
                    id: paperResult.id,
                    name: paperEntityName,
                    arxivId,
                  },
                  claims: {
                    count: claimIds.length,
                    ids: claimIds,
                  },
                  relations: shouldCreateRelations ? { extractedFrom: relationIds } : { extractedFrom: [] },
                  canonicalClaimType,
                  opsAdded,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Failed to create research entities: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── get_system_ids ───────────────────────────────────────────────────
  server.tool(
    'get_system_ids',
    'Get well-known system entity IDs from the Geo knowledge graph. Returns commonly used type, property, and data type IDs.',
    {
      category: z
        .enum(['types', 'properties', 'data_types', 'all'])
        .describe('Category of system IDs to return'),
    },
    async ({ category }) => {
      const typeIds = {
        PERSON_TYPE: SystemIds.PERSON_TYPE,
        COMPANY_TYPE: SystemIds.COMPANY_TYPE,
        PROJECT_TYPE: SystemIds.PROJECT_TYPE,
        POST_TYPE: SystemIds.POST_TYPE,
        SPACE_TYPE: SystemIds.SPACE_TYPE,
        IMAGE_TYPE: SystemIds.IMAGE_TYPE,
        SCHEMA_TYPE: SystemIds.SCHEMA_TYPE,
        ACADEMIC_FIELD_TYPE: SystemIds.ACADEMIC_FIELD_TYPE,
        DAO_TYPE: SystemIds.DAO_TYPE,
        GOVERNMENT_ORG_TYPE: SystemIds.GOVERNMENT_ORG_TYPE,
        INDUSTRY_TYPE: SystemIds.INDUSTRY_TYPE,
        INTEREST_TYPE: SystemIds.INTEREST_TYPE,
        NONPROFIT_TYPE: SystemIds.NONPROFIT_TYPE,
        PROTOCOL_TYPE: SystemIds.PROTOCOL_TYPE,
        REGION_TYPE: SystemIds.REGION_TYPE,
        RELATION_TYPE: SystemIds.RELATION_TYPE,
        ROLE_TYPE: SystemIds.ROLE_TYPE,
        DEFAULT_TYPE: SystemIds.DEFAULT_TYPE,
        ACCOUNT_TYPE: SystemIds.ACCOUNT_TYPE,
        NETWORK_TYPE: SystemIds.NETWORK_TYPE,
        TAB_TYPE: SystemIds.TAB_TYPE,
        GOAL_TYPE: SystemIds.GOAL_TYPE,
        PAGE_TYPE: SystemIds.PAGE_TYPE,
        VIEW_TYPE: SystemIds.VIEW_TYPE,
        VIDEO_TYPE: SystemIds.VIDEO_TYPE,
        BOUNTY_TYPE: SystemIds.BOUNTY_TYPE,
        DIFFICULTY_TYPE: SystemIds.DIFFICULTY_TYPE,
        RANK_TYPE: SystemIds.RANK_TYPE,
      };

      const propertyIds = {
        NAME_PROPERTY: SystemIds.NAME_PROPERTY,
        DESCRIPTION_PROPERTY: SystemIds.DESCRIPTION_PROPERTY,
        TYPES_PROPERTY: SystemIds.TYPES_PROPERTY,
        COVER_PROPERTY: SystemIds.COVER_PROPERTY,
        PROPERTIES: SystemIds.PROPERTIES,
        EMAIL_PROPERTY: SystemIds.EMAIL_PROPERTY,
        PHONE_NUMBER_PROPERTY: SystemIds.PHONE_NUMBER_PROPERTY,
        STREET_ADDRESS_PROPERTY: SystemIds.STREET_ADDRESS_PROPERTY,
        ADDRESS_PROPERTY: SystemIds.ADDRESS_PROPERTY,
        ACCOUNTS_PROPERTY: SystemIds.ACCOUNTS_PROPERTY,
        NETWORK_PROPERTY: SystemIds.NETWORK_PROPERTY,
        GEO_LOCATION_PROPERTY: SystemIds.GEO_LOCATION_PROPERTY,
        GOALS_PROPERTY: SystemIds.GOALS_PROPERTY,
        MISSION_PROPERTY: SystemIds.MISSION_PROPERTY,
        VISION_PROPERTY: SystemIds.VISION_PROPERTY,
        VALUES_PROPERTY: SystemIds.VALUES_PROPERTY,
        WORKS_AT_PROPERTY: SystemIds.WORKS_AT_PROPERTY,
        TABS_PROPERTY: SystemIds.TABS_PROPERTY,
        MARKDOWN_CONTENT: SystemIds.MARKDOWN_CONTENT,
        IMAGE_URL_PROPERTY: SystemIds.IMAGE_URL_PROPERTY,
        IMAGE_WIDTH_PROPERTY: SystemIds.IMAGE_WIDTH_PROPERTY,
        IMAGE_HEIGHT_PROPERTY: SystemIds.IMAGE_HEIGHT_PROPERTY,
        IMAGE_FILE_TYPE_PROPERTY: SystemIds.IMAGE_FILE_TYPE_PROPERTY,
        VIDEO_URL_PROPERTY: SystemIds.VIDEO_URL_PROPERTY,
        REGION_PROPERTY: SystemIds.REGION_PROPERTY,
        RELATED_TOPICS_PROPERTY: SystemIds.RELATED_TOPICS_PROPERTY,
        CREATOR_PROPERTY: SystemIds.CREATOR_PROPERTY,
        REWARD_PROPERTY: SystemIds.REWARD_PROPERTY,
        DIFFICULTY_PROPERTY: SystemIds.DIFFICULTY_PROPERTY,
        VERIFIED_SOURCE_PROPERTY: SystemIds.VERIFIED_SOURCE_PROPERTY,
        SOURCE_SPACE_PROPERTY: SystemIds.SOURCE_SPACE_PROPERTY,
        VIEW_PROPERTY: SystemIds.VIEW_PROPERTY,
        DATA_SOURCE_PROPERTY: SystemIds.DATA_SOURCE_PROPERTY,
        SELECTOR_PROPERTY: SystemIds.SELECTOR_PROPERTY,
      };

      const dataTypeIds = {
        TEXT: SystemIds.TEXT,
        INTEGER: SystemIds.INTEGER,
        FLOAT: SystemIds.FLOAT,
        BOOLEAN: SystemIds.BOOLEAN,
        DATE: SystemIds.DATE,
        TIME: SystemIds.TIME,
        DATETIME: SystemIds.DATETIME,
        DECIMAL: SystemIds.DECIMAL,
        BYTES: SystemIds.BYTES,
        SCHEDULE: SystemIds.SCHEDULE,
        POINT: SystemIds.POINT,
        EMBEDDING: SystemIds.EMBEDDING,
        RELATION: SystemIds.RELATION,
        URL: SystemIds.URL,
        IMAGE: SystemIds.IMAGE,
        DATA_TYPE: SystemIds.DATA_TYPE,
      };

      let result: Record<string, unknown>;
      switch (category) {
        case 'types':
          result = { types: typeIds };
          break;
        case 'properties':
          result = { properties: propertyIds };
          break;
        case 'data_types':
          result = { dataTypes: dataTypeIds };
          break;
        case 'all':
          result = { types: typeIds, properties: propertyIds, dataTypes: dataTypeIds };
          break;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}

function createKnowledgeGraph(
  session: EditSession,
  { schema, entities, relations }: CreateKnowledgeGraphInput,
): CreateKnowledgeGraphOutput {
  const propertyMap = new Map<string, string>();
  const typeMap = new Map<string, string>();
  const entityMap = new Map<string, string>();
  const relationTypeMap = new Map<string, string>();
  let totalOps = 0;

  const createdProperties: Array<{ name: string; id: string }> = [];
  const createdTypes: Array<{ name: string; id: string }> = [];
  const createdRelationTypes: Array<{ name: string; id: string }> = [];
  const createdEntities: Array<{ name: string; id: string }> = [];
  const createdRelations: Array<{ id: string }> = [];

  // 1. Create all properties
  for (const prop of schema.properties) {
    const result = Graph.createProperty({
      name: prop.name,
      dataType: prop.dataType,
    });
    propertyMap.set(prop.name, result.id);
    createdProperties.push({ name: prop.name, id: result.id });
    session.addOps(result.ops, {
      id: result.id,
      type: 'property',
      name: prop.name,
      opsCount: result.ops.length,
    });
    totalOps += result.ops.length;
  }

  // 2. Create all types
  for (const t of schema.types) {
    const propertyIds = t.propertyNames.map((name) => propertyMap.get(name) ?? name);
    const result = Graph.createType({
      name: t.name,
      properties: propertyIds,
    });
    typeMap.set(t.name, result.id);
    createdTypes.push({ name: t.name, id: result.id });
    session.addOps(result.ops, {
      id: result.id,
      type: 'type',
      name: t.name,
      opsCount: result.ops.length,
    });
    totalOps += result.ops.length;
  }

  // 3. Create relation type entities for unique relation types
  if (relations) {
    const uniqueRelationTypes = new Set(relations.map((r) => r.relationType));
    for (const relTypeName of uniqueRelationTypes) {
      const result = Graph.createEntity({
        name: relTypeName,
        types: [SystemIds.RELATION_TYPE],
      });
      relationTypeMap.set(relTypeName, result.id);
      createdRelationTypes.push({ name: relTypeName, id: result.id });
      session.addOps(result.ops, {
        id: result.id,
        type: 'entity',
        name: `RelationType: ${relTypeName}`,
        opsCount: result.ops.length,
      });
      totalOps += result.ops.length;
    }
  }

  // 4. Create all entities with their values
  if (entities) {
    const canonicalClaimTypeId =
      (process.env.GEO_CANONICAL_CLAIM_TYPE_ID ?? '').trim() || DEFAULT_CANONICAL_CLAIM_TYPE_ID;
    const researchClaimTypeId = typeMap.get('Research Claim');

    for (const entity of entities) {
      const typeIds = [
        entity.typeName,
        ...(entity.typeNames ?? []),
      ]
        .map((t) => (typeof t === 'string' ? (typeMap.get(t) ?? t) : t))
        .filter((t): t is string => typeof t === 'string' && t.length > 0);
      const uniqueTypeIds = [...new Set(typeIds)];

      // Ensure Research Claim entities show up under the standard GeoBrowser "Claim" views.
      // This makes the system more robust when clients forget to add the canonical Claim type.
      if (researchClaimTypeId && uniqueTypeIds.includes(researchClaimTypeId) && !uniqueTypeIds.includes(canonicalClaimTypeId)) {
        uniqueTypeIds.push(canonicalClaimTypeId);
      }
      const values = entity.values?.map((v) => {
        const propertyId = propertyMap.get(v.propertyName) ?? v.propertyName;
        return buildTypedValue(propertyId, v.type, v.value);
      });

      const result = Graph.createEntity({
        name: entity.name,
        types: uniqueTypeIds,
        values,
      });
      entityMap.set(entity.name, result.id);
      createdEntities.push({ name: entity.name, id: result.id });
      session.addOps(result.ops, {
        id: result.id,
        type: 'entity',
        name: entity.name,
        opsCount: result.ops.length,
      });
      totalOps += result.ops.length;
    }
  }

  // 5. Create all relations between entities
  if (relations) {
    for (const rel of relations) {
      const fromId = entityMap.get(rel.fromEntityName) ?? rel.fromEntityName;
      const toId = entityMap.get(rel.toEntityName) ?? rel.toEntityName;
      const relTypeId = relationTypeMap.get(rel.relationType) ?? rel.relationType;

      const result = Graph.createRelation({
        fromEntity: fromId,
        toEntity: toId,
        type: relTypeId,
      });
      createdRelations.push({ id: result.id });
      session.addOps(result.ops, {
        id: result.id,
        type: 'relation',
        name: `${rel.fromEntityName} -> ${rel.toEntityName} (${rel.relationType})`,
        opsCount: result.ops.length,
      });
      totalOps += result.ops.length;
    }
  }

  return {
    schema: {
      properties: createdProperties,
      types: createdTypes,
      relationTypes: createdRelationTypes,
    },
    entities: createdEntities,
    relations: createdRelations,
    totalOps,
  };
}

function resolveAllowedRoots(): string[] {
  const configuredRoots = (process.env.GEO_MCP_ALLOWED_PATHS ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => path.resolve(v));

  const roots = new Set<string>([path.resolve(process.cwd()), ...configuredRoots]);
  return [...roots];
}

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  if (targetPath === rootPath) {
    return true;
  }
  const prefix = rootPath.endsWith(path.sep) ? rootPath : `${rootPath}${path.sep}`;
  return targetPath.startsWith(prefix);
}

async function resolveAllowedFilePath(filePath: string): Promise<{ resolvedPath: string; allowedRoots: string[] }> {
  if (!filePath.trim()) {
    throw new Error('filePath cannot be empty');
  }

  const absoluteInput = path.resolve(filePath);
  const resolvedPath = await fs.realpath(absoluteInput);
  const allowedRoots = resolveAllowedRoots();
  const allowed = allowedRoots.some((root) => isWithinRoot(resolvedPath, root));

  if (!allowed) {
    throw new Error(
      `Path is outside allowed roots. Set GEO_MCP_ALLOWED_PATHS to permit additional directories. Allowed roots: ${allowedRoots.join(', ')}`,
    );
  }

  return { resolvedPath, allowedRoots };
}

async function readLocalFile(
  filePath: string,
  maxBytes = MAX_LOCAL_FILE_PREVIEW_BYTES,
  output: 'text' | 'base64' = 'text',
): Promise<{
  path: string;
  sizeBytes: number;
  returnedBytes: number;
  truncated: boolean;
  output: 'text' | 'base64';
  content: string;
}> {
  const { resolvedPath } = await resolveAllowedFilePath(filePath);
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile()) {
    throw new Error('filePath must point to a regular file');
  }

  const bytesToRead = Math.min(stat.size, maxBytes);
  if (bytesToRead < 0) {
    throw new Error('maxBytes must be greater than 0');
  }

  const file = await fs.open(resolvedPath, 'r');
  let bytesRead = 0;
  let chunk = Buffer.alloc(0);
  try {
    if (bytesToRead > 0) {
      const buffer = Buffer.alloc(bytesToRead);
      const read = await file.read(buffer, 0, bytesToRead, 0);
      bytesRead = read.bytesRead;
      chunk = buffer.subarray(0, read.bytesRead);
    }
  } finally {
    await file.close();
  }

  return {
    path: resolvedPath,
    sizeBytes: stat.size,
    returnedBytes: bytesRead,
    truncated: stat.size > bytesRead,
    output,
    content: output === 'base64' ? chunk.toString('base64') : chunk.toString('utf8'),
  };
}

function extractKnowledgeGraphPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') {
    throw new Error('JSON root must be an object');
  }

  const candidate = raw as Record<string, unknown>;
  if (candidate.schema) {
    return candidate;
  }

  if (candidate.payload && typeof candidate.payload === 'object') {
    return candidate.payload;
  }

  if (candidate.knowledgeGraph && typeof candidate.knowledgeGraph === 'object') {
    return candidate.knowledgeGraph;
  }

  if (candidate.knowledge_graph && typeof candidate.knowledge_graph === 'object') {
    return candidate.knowledge_graph;
  }

  throw new Error('Could not find a graph payload. Expected keys: schema, payload, knowledgeGraph, or knowledge_graph');
}

/**
 * Build a PropertyValueParam from simplified inputs.
 */
function buildTypedValue(
  property: string,
  type: string,
  value: string | number | boolean,
) {
  switch (type) {
    case 'text':
      return { property, type: 'text' as const, value: String(value) };
    case 'integer':
      return { property, type: 'integer' as const, value: typeof value === 'number' ? value : Number(value) };
    case 'float':
      return { property, type: 'float' as const, value: typeof value === 'number' ? value : Number(value) };
    case 'boolean':
      return { property, type: 'boolean' as const, value: Boolean(value) };
    case 'date':
      return { property, type: 'date' as const, value: String(value) };
    case 'time':
      return { property, type: 'time' as const, value: String(value) };
    case 'datetime':
      return { property, type: 'datetime' as const, value: String(value) };
    case 'schedule':
      return { property, type: 'schedule' as const, value: String(value) };
    case 'point':
      // Expect value as "lon,lat" string
      const [lon, lat] = String(value).split(',').map(Number);
      return { property, type: 'point' as const, lon, lat };
    default:
      return { property, type: 'text' as const, value: String(value) };
  }
}
