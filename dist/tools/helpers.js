/**
 * Shared MCP response helpers used across tool modules.
 */
export function ok(data) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
export function err(error) {
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify({
                    error: error instanceof Error ? error.message : String(error),
                }),
            },
        ],
        isError: true,
    };
}
//# sourceMappingURL=helpers.js.map