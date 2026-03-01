/**
 * Shared MCP response helpers used across tool modules.
 */
export declare function ok(data: unknown): {
    content: {
        type: "text";
        text: string;
    }[];
};
export declare function err(error: unknown): {
    content: {
        type: "text";
        text: string;
    }[];
    isError: true;
};
export declare function coerceJsonObject(val: unknown): unknown;
export declare function coerceJsonArray(val: unknown): unknown;
export declare function coerceBool(val: unknown): unknown;
//# sourceMappingURL=helpers.d.ts.map