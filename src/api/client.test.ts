import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toDashedUUID, toDashlessUUID, normalizeToUUID, query, GeoGraphQLError } from './client.js';

describe('UUID helpers', () => {
  describe('toDashedUUID', () => {
    it('converts 32-char hex to dashed UUID', () => {
      expect(toDashedUUID('96f859efa1ca4b229372c86ad58b694b')).toBe(
        '96f859ef-a1ca-4b22-9372-c86ad58b694b',
      );
    });

    it('handles already-dashed input by stripping and re-dashing', () => {
      expect(toDashedUUID('96f859ef-a1ca-4b22-9372-c86ad58b694b')).toBe(
        '96f859ef-a1ca-4b22-9372-c86ad58b694b',
      );
    });

    it('throws on invalid length', () => {
      expect(() => toDashedUUID('abc')).toThrow('Invalid ID length');
    });
  });

  describe('toDashlessUUID', () => {
    it('removes dashes and lowercases', () => {
      expect(toDashlessUUID('96F859EF-A1CA-4B22-9372-C86AD58B694B')).toBe(
        '96f859efa1ca4b229372c86ad58b694b',
      );
    });

    it('handles already dashless input', () => {
      expect(toDashlessUUID('96f859efa1ca4b229372c86ad58b694b')).toBe(
        '96f859efa1ca4b229372c86ad58b694b',
      );
    });
  });

  describe('normalizeToUUID', () => {
    it('converts dashless to dashed', () => {
      expect(normalizeToUUID('96f859efa1ca4b229372c86ad58b694b')).toBe(
        '96f859ef-a1ca-4b22-9372-c86ad58b694b',
      );
    });

    it('passes through already dashed', () => {
      expect(normalizeToUUID('96f859ef-a1ca-4b22-9372-c86ad58b694b')).toBe(
        '96f859ef-a1ca-4b22-9372-c86ad58b694b',
      );
    });

    it('throws on invalid input', () => {
      expect(() => normalizeToUUID('short')).toThrow('Invalid ID');
    });
  });
});

describe('query', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends POST with query and variables', async () => {
    const mockData = { entity: { id: '123', name: 'Test' } };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockData }),
      }),
    );

    const result = await query<typeof mockData>('{ entity(id: "123") { id name } }');
    expect(result).toEqual(mockData);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('throws GeoGraphQLError on GraphQL errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: null,
            errors: [{ message: 'Entity not found' }],
          }),
      }),
    );

    await expect(query('{ entity(id: "bad") { id } }')).rejects.toThrow(GeoGraphQLError);
  });

  it('throws on HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      }),
    );

    await expect(query('{ entities { id } }')).rejects.toThrow('GraphQL HTTP error: 500');
  });

  it('throws on missing data field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      }),
    );

    await expect(query('{ entities { id } }')).rejects.toThrow('missing data field');
  });
});
