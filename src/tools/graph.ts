import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Graph } from '@geoprotocol/geo-sdk';
import { z } from 'zod';
import type { EditSession } from '../state/session.js';

const DataTypeEnum = z.enum([
  'TEXT',
  'INTEGER',
  'FLOAT',
  'BOOLEAN',
  'DATE',
  'TIME',
  'DATETIME',
  'SCHEDULE',
  'POINT',
  'DECIMAL',
  'BYTES',
  'EMBEDDING',
  'RELATION',
]);

const TypedValueSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), value: z.string(), language: z.string().optional() }),
  z.object({ type: z.literal('integer'), value: z.number(), unit: z.string().optional() }),
  z.object({ type: z.literal('float'), value: z.number(), unit: z.string().optional() }),
  z.object({ type: z.literal('boolean'), value: z.boolean() }),
  z.object({ type: z.literal('date'), value: z.string() }),
  z.object({ type: z.literal('time'), value: z.string() }),
  z.object({ type: z.literal('datetime'), value: z.string() }),
  z.object({ type: z.literal('schedule'), value: z.string() }),
  z.object({
    type: z.literal('point'),
    lon: z.number(),
    lat: z.number(),
    alt: z.number().optional(),
  }),
  z.object({
    type: z.literal('decimal'),
    exponent: z.number(),
    mantissa: z.number(),
    unit: z.string().optional(),
  }),
]);

const PropertyValueSchema = z
  .object({ property: z.string() })
  .and(TypedValueSchema);

const RelationValueSchema = z.object({
  toEntity: z.string(),
  position: z.string().optional(),
});

const UnsetPropertySchema = z.object({
  property: z.string(),
  language: z.string().optional(),
});

function ok(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function err(error: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: String(error) }) }],
    isError: true as const,
  };
}

export function registerGraphTools(server: McpServer, session: EditSession) {
  // ── create_property ──────────────────────────────────────────────
  server.tool(
    'create_property',
    'Create a property definition in the knowledge graph',
    {
      name: z.string().describe('Name of the property'),
      dataType: DataTypeEnum.describe('Data type for the property'),
      description: z.string().optional().describe('Description of the property'),
    },
    async ({ name, dataType, description }) => {
      try {
        const { id, ops } = Graph.createProperty({ name, dataType, description });
        session.addOps(ops, { id, type: 'property', name, opsCount: ops.length });
        return ok({ id, opsCount: ops.length });
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── create_type ──────────────────────────────────────────────────
  server.tool(
    'create_type',
    'Create a type (schema) that groups properties',
    {
      name: z.string().describe('Name of the type'),
      properties: z.array(z.string()).optional().describe('Array of property IDs to include'),
      description: z.string().optional().describe('Description of the type'),
    },
    async ({ name, properties, description }) => {
      try {
        const { id, ops } = Graph.createType({ name, properties, description });
        session.addOps(ops, { id, type: 'type', name, opsCount: ops.length });
        return ok({ id, opsCount: ops.length });
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── create_entity ────────────────────────────────────────────────
  server.tool(
    'create_entity',
    'Create an entity instance in the knowledge graph',
    {
      name: z.string().describe('Name of the entity'),
      description: z.string().optional().describe('Description of the entity'),
      types: z.array(z.string()).optional().describe('Array of type IDs to assign'),
      cover: z.string().optional().describe('Image entity ID for cover'),
      values: z.array(PropertyValueSchema).optional().describe('Property values to set'),
      relations: z
        .record(z.string(), z.union([RelationValueSchema, z.array(RelationValueSchema)]))
        .optional()
        .describe('Relations keyed by relation property ID'),
    },
    async ({ name, description, types, cover, values, relations }) => {
      try {
        const params: Record<string, unknown> = { name };
        if (description !== undefined) params.description = description;
        if (types !== undefined) params.types = types;
        if (cover !== undefined) params.cover = cover;

        if (values !== undefined) {
          params.values = values.map((v) => {
            if (v.type === 'decimal') {
              return {
                ...v,
                mantissa: { type: 'i64' as const, value: BigInt(v.mantissa) },
              };
            }
            return v;
          });
        }

        if (relations !== undefined) params.relations = relations;

        const { id, ops } = Graph.createEntity(params as Parameters<typeof Graph.createEntity>[0]);
        session.addOps(ops, { id, type: 'entity', name, opsCount: ops.length });
        return ok({ id, opsCount: ops.length });
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── create_relation ──────────────────────────────────────────────
  server.tool(
    'create_relation',
    'Create a relation between two entities',
    {
      fromEntity: z.string().describe('Source entity ID'),
      toEntity: z.string().describe('Target entity ID'),
      type: z.string().describe('Relation type entity ID'),
      position: z.string().optional().describe('Position string for ordering'),
    },
    async ({ fromEntity, toEntity, type, position }) => {
      try {
        const { id, ops } = Graph.createRelation({ fromEntity, toEntity, type, position });
        session.addOps(ops, {
          id,
          type: 'relation',
          name: `${fromEntity} -> ${toEntity}`,
          opsCount: ops.length,
        });
        return ok({ id, opsCount: ops.length });
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── create_image ─────────────────────────────────────────────────
  server.tool(
    'create_image',
    'Create an image entity from a URL',
    {
      url: z.string().describe('URL of the image to upload'),
      name: z.string().optional().describe('Name for the image entity'),
      description: z.string().optional().describe('Description of the image'),
    },
    async ({ url, name, description }) => {
      try {
        const { id, cid, ops } = await Graph.createImage({ url, name, description });
        session.addOps(ops, {
          id,
          type: 'image',
          name: name ?? url,
          opsCount: ops.length,
        });
        return ok({ id, cid, opsCount: ops.length });
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── update_entity ────────────────────────────────────────────────
  server.tool(
    'update_entity',
    'Update an existing entity',
    {
      id: z.string().describe('ID of the entity to update'),
      name: z.string().optional().describe('New name for the entity'),
      description: z.string().optional().describe('New description for the entity'),
      values: z.array(PropertyValueSchema).optional().describe('Property values to set'),
      unset: z.array(UnsetPropertySchema).optional().describe('Properties to unset'),
    },
    async ({ id, name, description, values, unset }) => {
      try {
        const params: Record<string, unknown> = { id };
        if (name !== undefined) params.name = name;
        if (description !== undefined) params.description = description;

        if (values !== undefined) {
          params.values = values.map((v) => {
            if (v.type === 'decimal') {
              return {
                ...v,
                mantissa: { type: 'i64' as const, value: BigInt(v.mantissa) },
              };
            }
            return v;
          });
        }

        if (unset !== undefined) params.unset = unset;

        const result = Graph.updateEntity(params as Parameters<typeof Graph.updateEntity>[0]);
        session.addOps(result.ops, {
          id: result.id,
          type: 'entity',
          name: name ?? id,
          opsCount: result.ops.length,
        });
        return ok({ id: result.id, opsCount: result.ops.length });
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── delete_entity ────────────────────────────────────────────────
  server.tool(
    'delete_entity',
    'Delete an entity from the knowledge graph',
    {
      id: z.string().describe('ID of the entity to delete'),
    },
    async ({ id }) => {
      try {
        const result = Graph.deleteEntity({ id });
        session.addOps(result.ops, {
          id: result.id,
          type: 'entity',
          name: `deleted:${id}`,
          opsCount: result.ops.length,
        });
        return ok({ id: result.id, opsCount: result.ops.length });
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── delete_relation ──────────────────────────────────────────────
  server.tool(
    'delete_relation',
    'Delete a relation from the knowledge graph',
    {
      id: z.string().describe('ID of the relation to delete'),
    },
    async ({ id }) => {
      try {
        const result = Graph.deleteRelation({ id });
        session.addOps(result.ops, {
          id: result.id,
          type: 'relation',
          name: `deleted:${id}`,
          opsCount: result.ops.length,
        });
        return ok({ id: result.id, opsCount: result.ops.length });
      } catch (error) {
        return err(error);
      }
    },
  );
}
