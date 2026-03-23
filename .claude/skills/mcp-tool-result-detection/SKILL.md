---
name: mcp-tool-result-detection
description: Reference for parsing MCP tool results across the gateway and SDK. Covers slug-based tool prefix stripping, x402 payment receipt removal, and dual JSON format parsing. Use when adding new tool result detection logic or debugging tool result parsing failures.
user-invocable: false
---

# MCP Tool Result Detection Patterns

When detecting specific payloads in MCP tool results (e.g., transaction signing requests, payment receipts), three non-obvious preprocessing steps are required. These patterns were discovered through debugging and are implemented identically in:

- `rickydata_SDK/packages/core/src/geo-wallet/detect.ts`
- `mcp-agent-gateway/src/chat/chat-service.ts`

## 1. Slug-Based Tool Name Prefix Stripping

The MCP gateway returns tool names with a server slug prefix (e.g., `rickycambrian-geo-mcp-server__publish_edit`). To match against a known tool list, strip the prefix:

```typescript
const bareToolName = toolName.includes('__')
  ? toolName.slice(toolName.lastIndexOf('__') + 2)
  : toolName;
```

**Why `lastIndexOf`**: The slug can itself contain special characters; using `lastIndexOf('__')` ensures we split at the actual delimiter, not a coincidental match in the slug.

This mirrors the gateway's own slug generation algorithm (from the MCP Gateway Slug-Based Tool Prefix Fix, commit `b7aabe0e`):
```
name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
```

## 2. x402 Payment Receipt Stripping

When x402 payments are enabled, the gateway appends a JSON payment receipt on a new line after the tool result. This must be stripped before JSON parsing:

```typescript
const cleanResult = toolResult.split('\n{"_payment"')[0].trim();
```

This handles the format: `{"actual":"result"}\n{"_payment":{"receipt":"...","amount":"0.001"}}`

## 3. Dual JSON Format Parsing

MCP tool results can arrive in two formats:

**Format A — Direct JSON**: The tool result string is the JSON object directly.
```json
{"status": "pending_signature", "id": "abc123", "to": "0x...", "data": "0x..."}
```

**Format B — MCP Content Array**: The result is wrapped in the MCP content structure.
```json
{"content": [{"type": "text", "text": "{\"status\":\"pending_signature\",\"id\":\"abc123\",...}"}]}
```

The detection function must try both:

```typescript
// Try direct parse first
try {
  const parsed = JSON.parse(cleanResult);
  const result = extractPayload(parsed);
  if (result) return result;
} catch { /* not direct JSON */ }

// Try MCP content array format
try {
  const parsed = JSON.parse(cleanResult);
  if (Array.isArray(parsed.content)) {
    for (const item of parsed.content) {
      if (item.type === 'text' && typeof item.text === 'string') {
        try {
          // Strip x402 receipt from inner text too
          const inner = JSON.parse(item.text.split('\n{"_payment"')[0].trim());
          const result = extractPayload(inner);
          if (result) return result;
        } catch { /* inner text wasn't JSON */ }
      }
    }
  }
} catch { /* not parseable at all */ }
```

**Important**: The x402 receipt can appear inside the inner `text` field too, so strip it at both levels.

## 4. Field Validation in extractPayload

Always validate required fields with `typeof` checks, not just truthiness:

```typescript
function extractPayload(obj: Record<string, unknown>): Payload | null {
  if (obj.status !== 'pending_signature') return null;
  if (typeof obj.id !== 'string' || typeof obj.to !== 'string' || typeof obj.data !== 'string') {
    return null;
  }
  return {
    id: obj.id,
    to: obj.to,
    data: obj.data,
    // Provide sensible defaults for optional fields
    description: typeof obj.description === 'string' ? obj.description : 'Geo transaction',
    toolName: typeof obj.toolName === 'string' ? obj.toolName : 'unknown',
  };
}
```

## When to Update

When adding a new detectable payload type (beyond `pending_signature`):
1. Add detection logic following the same 3-step preprocessing
2. Add the originating tool names to the allowlist (e.g., `GEO_WRITE_TOOLS` set)
3. Update both the SDK and gateway implementations to stay in sync
