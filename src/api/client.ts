/**
 * Fetch-based GraphQL client for the Geo API.
 * Zero additional dependencies — uses native fetch.
 */

const GEO_GRAPHQL_URL =
  process.env.GEO_GRAPHQL_URL ?? 'https://api-testnet.geobrowser.io/graphql';

// ── UUID format helpers ──────────────────────────────────────────────

/**
 * Convert dashless 32-char hex to dashed UUID format.
 * `96f859efa1ca4b229372c86ad58b694b` → `96f859ef-a1ca-4b22-9372-c86ad58b694b`
 */
export function toDashedUUID(dashless: string): string {
  const hex = dashless.replace(/-/g, '').toLowerCase();
  if (hex.length !== 32) {
    throw new Error(`Invalid ID length: expected 32 hex chars, got ${hex.length}`);
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Convert dashed UUID to dashless 32-char hex.
 * `96f859ef-a1ca-4b22-9372-c86ad58b694b` → `96f859efa1ca4b229372c86ad58b694b`
 */
export function toDashlessUUID(dashed: string): string {
  return dashed.replace(/-/g, '').toLowerCase();
}

/**
 * Accept either format, always output dashed UUID for API queries.
 */
export function normalizeToUUID(input: string): string {
  const cleaned = input.replace(/-/g, '').toLowerCase();
  if (cleaned.length !== 32) {
    throw new Error(`Invalid ID: expected 32 hex chars (with or without dashes), got "${input}"`);
  }
  return toDashedUUID(cleaned);
}

// ── GraphQL client ───────────────────────────────────────────────────

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; locations?: Array<{ line: number; column: number }> }>;
}

export class GeoGraphQLError extends Error {
  constructor(
    public readonly errors: Array<{ message: string }>,
    public readonly query: string,
  ) {
    super(`GraphQL errors: ${errors.map((e) => e.message).join('; ')}`);
    this.name = 'GeoGraphQLError';
  }
}

/**
 * Execute a GraphQL query against the Geo API.
 */
export async function query<T = unknown>(
  queryString: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(GEO_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: queryString, variables }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL HTTP error: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as GraphQLResponse<T>;

  if (json.errors?.length) {
    throw new GeoGraphQLError(json.errors, queryString);
  }

  if (!json.data) {
    throw new Error('GraphQL response missing data field');
  }

  return json.data;
}
