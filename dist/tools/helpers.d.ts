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
//# sourceMappingURL=helpers.d.ts.map