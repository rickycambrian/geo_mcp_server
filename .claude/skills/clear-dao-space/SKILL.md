---
name: clear-dao-space
description: Clear all entities and relations from the rickydata DAO Geo space. Supports dry-run mode, batch sizing, total limits, and fire-and-forget --all mode.
disable-model-invocation: true
---

# Clear DAO Space

Wipe ALL entities and relations from the DAO space (`6b05a4fc85e69e56c15e2c6891e1df32`).

**IMPORTANT**: This is a destructive operation. Always run with `--dry-run` first.

## Quick Start

Dry run (fast count query, no pagination):
```bash
npm run clear-dao -- --dry-run
```

Fire-and-forget full deletion (loops until empty):
```bash
npx tsx scripts/clear-dao-space.ts --all --yes --batch-size 5000
```

## Usage Examples

Dry run with limit (paginates up to N items per type for sampling):
```bash
npm run clear-dao -- --dry-run --limit 100
```

Test a small batch live:
```bash
npm run clear-dao -- --total-limit 100 --batch-size 100 --yes
```

Medium batch (5K items):
```bash
npm run clear-dao -- --total-limit 5000 --batch-size 5000 --yes
```

Full run with --all (loops in 50K chunks until empty):
```bash
npx tsx scripts/clear-dao-space.ts --all --yes --batch-size 5000
```

With space rename after clearing:
```bash
npm run clear-dao -- --all --yes --rename "New Space Name"
```

## Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview what would be deleted without on-chain actions |
| `--limit N` | Limit N items per type (entities and relations separately) |
| `--total-limit N` | Limit combined total (relations processed first, then entities) |
| `--all` | Loop in 50K chunks until space is empty |
| `--yes` / `-y` | Skip interactive confirmation prompt |
| `--batch-size N` | Ops per DAO proposal (default: 5000). Each batch = one proposal + vote + execute |
| `--rename "Name"` | Rename the space entity after clearing |

## How It Works

1. Queries all entities in the DAO space via GraphQL (`testnet-api.geobrowser.io/graphql`)
   - Uses `CREATED_AT_ASC` ordering to process oldest content first
   - Filters out Account-type entities and wallet-address-named entities (these are created by governance and would just be recreated)
2. Queries all relations in the space
3. Builds delete ops: relations first, then entities
4. For each batch:
   - First batch includes Account.make() ops if no existing Account entity is found
   - Subsequent batches reuse the existing Account entity ID (no new creation)
   - Proposes a DAO edit via `daoSpace.proposeEdit()` with FAST voting
   - Self-votes YES via `SpaceRegistryAbi.enter()` pattern
   - Auto-executes if vote threshold reached; checks `DaoSpaceAbi.getLatestProposalInformation()` and `isSupportThresholdReached()`
5. Sleeps 4s between batches to avoid rate limiting
6. Post-verifies by querying final entity/relation counts
7. Logs progress to `backups/deletion-progress.jsonl`

## Key Design Patterns

### Account Entity Reuse
The script queries for an existing Account entity (type `cb69723f7456471aa8ad3e93ddc3edfe`) before creating a new one. This prevents the governance page from being flooded with duplicate Account entities. Only the first batch of the first-ever run creates a new Account.

### SpaceRegistryAbi.enter() for Voting
Self-voting uses the `SpaceRegistryAbi.enter()` pattern with `PROPOSAL_VOTED_ACTION`, NOT `MainVotingAbi.vote()`. The VoteOption enum differs between the two approaches:
- **SpaceRegistryAbi.enter()**: None=0, Yes=1, No=2, Abstain=3
- **MainVotingAbi.vote()**: None=0, Abstain=1, Yes=2, No=3

### Batch Size Guidance
- Each batch takes ~13-14 seconds regardless of size (dominated by on-chain tx time)
- Larger batches are more efficient: 5000 ops/batch = ~5000 items per 14 seconds
- Default of 5000 works reliably; tested up to 10000
- At 5000 ops/batch: ~345K items takes ~69 batches = ~15 minutes

## Performance Data (from execution logs)

| Batch Size | Batches per 1K ops | Time per batch | Throughput |
|------------|-------------------|----------------|------------|
| 45 | 23 | ~17s | ~148 items/min |
| 500 | 2 | ~15s | ~1900 items/min |
| 1000 | 1 | ~13s | ~4380 items/min |
| 5000 | 1 | ~14s | ~21,400 items/min |

## Requirements

- `GEO_PRIVATE_KEY` (or `PK`) must be set in the repo root `.env` file
- The wallet must be an editor of the DAO space
- Node >= 18

## Environment

- DAO Space ID: `6b05a4fc85e69e56c15e2c6891e1df32`
- DAO Space Address: `0xd3a0cce0d01214a1fc5cdedf8ca78bc1618f7c2f`
- GraphQL: `testnet-api.geobrowser.io/graphql` (supports `spaceId` arg on `entitiesConnection`)
- Progress log: `backups/deletion-progress.jsonl`

## When to Use

- Before re-publishing fresh data to the DAO space
- To clean up after failed or partial syncs
- When resetting the space for testing
