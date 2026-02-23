# Geo MCP Server

MCP server that provides full access to the Geo protocol SDK for knowledge graph operations.

## Architecture

- `src/index.ts` - Entry point (stdio transport)
- `src/server.ts` - Server setup, registers all tool modules
- `src/state/session.ts` - Singleton edit session managing op accumulation
- `src/tools/graph.ts` - Core graph operations (create/update/delete property, type, entity, relation, image)
- `src/tools/spaces.ts` - Wallet config, space management, publishing, DAO proposals
- `src/tools/advanced.ts` - High-level UX tools (build_schema, create_knowledge_graph, get_system_ids)
- `src/tools/read.ts` - Read/query tools via GraphQL API (search, get entity/space/proposal, list)
- `src/tools/governance.ts` - DAO governance write tools (vote, propose editor/subspace changes)
- `src/tools/helpers.ts` - Shared `ok()`/`err()` MCP response helpers
- `src/utils/wallet.ts` - Shared wallet configuration helpers (ensureWalletConfigured, normalizeAddress)
- `src/api/client.ts` - Fetch-based GraphQL client + UUID format helpers

## Key Design Decisions

- **Session-based op accumulation**: All graph operations auto-accumulate ops in a singleton session. `publish_edit` sends all accumulated ops as one edit, then clears the session.
- **Smart account by default**: Uses Geo's gas-sponsored smart accounts (Pimlico paymaster) so users don't need testnet ETH.
- **Name-based resolution**: High-level tools like `create_knowledge_graph` resolve references by name, not ID.
- **Dashless UUID convention**: All IDs returned to MCP consumers use dashless 32-char hex. The GraphQL API uses dashed UUIDs internally.

## Research Ontology Tool

`create_research_ontology_paper_and_claims` is a specialized tool for publishing research papers using the canonical GeoBrowser Research ontology types (Paper, Claim, Person, Project, Topic). It guarantees claims use the canonical `Claim` type (`96f859efa1ca4b229372c86ad58b694b`) so they render correctly in Knowledgebook/GeoBrowser.

**CRITICAL**: Always use this tool for research publishing instead of `build_schema` or `create_knowledge_graph` — those create local types that don't match the canonical schema.

## Batch Operations & Session Management

When running multiple proposals in one MCP server session (e.g., batch deletions):

1. After each `propose_dao_edit` or `publish_edit`, the session clears automatically
2. Before the next batch, call `clear_session()` then `setup_space()` again
3. Batch size of ~50 ops per proposal works reliably
4. `propose_dao_edit` only creates the proposal — it does NOT vote. Use `vote_on_proposal` to vote separately.

## SDK Dependencies

- `@geoprotocol/geo-sdk` - Main SDK (Graph, personalSpace, daoSpace, wallets)
- `@geoprotocol/grc-20` - Binary protocol types (Op, Edit)
- `@modelcontextprotocol/sdk` - MCP server framework
- `viem` - Ethereum interaction
- `vitest` - Test framework (dev)

## Commands

```bash
npm run build      # Compile TypeScript
npm run dev        # Run with tsx (development)
npm start          # Run compiled version
npm run typecheck  # Type check without emitting
npm test           # Run unit tests
npm run test:watch # Run tests in watch mode
npm run test:coverage # Run tests with coverage
```

## Environment Variables

- `GEO_PRIVATE_KEY` - Hex private key for wallet (optional, can use configure_wallet at runtime)
- `GEO_MCP_ALLOWED_PATHS` - Comma-separated additional directories for file read tools
- `GEO_GRAPHQL_URL` - Override GraphQL endpoint (default: `https://api-testnet.geobrowser.io/graphql`)

## Network

Currently hardcoded to TESTNET. The SDK's `Network` type only supports `'TESTNET'`.

## Related Repositories

### mcp_deployments_registry

CI/CD pipeline that syncs MCP marketplace data to the Geo knowledge graph. Located at `../mcp_deployments_registry`. Uses `@geoprotocol/geo-sdk` directly (not via this MCP server) for automated publishing.

**Both repos target the same DAO space**: `6b05a4fc85e69e56c15e2c6891e1df32` at address `0xd3a0cce0d01214a1fc5cdedf8ca78bc1618f7c2f`.

#### Research Paper Publishing

The registry repo hosts the `research-paper-analyst` agent (`.claude/agents/research-paper-analyst.md`) which **uses this MCP server's** `create_research_ontology_paper_and_claims` tool for publishing papers. The agent page is at https://mcpmarketplace.rickydata.org/agents/research-paper-analyst.

The `geo-publish-research` skill (`.claude/skills/geo-publish-research/SKILL.md`) in the registry repo contains the canonical type/property ID tables used for verification.

**DEPRECATED legacy scripts** (do NOT use for new research publishing):
- `mcp-marketplace/scripts/geo-research-schema.mjs` - Old schema definitions using custom Research Paper/Research Claim types
- `mcp-marketplace/scripts/publish-research-to-dao.mjs` - Old script that creates non-canonical types

These legacy scripts create local type definitions that do NOT match the canonical Research ontology. Always use `create_research_ontology_paper_and_claims` instead.

#### MCP Marketplace Scripts (active)

Key scripts in `mcp-marketplace/scripts/`:
- `publish-to-dao.mjs` - Publishes MCP server entities to the DAO space. Supports `--dry-run`, `--update-existing`, `--create-tools`, `--create-skills`, `--link-tools`, `--fix-schema`, and `--vote-pending <proposalId>`. Fetches server data from KFDB, creates entities with schema/relations, proposes DAO edits, votes YES, and auto-executes.
- `clear-research-from-dao.mjs` - Deletes legacy research pipeline data (Research Paper/Claim/Author/Venue types and their instances) from the DAO space. Has safety guards to protect MCP registry entities. Supports `--dry-run`.
- `sync-to-geo.mjs` - Syncs MCP registry data to a personal Geo space.
- `geo-schema.mjs` - Shared schema definitions, property builders, and migration logic.

Key workflows (currently disabled, in `.github/workflows/`):
- `sync-to-geo.yml` - Daily personal space sync (4 AM UTC).
- `sync-to-dao.yml` - Daily DAO space sync (5 AM UTC), runs after personal space sync.

Both scripts use the same wallet (`GEO_PRIVATE_KEY`) and personal space ID (`0xbaddbe29ee5c1764925996eafba6d00f`) as the caller for DAO proposals.

### knowledgebook

Agent social media feed platform. Located at `../knowledgebook`. A monorepo with `api`, `mcp-server`, `cli`, and `web` workspaces.

Reads from the Geo knowledge graph (same testnet GraphQL API) to display research papers and claims published via this MCP server. Its `api/src/services/geo-schema-ids.ts` contains hardcoded IDs for research paper/claim types and properties that were created by this server's `create_research_paper_and_claims` tool. The knowledgebook points to a different space address (`0x524dc10f5e3e35063b004afc92012d0b46e89407`) for its read queries — this is the personal space (rickydata), not the DAO space.
