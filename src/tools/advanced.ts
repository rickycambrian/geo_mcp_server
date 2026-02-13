/**
 * Advanced high-level MCP tools that combine multiple SDK operations
 * for a better UX experience.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Graph, Id, SystemIds, IdUtils } from '@geoprotocol/geo-sdk';
import { z } from 'zod';
import { session, type EditSession } from '../state/session.js';

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
            dataType: z
              .enum([
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
              ])
              .describe('Data type for the property'),
            description: z.string().optional().describe('Optional description'),
          }),
        )
        .describe('Properties to create'),
      types: z
        .array(
          z.object({
            name: z.string().describe('Type name'),
            propertyNames: z.array(z.string()).describe('Names of properties to attach (must match property names above or be existing property IDs)'),
            description: z.string().optional().describe('Optional description'),
          }),
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
      schema: z.object({
        properties: z
          .array(
            z.object({
              name: z.string().describe('Property name'),
              dataType: z
                .enum([
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
                ])
                .describe('Data type'),
            }),
          )
          .describe('Properties to create'),
        types: z
          .array(
            z.object({
              name: z.string().describe('Type name'),
              propertyNames: z.array(z.string()).describe('Property names to attach to this type'),
            }),
          )
          .describe('Types to create'),
      }),
      entities: z
        .array(
          z.object({
            name: z.string().describe('Entity name'),
            typeName: z.string().describe('Name of the type (must match a type name from schema)'),
            values: z
              .array(
                z.object({
                  propertyName: z.string().describe('Property name (must match a property name from schema)'),
                  type: z
                    .enum(['text', 'integer', 'float', 'boolean', 'date', 'time', 'datetime', 'schedule', 'point'])
                    .describe('Value type'),
                  value: z.union([z.string(), z.number(), z.boolean()]).describe('The value'),
                }),
              )
              .optional()
              .describe('Property values for this entity'),
          }),
        )
        .optional()
        .describe('Entities to create'),
      relations: z
        .array(
          z.object({
            fromEntityName: z.string().describe('Name of the source entity'),
            toEntityName: z.string().describe('Name of the target entity'),
            relationType: z.string().describe('Relation type name'),
          }),
        )
        .optional()
        .describe('Relations between entities'),
    },
    async ({ schema, entities, relations }) => {
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
        for (const entity of entities) {
          const typeId = typeMap.get(entity.typeName) ?? entity.typeName;

          const values = entity.values?.map((v) => {
            const propertyId = propertyMap.get(v.propertyName) ?? v.propertyName;
            return buildTypedValue(propertyId, v.type, v.value);
          });

          const result = Graph.createEntity({
            name: entity.name,
            types: [typeId],
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
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                schema: {
                  properties: createdProperties,
                  types: createdTypes,
                  relationTypes: createdRelationTypes,
                },
                entities: createdEntities,
                relations: createdRelations,
                totalOps,
              },
              null,
              2,
            ),
          },
        ],
      };
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
            type: z
              .enum(['text', 'integer', 'float', 'boolean', 'date', 'time', 'datetime', 'schedule', 'point'])
              .describe('Value type'),
            value: z.union([z.string(), z.number(), z.boolean()]).describe('The value'),
          }),
        )
        .describe('Values to add'),
    },
    async ({ entityId, values }) => {
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
