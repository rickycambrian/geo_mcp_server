import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@geoprotocol/geo-sdk', () => ({
  Graph: {
    createProperty: vi.fn(() => ({ id: 'prop1', ops: [{ type: 0 }] })),
    createType: vi.fn(() => ({ id: 'type1', ops: [{ type: 1 }, { type: 2 }] })),
    createEntity: vi.fn(() => ({ id: 'entity1', ops: [{ type: 3 }] })),
    createRelation: vi.fn(() => ({ id: 'rel1', ops: [{ type: 4 }] })),
    createImage: vi.fn(() => Promise.resolve({ id: 'img1', cid: 'QmTest', ops: [{ type: 5 }] })),
    updateEntity: vi.fn(() => ({ id: 'entity1', ops: [{ type: 6 }] })),
    deleteEntity: vi.fn(() => ({ id: 'entity1', ops: [{ type: 7 }] })),
    deleteRelation: vi.fn(() => ({ id: 'rel1', ops: [{ type: 8 }] })),
  },
}));

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

describe('graph tools', () => {
  let mockSession: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = {
      addOps: vi.fn(),
    };
  });

  async function setupTools() {
    const { registerGraphTools } = await import('./graph.js');
    const { mockServer, tools } = captureTools();
    registerGraphTools(mockServer as any, mockSession);
    return tools;
  }

  describe('create_property', () => {
    it('creates property and adds ops to session', async () => {
      const tools = await setupTools();
      const result = await tools.create_property.handler({ name: 'Age', dataType: 'INTEGER' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe('prop1');
      expect(parsed.opsCount).toBe(1);
      expect(mockSession.addOps).toHaveBeenCalledOnce();
    });

    it('passes description to SDK', async () => {
      const tools = await setupTools();
      await tools.create_property.handler({ name: 'Age', dataType: 'INTEGER', description: 'Person age' });
      expect(Graph.createProperty).toHaveBeenCalledWith({ name: 'Age', dataType: 'INTEGER', description: 'Person age' });
    });

    it('returns error on SDK failure', async () => {
      (Graph.createProperty as any).mockImplementationOnce(() => { throw new Error('SDK error'); });
      const tools = await setupTools();
      const result = await tools.create_property.handler({ name: 'Bad', dataType: 'TEXT' });
      expect(result.isError).toBe(true);
    });
  });

  describe('create_type', () => {
    it('creates type with properties', async () => {
      const tools = await setupTools();
      const result = await tools.create_type.handler({ name: 'Person', properties: ['prop1', 'prop2'] });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe('type1');
      expect(parsed.opsCount).toBe(2);
    });

    it('creates type without properties', async () => {
      const tools = await setupTools();
      await tools.create_type.handler({ name: 'EmptyType' });
      expect(Graph.createType).toHaveBeenCalledWith({ name: 'EmptyType', properties: undefined, description: undefined });
    });
  });

  describe('create_entity', () => {
    it('creates basic entity', async () => {
      const tools = await setupTools();
      const result = await tools.create_entity.handler({ name: 'Alice' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe('entity1');
    });

    it('creates entity with typed values', async () => {
      const tools = await setupTools();
      await tools.create_entity.handler({
        name: 'Alice',
        types: ['type1'],
        values: [{ property: 'prop1', type: 'text', value: 'hello' }],
      });
      expect(Graph.createEntity).toHaveBeenCalledOnce();
      const call = (Graph.createEntity as any).mock.calls[0][0];
      expect(call.name).toBe('Alice');
      expect(call.types).toEqual(['type1']);
    });

    it('converts decimal values to BigInt mantissa', async () => {
      const tools = await setupTools();
      await tools.create_entity.handler({
        name: 'Price',
        values: [{ property: 'amount', type: 'decimal', exponent: -2, mantissa: 1234 }],
      });
      const call = (Graph.createEntity as any).mock.calls[0][0];
      expect(call.values[0].mantissa).toEqual({ type: 'i64', value: BigInt(1234) });
    });

    it('creates entity with relations', async () => {
      const tools = await setupTools();
      await tools.create_entity.handler({
        name: 'Alice',
        relations: { worksAt: { toEntity: 'entity2' } },
      });
      const call = (Graph.createEntity as any).mock.calls[0][0];
      expect(call.relations).toEqual({ worksAt: { toEntity: 'entity2' } });
    });
  });

  describe('create_relation', () => {
    it('creates relation between entities', async () => {
      const tools = await setupTools();
      const result = await tools.create_relation.handler({
        fromEntity: 'entity1',
        toEntity: 'entity2',
        type: 'relType1',
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe('rel1');
    });

    it('passes position param', async () => {
      const tools = await setupTools();
      await tools.create_relation.handler({
        fromEntity: 'e1', toEntity: 'e2', type: 't1', position: 'a0',
      });
      expect(Graph.createRelation).toHaveBeenCalledWith({
        fromEntity: 'e1', toEntity: 'e2', type: 't1', position: 'a0',
      });
    });
  });

  describe('create_image', () => {
    it('creates image entity', async () => {
      const tools = await setupTools();
      const result = await tools.create_image.handler({ url: 'https://example.com/img.png' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe('img1');
      expect(parsed.cid).toBe('QmTest');
    });

    it('returns error on network failure', async () => {
      (Graph.createImage as any).mockRejectedValueOnce(new Error('Network error'));
      const tools = await setupTools();
      const result = await tools.create_image.handler({ url: 'https://bad.url' });
      expect(result.isError).toBe(true);
    });
  });

  describe('update_entity', () => {
    it('updates entity name', async () => {
      const tools = await setupTools();
      const result = await tools.update_entity.handler({ id: 'entity1', name: 'Bob' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe('entity1');
    });

    it('handles decimal values in update', async () => {
      const tools = await setupTools();
      await tools.update_entity.handler({
        id: 'entity1',
        values: [{ property: 'price', type: 'decimal', exponent: -1, mantissa: 42 }],
      });
      const call = (Graph.updateEntity as any).mock.calls[0][0];
      expect(call.values[0].mantissa).toEqual({ type: 'i64', value: BigInt(42) });
    });

    it('passes unset properties', async () => {
      const tools = await setupTools();
      await tools.update_entity.handler({
        id: 'entity1',
        unset: [{ property: 'oldProp' }],
      });
      const call = (Graph.updateEntity as any).mock.calls[0][0];
      expect(call.unset).toEqual([{ property: 'oldProp' }]);
    });
  });

  describe('delete_entity', () => {
    it('deletes entity and adds ops', async () => {
      const tools = await setupTools();
      const result = await tools.delete_entity.handler({ id: 'entity1' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe('entity1');
      expect(mockSession.addOps).toHaveBeenCalledOnce();
    });

    it('returns error on failure', async () => {
      (Graph.deleteEntity as any).mockImplementationOnce(() => { throw new Error('Not found'); });
      const tools = await setupTools();
      const result = await tools.delete_entity.handler({ id: 'nonexistent' });
      expect(result.isError).toBe(true);
    });
  });

  describe('delete_relation', () => {
    it('deletes relation and adds ops', async () => {
      const tools = await setupTools();
      const result = await tools.delete_relation.handler({ id: 'rel1' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe('rel1');
    });
  });
});
