/**
 * Fetch-based GraphQL client for the Geo API.
 * Zero additional dependencies — uses native fetch.
 */
/**
 * Convert dashless 32-char hex to dashed UUID format.
 * `96f859efa1ca4b229372c86ad58b694b` → `96f859ef-a1ca-4b22-9372-c86ad58b694b`
 */
export declare function toDashedUUID(dashless: string): string;
/**
 * Convert dashed UUID to dashless 32-char hex.
 * `96f859ef-a1ca-4b22-9372-c86ad58b694b` → `96f859efa1ca4b229372c86ad58b694b`
 */
export declare function toDashlessUUID(dashed: string): string;
/**
 * Accept either format, always output dashed UUID for API queries.
 */
export declare function normalizeToUUID(input: string): string;
export interface GraphQLResponse<T> {
    data?: T;
    errors?: Array<{
        message: string;
        locations?: Array<{
            line: number;
            column: number;
        }>;
    }>;
}
export declare class GeoGraphQLError extends Error {
    readonly errors: Array<{
        message: string;
    }>;
    readonly query: string;
    constructor(errors: Array<{
        message: string;
    }>, query: string);
}
/**
 * Execute a GraphQL query against the Geo API.
 */
export declare function query<T = unknown>(queryString: string, variables?: Record<string, unknown>): Promise<T>;
//# sourceMappingURL=client.d.ts.map