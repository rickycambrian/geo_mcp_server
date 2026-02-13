# Geo MCP Server

MCP server that provides full access to the Geo protocol SDK for knowledge graph operations.

## Architecture

- `src/index.ts` - Entry point (stdio transport)
- `src/server.ts` - Server setup, registers all tool modules
- `src/state/session.ts` - Singleton edit session managing op accumulation
- `src/tools/graph.ts` - Core graph operations (create/update/delete property, type, entity, relation, image)
- `src/tools/spaces.ts` - Wallet config, space management, publishing, DAO proposals
- `src/tools/advanced.ts` - High-level UX tools (build_schema, create_knowledge_graph, get_system_ids)

## Key Design Decisions

- **Session-based op accumulation**: All graph operations auto-accumulate ops in a singleton session. `publish_edit` sends all accumulated ops as one edit, then clears the session.
- **Smart account by default**: Uses Geo's gas-sponsored smart accounts (Pimlico paymaster) so users don't need testnet ETH.
- **Name-based resolution**: High-level tools like `create_knowledge_graph` resolve references by name, not ID.

## SDK Dependencies

- `@geoprotocol/geo-sdk` - Main SDK (Graph, personalSpace, daoSpace, wallets)
- `@geoprotocol/grc-20` - Binary protocol types (Op, Edit)
- `@modelcontextprotocol/sdk` - MCP server framework
- `viem` - Ethereum interaction

## Commands

```bash
npm run build    # Compile TypeScript
npm run dev      # Run with tsx (development)
npm start        # Run compiled version
npm run typecheck # Type check without emitting
```

## Network

Currently hardcoded to TESTNET. The SDK's `Network` type only supports `'TESTNET'`.
