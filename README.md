# Geo MCP Server

MCP server providing full access to the [Geo protocol](https://geo.xyz) SDK for knowledge graph operations. Build, query, and publish structured knowledge to the Geo decentralized knowledge network using the [GRC-20](https://github.com/geobrowser/grcs/blob/main/grcs/grc-0020.md) standard.

## Features

- **21 tools** covering the full Geo SDK surface
- **Session-based op accumulation** - build complex edits across multiple tool calls, then publish as a single atomic transaction
- **Publish-to-propose continuity** - `propose_dao_edit` can reuse the latest published ops for seamless `publish_edit -> propose_dao_edit` flows
- **Name-based resolution** - reference properties, types, and entities by name instead of IDs
- **Gas-sponsored smart accounts** - no testnet ETH needed (uses Pimlico paymaster)
- **Secure local file ingestion** - load local JSON/markdown/text files from allowlisted paths

## Installation

```bash
npm install
npm run build
```

## Configuration

Add to your MCP client config (e.g. Claude Code `.mcp.json`):

```json
{
  "mcpServers": {
    "geo": {
      "command": "node",
      "args": ["/path/to/geo-mcp-server/dist/index.js"],
      "env": {
        "GEO_PRIVATE_KEY": "0x...",
        "GEO_MCP_ALLOWED_PATHS": "/Users/me/Documents/research,/tmp"
      }
    }
  }
}
```

The `GEO_PRIVATE_KEY` environment variable is optional at startup - you can also configure the wallet at runtime using the `configure_wallet` tool.
`GEO_MCP_ALLOWED_PATHS` is optional and lets you allow additional directories for `read_local_file` and `create_knowledge_graph_from_file`. By default, only the current working directory is allowed.

## Quick Start

Typical workflow:

1. **Configure wallet** - `configure_wallet` with your private key
2. **Setup space** - `setup_space` creates or finds your personal space
3. **Build knowledge** - use any graph tools to create properties, types, entities, and relations
4. **Publish** - `publish_edit` sends all accumulated ops on-chain in one transaction

### Example: Create a Knowledge Graph in One Call

Use `create_knowledge_graph` for the best UX - it builds schema, entities, and relations all at once with name-based references:

```
create_knowledge_graph({
  schema: {
    properties: [
      { name: "Founded", dataType: "DATE" },
      { name: "Website", dataType: "TEXT" }
    ],
    types: [
      { name: "Company", propertyNames: ["Founded", "Website"] }
    ]
  },
  entities: [
    {
      name: "Geo",
      typeName: "Company",
      values: [
        { propertyName: "Founded", type: "date", value: "2024-01-01" },
        { propertyName: "Website", type: "text", value: "https://geo.xyz" }
      ]
    }
  ]
})
```

### Example: Publish a Local Graph Payload File

When your extraction pipeline writes a JSON payload locally, use one call to ingest it:

```
create_knowledge_graph_from_file({
  filePath: "./outputs/claimify-paper-graph.json"
})
```

Expected JSON shape inside the file:
- `{ "schema": { ... }, "entities": [...], "relations": [...] }`
- or `{ "payload": { "schema": { ... }, "entities": [...], "relations": [...] } }`

## Tools Reference

### Graph Operations (8 tools)

| Tool | Description |
|------|-------------|
| `create_property` | Create a property definition with a data type |
| `create_type` | Create a type (schema) grouping properties |
| `create_entity` | Create an entity with types, values, and relations |
| `create_relation` | Create a relation between two entities |
| `create_image` | Create an image entity from a URL |
| `update_entity` | Update an existing entity's name, values, or properties |
| `delete_entity` | Delete an entity |
| `delete_relation` | Delete a relation |

### Space & Publishing (6 tools)

| Tool | Description |
|------|-------------|
| `configure_wallet` | Set up wallet with a private key for publishing |
| `setup_space` | Create or find your personal space |
| `publish_edit` | Publish all accumulated ops as one on-chain edit |
| `propose_dao_edit` | Propose accumulated ops as a DAO governance edit |
| `get_session_status` | View current session state (ops count, artifacts, wallet) |
| `clear_session` | Discard all accumulated ops |

### Advanced UX (7 tools)

| Tool | Description |
|------|-------------|
| `generate_id` | Generate one or more unique Geo IDs (dashless UUID v4) |
| `build_schema` | Create properties + types in one call with name-based references |
| `create_knowledge_graph` | Build complete graph (schema + entities + relations) in one call |
| `create_knowledge_graph_from_file` | Build complete graph from a local JSON file payload |
| `read_local_file` | Read local text/json/binary (base64) from allowlisted paths |
| `add_values_to_entity` | Add multiple property values to an existing entity |
| `get_system_ids` | Get well-known Geo system IDs (types, properties, data types) |

### Supported Data Types

`TEXT`, `INTEGER`, `FLOAT`, `BOOLEAN`, `DATE`, `TIME`, `DATETIME`, `SCHEDULE`, `POINT`, `DECIMAL`, `BYTES`, `EMBEDDING`, `RELATION`

## Development

```bash
npm run dev        # Run with tsx (hot reload)
npm run build      # Compile TypeScript
npm run typecheck  # Type check without emitting
npm start          # Run compiled version
```

## Network

Currently operates on the Geo **testnet**.

## License

MIT
