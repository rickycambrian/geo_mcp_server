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
// ── JSON string coercion helpers ────────────────────────────────────
// Agent gateways sometimes serialize complex arguments as JSON strings
// instead of native objects/arrays/booleans. These helpers parse them
// and are used with z.preprocess() in tool input schemas.
export function coerceJsonObject(val) {
    if (val != null && typeof val === 'object' && !Array.isArray(val))
        return val;
    if (typeof val === 'string') {
        try {
            const parsed = JSON.parse(val);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                return parsed;
        }
        catch { }
    }
    return val;
}
export function coerceJsonArray(val) {
    if (Array.isArray(val))
        return val;
    if (typeof val === 'string') {
        try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed))
                return parsed;
        }
        catch { }
    }
    return val;
}
export function coerceBool(val) {
    if (typeof val === 'boolean')
        return val;
    if (val === 'true')
        return true;
    if (val === 'false')
        return false;
    return val;
}
//# sourceMappingURL=helpers.js.map