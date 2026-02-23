#!/usr/bin/env npx tsx

/**
 * Clear ALL entities and relations from the rickydata personal Geo space.
 *
 * Unlike clear-dao-space.ts, this uses personalSpace.publishEdit() directly —
 * no governance overhead (no proposals, votes, or execution steps).
 *
 * Usage:
 *   npx tsx scripts/clear-personal-space.ts --dry-run
 *   npx tsx scripts/clear-personal-space.ts --dry-run --limit 100
 *   npx tsx scripts/clear-personal-space.ts --total-limit 100 --yes
 *   npx tsx scripts/clear-personal-space.ts --all --yes --batch-size 5000
 *   npx tsx scripts/clear-personal-space.ts --rename "My New Space Name"
 *
 * Flags:
 *   --dry-run          Preview without on-chain actions
 *   --limit N          Limit per-type (N entities + N relations)
 *   --total-limit N    Limit combined total (relations first, then entities)
 *   --all              Loop until space is empty (processes in 50K chunks)
 *   --yes / -y         Skip confirmation prompt
 *   --batch-size N     Ops per publish batch (default: 5000)
 *   --rename "Name"    Rename the space entity after deletion
 *   --type <typeId>    Only delete entities matching this type ID
 *   --exclude-type <typeId>  Skip entities of this type
 *
 * Environment:
 *   GEO_PRIVATE_KEY or PK (loaded from repo root .env)
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Graph,
  Account,
  personalSpace,
  getSmartAccountWalletClient,
  TESTNET_RPC_URL,
} from '@geoprotocol/geo-sdk';
import { SpaceRegistryAbi } from '@geoprotocol/geo-sdk/abis';
import { TESTNET } from '@geoprotocol/geo-sdk/contracts';
import { createPublicClient, http } from 'viem';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Constants ────────────────────────────────────────────────────────────────

const GEO_GRAPHQL_URL = 'https://testnet-api.geobrowser.io/graphql';

// Account type ID — entities of this type are created by Account.make() in every publish.
// We must skip deleting these; they get recreated immediately.
const ACCOUNT_TYPE_ID = 'cb69723f7456471aa8ad3e93ddc3edfe';

const DEFAULT_BATCH_SIZE = 5_000;
const SLEEP_BETWEEN_BATCHES_MS = 2_000;

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function parseStringArg(flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function parseIntArg(flag: string): number | null {
  const val = parseStringArg(flag);
  if (val === null) return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

const RENAME_TO = parseStringArg('--rename');
const LIMIT = parseIntArg('--limit');
const TOTAL_LIMIT = parseIntArg('--total-limit');
const YES = args.includes('--yes') || args.includes('-y');
const ALL = args.includes('--all');
const INCLUDE_ACCOUNTS = args.includes('--include-accounts');
const BATCH_SIZE = parseIntArg('--batch-size') ?? DEFAULT_BATCH_SIZE;
const TYPE_FILTER = parseStringArg('--type');
const EXCLUDE_TYPE_FILTER = parseStringArg('--exclude-type');

const PROGRESS_LOG_PATH = join(__dirname, '..', 'backups', 'personal-deletion-progress.jsonl');

const CONFIRM_THRESHOLD = 1_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withHexPrefix(value: string): `0x${string}` {
  const trimmed = value.trim().toLowerCase();
  return (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as `0x${string}`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function loadRootEnv(): void {
  const envPath = join(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function writeProgressLog(entry: Record<string, unknown>): void {
  const dir = dirname(PROGRESS_LOG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(PROGRESS_LOG_PATH, JSON.stringify(entry) + '\n');
}

function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
    });
  });
}

// ── GraphQL helpers ──────────────────────────────────────────────────────────

interface GqlResponse {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string }>;
}

async function gqlFetch(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(GEO_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Geo GraphQL error: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as GqlResponse;
  if (json.errors?.length) throw new Error(`Geo GraphQL error: ${json.errors[0].message}`);
  return json.data!;
}

interface EntityNode {
  id: string;
  name: string | null;
  typeIds: string[];
  propertyIds: string[];
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface RelationNode {
  id: string;
  typeId: string;
  fromEntityId: string;
  toEntityId: string;
}

async function getTotalCounts(spaceId: string): Promise<{ entities: number; relations: number }> {
  const data = await gqlFetch(
    `query($spaceId: UUID!) {
      entitiesConnection(first: 0, spaceId: $spaceId) { totalCount }
      relationsConnection(first: 0, filter: { spaceId: { is: $spaceId } }) { totalCount }
    }`,
    { spaceId },
  );
  const ec = data.entitiesConnection as { totalCount: number };
  const rc = data.relationsConnection as { totalCount: number };
  return { entities: ec.totalCount, relations: rc.totalCount };
}

async function findExistingAccountId(spaceId: string): Promise<string | null> {
  try {
    const data = await gqlFetch(
      `query($spaceId: UUID!) {
        entitiesConnection(first: 10, spaceId: $spaceId, orderBy: UPDATED_AT_DESC) {
          nodes { id name typeIds }
        }
      }`,
      { spaceId },
    );
    const conn = data.entitiesConnection as { nodes: EntityNode[] };
    for (const node of conn.nodes) {
      if (node.typeIds.includes(ACCOUNT_TYPE_ID)) return node.id;
      if (node.name && /^0x[a-fA-F0-9]{40}$/i.test(node.name)) return node.id;
    }
    return null;
  } catch {
    return null;
  }
}

async function listAllEntities(spaceId: string, limit?: number | null): Promise<EntityNode[]> {
  const out: EntityNode[] = [];
  let after: string | null = null;
  let page = 0;
  while (true) {
    page++;
    const remaining = limit ? limit - out.length : 200;
    const first = Math.min(200, remaining);
    if (first <= 0) break;

    process.stdout.write(`\r     fetching page ${page} (${out.length} so far)...`);
    const data = await gqlFetch(
      `query($spaceId: UUID, $first: Int!, $after: Cursor) {
        entitiesConnection(first: $first, after: $after, spaceId: $spaceId, orderBy: CREATED_AT_ASC) {
          pageInfo { hasNextPage endCursor }
          nodes { id name typeIds valuesList { propertyId } }
        }
      }`,
      { spaceId, first, after },
    );
    interface RawEntityNode { id: string; name: string | null; typeIds: string[]; valuesList: Array<{ propertyId: string }> }
    const conn = data.entitiesConnection as { pageInfo: PageInfo; nodes: RawEntityNode[] };
    out.push(...conn.nodes.map(n => ({
      id: n.id,
      name: n.name,
      typeIds: n.typeIds,
      propertyIds: [...new Set(n.valuesList.map(v => v.propertyId))],
    })));
    if (!conn.pageInfo.hasNextPage) break;
    if (limit && out.length >= limit) break;
    after = conn.pageInfo.endCursor;
  }
  process.stdout.write('\r' + ' '.repeat(60) + '\r');
  return limit ? out.slice(0, limit) : out;
}

async function listAllRelations(spaceId: string, limit?: number | null): Promise<RelationNode[]> {
  const out: RelationNode[] = [];
  let after: string | null = null;
  let page = 0;
  while (true) {
    page++;
    const remaining = limit ? limit - out.length : 200;
    const first = Math.min(200, remaining);
    if (first <= 0) break;

    process.stdout.write(`\r     fetching page ${page} (${out.length} so far)...`);
    const data = await gqlFetch(
      `query($first: Int!, $after: Cursor, $spaceId: UUID!) {
        relationsConnection(
          first: $first,
          after: $after,
          filter: { spaceId: { is: $spaceId } }
        ) {
          pageInfo { hasNextPage endCursor }
          nodes { id typeId fromEntityId toEntityId }
        }
      }`,
      { first, after, spaceId },
    );
    const conn = data.relationsConnection as { pageInfo: PageInfo; nodes: RelationNode[] };
    out.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage) break;
    if (limit && out.length >= limit) break;
    after = conn.pageInfo.endCursor;
  }
  process.stdout.write('\r' + ' '.repeat(60) + '\r');
  return limit ? out.slice(0, limit) : out;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadRootEnv();

  const privateKey = process.env.GEO_PRIVATE_KEY || process.env.PK || process.env.TEST_WALLET_PRIVATE_KEY;
  if (!privateKey) {
    console.error('ERROR: Set GEO_PRIVATE_KEY (or PK) in repo root .env');
    process.exit(1);
  }
  const hexKey = withHexPrefix(privateKey);

  console.log('=== Clear ALL Entities & Relations From Personal Space ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  if (RENAME_TO) console.log(`Rename to: "${RENAME_TO}"`);
  if (ALL) console.log('Mode: --all (loop until empty, 50K chunks)');
  if (TOTAL_LIMIT) console.log(`Total limit: ${TOTAL_LIMIT} combined items`);
  else if (LIMIT) console.log(`Limit: ${LIMIT} items per type`);
  if (BATCH_SIZE !== DEFAULT_BATCH_SIZE) console.log(`Batch size: ${BATCH_SIZE} (custom)`);
  if (TYPE_FILTER) console.log(`Type filter: only entities with type ${TYPE_FILTER}`);
  if (EXCLUDE_TYPE_FILTER) console.log(`Exclude type: skip entities with type ${EXCLUDE_TYPE_FILTER}`);
  if (YES) console.log('Confirmation: skipped (--yes)');

  // Initialize wallet + resolve personal space ID
  const smartAccount = await getSmartAccountWalletClient({ privateKey: hexKey });
  const publicClient = createPublicClient({ transport: http(TESTNET_RPC_URL) });

  const rawSpaceId = await publicClient.readContract({
    address: TESTNET.SPACE_REGISTRY_ADDRESS as `0x${string}`,
    abi: SpaceRegistryAbi,
    functionName: 'addressToSpaceId',
    args: [smartAccount.account.address],
  });
  const personalSpaceId = String(rawSpaceId).slice(2, 34).toLowerCase();
  const personalSpaceIdHex = `0x${personalSpaceId}` as `0x${string}`;
  console.log(`\n   Smart account: ${smartAccount.account.address}`);
  console.log(`   Personal space ID: ${personalSpaceIdHex}`);

  // Dry-run fast path: just query counts
  if (DRY_RUN && !LIMIT && !TOTAL_LIMIT && !TYPE_FILTER && !EXCLUDE_TYPE_FILTER) {
    console.log('\n1) Querying total counts in personal space...');
    const counts = await getTotalCounts(personalSpaceId);
    console.log(`   Total entities:  ${counts.entities}`);
    console.log(`   Total relations: ${counts.relations}`);

    console.log('\n=== DRY RUN Summary ===');
    console.log(`  Relations to delete: ${counts.relations}`);
    console.log(`  Entities to delete:  ${counts.entities}`);
    const totalOps = counts.relations + counts.entities;
    const batchCount = Math.ceil(totalOps / BATCH_SIZE);
    console.log(`  Total ops: ${totalOps} across ~${batchCount} batches (batchSize=${BATCH_SIZE})`);
    if (RENAME_TO) console.log(`  Space entity rename: "${RENAME_TO}" (1 additional batch)`);
    console.log('\nDRY RUN complete. No on-chain actions performed.');
    return;
  }

  // --all mode: loop in chunks until empty
  if (ALL) {
    const allStart = Date.now();
    let pass = 0;
    let totalOpsAll = 0;
    let totalCompletedAll = 0;
    let totalFailedAll = 0;

    while (true) {
      pass++;
      console.log(`\n${'='.repeat(60)}`);
      console.log(`=== Pass ${pass} ===`);
      console.log('='.repeat(60));

      const result = await runDeletionPass({
        smartAccount, personalSpaceId, personalSpaceIdHex,
        chunkLimit: 50_000, skipConfirm: true,
      });

      totalOpsAll += result.opsAttempted;
      totalCompletedAll += result.batchesCompleted;
      totalFailedAll += result.batchesFailed;

      if (result.countsAfter.entities === 0 && result.countsAfter.relations === 0) {
        console.log('\n   Space is clean! All items deleted.');
        break;
      }

      if (result.opsAttempted === 0) {
        console.log('\n   No items found to delete. Done.');
        break;
      }

      console.log(`\n   Pass ${pass} done. ${result.countsAfter.entities} entities + ${result.countsAfter.relations} relations remain. Starting next pass...`);
    }

    const allElapsed = Date.now() - allStart;
    console.log(`\n${'='.repeat(60)}`);
    console.log('=== ALL PASSES COMPLETE ===');
    console.log(`  Passes: ${pass}`);
    console.log(`  Total ops: ${totalOpsAll}`);
    console.log(`  Total batches: ${totalCompletedAll} completed, ${totalFailedAll} failed`);
    console.log(`  Total time: ${formatMs(allElapsed)}`);
    if (allElapsed > 0 && totalOpsAll > 0) {
      console.log(`  Overall throughput: ${(totalOpsAll / (allElapsed / 60_000)).toFixed(1)} items/min`);
    }
    console.log('='.repeat(60));

    if (RENAME_TO) {
      await runRename(smartAccount, personalSpaceId, personalSpaceIdHex);
    }
    return;
  }

  // Single-pass mode
  const result = await runDeletionPass({
    smartAccount, personalSpaceId, personalSpaceIdHex,
    chunkLimit: TOTAL_LIMIT ?? undefined, skipConfirm: false,
  });

  if (result.aborted) return;

  if (RENAME_TO) {
    await runRename(smartAccount, personalSpaceId, personalSpaceIdHex);
  }

  console.log('\n=== Done ===');
}

// ── Deletion pass ─────────────────────────────────────────────────────────────

type SmartAccount = Awaited<ReturnType<typeof getSmartAccountWalletClient>>;

interface PassResult {
  aborted: boolean;
  opsAttempted: number;
  batchesCompleted: number;
  batchesFailed: number;
  elapsedMs: number;
  countsBefore: { entities: number; relations: number };
  countsAfter: { entities: number; relations: number };
}

async function runDeletionPass(opts: {
  smartAccount: SmartAccount;
  personalSpaceId: string;
  personalSpaceIdHex: `0x${string}`;
  chunkLimit?: number;
  skipConfirm: boolean;
}): Promise<PassResult> {
  const { smartAccount, personalSpaceId, personalSpaceIdHex, chunkLimit, skipConfirm } = opts;

  const empty: PassResult = {
    aborted: false, opsAttempted: 0, batchesCompleted: 0, batchesFailed: 0,
    elapsedMs: 0,
    countsBefore: { entities: 0, relations: 0 },
    countsAfter: { entities: 0, relations: 0 },
  };

  // 0) Get before-counts
  console.log('\n0) Querying before-counts...');
  const countsBefore = await getTotalCounts(personalSpaceId);
  console.log(`   Entities before:  ${countsBefore.entities}`);
  console.log(`   Relations before: ${countsBefore.relations}`);

  // Determine per-type limits
  const effectiveLimit = chunkLimit ?? (TOTAL_LIMIT ?? undefined);
  let entityLimit = LIMIT;
  let relationLimit = LIMIT;
  if (effectiveLimit) {
    relationLimit = effectiveLimit;
    entityLimit = effectiveLimit;
  }

  // 1) Query entities
  console.log('\n1) Querying entities in personal space...');
  let entities = await listAllEntities(personalSpaceId, entityLimit);
  const beforeFilter = entities.length;

  // Filter out Account entities unless --include-accounts
  if (!INCLUDE_ACCOUNTS) {
    entities = entities.filter((e) => {
      if (e.typeIds.includes(ACCOUNT_TYPE_ID)) return false;
      if (e.name && /^0x[a-fA-F0-9]{40}$/i.test(e.name)) return false;
      return true;
    });
  }

  // Apply --type filter
  if (TYPE_FILTER) {
    entities = entities.filter((e) => e.typeIds.includes(TYPE_FILTER));
  }

  // Apply --exclude-type filter
  if (EXCLUDE_TYPE_FILTER) {
    entities = entities.filter((e) => !e.typeIds.includes(EXCLUDE_TYPE_FILTER));
  }

  console.log(`   Found ${entities.length} entities (filtered out ${beforeFilter - entities.length})`);

  if (entities.length > 0) {
    const sample = entities.slice(0, 5).map((e) => `  - ${e.id} :: ${e.name ?? '(unnamed)'}`);
    console.log('   Sample:');
    for (const s of sample) console.log(`   ${s}`);
    if (entities.length > 5) console.log(`   ... and ${entities.length - 5} more`);
  }

  // 2) Query relations
  console.log('\n2) Querying relations in personal space...');
  let relations = await listAllRelations(personalSpaceId, relationLimit);
  console.log(`   Found ${relations.length} relations`);

  // Trim to total limit if needed
  if (effectiveLimit) {
    const combined = relations.length + entities.length;
    if (combined > effectiveLimit) {
      if (relations.length >= effectiveLimit) {
        relations = relations.slice(0, effectiveLimit);
        entities = [];
      } else {
        entities = entities.slice(0, effectiveLimit - relations.length);
      }
      console.log(`   Trimmed to limit ${effectiveLimit}: ${relations.length} relations + ${entities.length} entities`);
    }
  }

  const totalOps = relations.length + entities.length;

  if (DRY_RUN) {
    console.log('\n=== DRY RUN Summary ===');
    console.log(`  Relations to delete: ${relations.length}`);
    console.log(`  Entities to delete:  ${entities.length}`);
    const batchCount = Math.ceil(totalOps / BATCH_SIZE);
    console.log(`  Total ops: ${totalOps} across ~${batchCount} batches (batchSize=${BATCH_SIZE})`);
    if (RENAME_TO) console.log(`  Space entity rename: "${RENAME_TO}" (1 additional batch)`);
    console.log('\nDRY RUN complete. No on-chain actions performed.');
    return { ...empty, aborted: true, countsBefore, countsAfter: countsBefore };
  }

  if (totalOps === 0) {
    console.log('\nNothing to delete.');
    return { ...empty, countsBefore, countsAfter: countsBefore };
  }

  // Confirmation prompt for >1000 items
  if (!skipConfirm && !YES && totalOps > CONFIRM_THRESHOLD) {
    const batchCount = Math.ceil(totalOps / BATCH_SIZE);
    console.log(`\n   About to delete ${totalOps.toLocaleString()} items (${relations.length} relations + ${entities.length} entities)`);
    console.log(`   This will create ~${batchCount} publish edits.`);
    const ok = await confirm('   Proceed? (y/N) ');
    if (!ok) {
      console.log('   Aborted.');
      return { ...empty, aborted: true, countsBefore, countsAfter: countsBefore };
    }
  }

  // 3) Build delete ops
  console.log('\n3) Building deletion batches...');

  const deletions: Array<{ kind: 'relation' | 'entity'; id: string; propertyIds?: string[] }> = [
    ...relations.map((r) => ({ kind: 'relation' as const, id: r.id })),
    ...entities.map((e) => ({ kind: 'entity' as const, id: e.id, propertyIds: e.propertyIds })),
  ];

  const totalOpsEstimate = relations.length + entities.length * 2;
  const batches = chunk(deletions, BATCH_SIZE);
  console.log(`   Total items: ${deletions.length} (${relations.length} relations + ${entities.length} entities)`);
  console.log(`   Estimated ops: ~${totalOpsEstimate} across ${batches.length} batches (batchSize=${BATCH_SIZE})`);

  // 4) Publish each batch
  console.log('\n4) Publishing deletion batches to personal space...');

  // Try to reuse an existing Account entity
  let accountId: string;
  let accountOps: unknown[] = [];
  const existingAccountId = await findExistingAccountId(personalSpaceId);
  if (existingAccountId) {
    accountId = existingAccountId;
    accountOps = [];
    console.log(`   Reusing existing Account entity: ${existingAccountId}`);
  } else {
    const result = Account.make(smartAccount.account.address);
    accountId = result.accountId;
    accountOps = result.ops;
    console.log(`   Creating new Account entity: ${accountId}`);
  }

  const overallStart = Date.now();
  const batchTimes: number[] = [];
  let failedBatches = 0;
  let completedBatches = 0;

  for (let i = 0; i < batches.length; i++) {
    const batchStart = Date.now();
    const batch = batches[i];
    const batchName = `Clear personal space (${i + 1}/${batches.length})`;
    console.log(`\n   Batch ${i + 1}/${batches.length}: ${batch.length} delete ops`);

    try {
      const ops: unknown[] = [];
      for (const item of batch) {
        if (item.kind === 'relation') {
          const result = Graph.deleteRelation({ id: item.id });
          ops.push(...result.ops);
        } else {
          if (item.propertyIds && item.propertyIds.length > 0) {
            const unsetResult = Graph.updateEntity({
              id: item.id,
              unset: item.propertyIds.map(p => ({ property: p, language: 'all' as const })),
            });
            ops.push(...unsetResult.ops);
          }
          const result = Graph.deleteEntity({ id: item.id });
          ops.push(...result.ops);
        }
      }

      const allOps = i === 0 && accountOps.length > 0 ? [...accountOps, ...ops] : ops;

      // personalSpace.publishEdit() — no governance, direct publish
      // spaceId expects dashless 32-char hex (no 0x prefix)
      const { to, calldata } = await personalSpace.publishEdit({
        name: batchName,
        ops: allOps as Parameters<typeof personalSpace.publishEdit>[0]['ops'],
        author: accountId,
        spaceId: personalSpaceId,
        network: 'TESTNET',
      });

      const txHash = await smartAccount.sendTransaction({ to, data: calldata });
      console.log(`     tx: ${txHash}`);

      completedBatches++;
    } catch (err) {
      failedBatches++;
      const error = err as Error;
      console.error(`     BATCH FAILED: ${error?.message || String(err)}`);
    }

    // Timing stats
    const batchElapsed = Date.now() - batchStart;
    batchTimes.push(batchElapsed);
    const avgBatchMs = batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length;
    const remaining = batches.length - (i + 1);
    const etaMs = remaining * avgBatchMs;
    console.log(`     batch time: ${formatMs(batchElapsed)} | avg: ${formatMs(avgBatchMs)} | ETA: ${formatMs(etaMs)} (${remaining} remaining)`);

    if (i < batches.length - 1) await sleep(SLEEP_BETWEEN_BATCHES_MS);
  }

  const overallElapsed = Date.now() - overallStart;

  // 5) Post-verify
  console.log('\n5) Post-verification...');
  const countsAfter = await getTotalCounts(personalSpaceId);
  console.log(`   Entities:  ${countsBefore.entities} → ${countsAfter.entities} (Δ ${countsBefore.entities - countsAfter.entities})`);
  console.log(`   Relations: ${countsBefore.relations} → ${countsAfter.relations} (Δ ${countsBefore.relations - countsAfter.relations})`);

  const totalDeleted = (countsBefore.entities - countsAfter.entities) + (countsBefore.relations - countsAfter.relations);
  const opsAttempted = deletions.length;
  console.log(`   Ops attempted: ${opsAttempted} | Actually deleted: ${totalDeleted}`);

  if (countsAfter.entities === 0 && countsAfter.relations === 0) {
    console.log('   Space is clean!');
  } else {
    console.log('   Items remain. Run the script again to continue.');
  }

  // Timing summary
  console.log('\n=== Timing Summary ===');
  console.log(`  Total elapsed: ${formatMs(overallElapsed)}`);
  console.log(`  Batches: ${completedBatches} completed, ${failedBatches} failed, ${batches.length} total`);
  if (batchTimes.length > 0) {
    const avgMs = batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length;
    const itemsPerMin = (opsAttempted / (overallElapsed / 60_000)).toFixed(1);
    console.log(`  Avg batch time: ${formatMs(avgMs)}`);
    console.log(`  Throughput: ${itemsPerMin} items/min`);
  }

  // Write progress log
  writeProgressLog({
    timestamp: new Date().toISOString(),
    batchSize: BATCH_SIZE,
    entitiesBefore: countsBefore.entities,
    relationsBefore: countsBefore.relations,
    entitiesAfter: countsAfter.entities,
    relationsAfter: countsAfter.relations,
    opsAttempted,
    batchesCompleted: completedBatches,
    batchesFailed: failedBatches,
    elapsedMs: overallElapsed,
  });
  console.log(`  Progress logged to: ${PROGRESS_LOG_PATH}`);

  return {
    aborted: false,
    opsAttempted,
    batchesCompleted: completedBatches,
    batchesFailed: failedBatches,
    elapsedMs: overallElapsed,
    countsBefore,
    countsAfter,
  };
}

// ── Rename helper ─────────────────────────────────────────────────────────────

async function runRename(
  smartAccount: SmartAccount,
  personalSpaceId: string,
  personalSpaceIdHex: `0x${string}`,
): Promise<void> {
  if (!RENAME_TO) return;
  console.log(`\nRenaming space entity to "${RENAME_TO}"...`);

  const renameOps = Graph.updateEntity({ id: personalSpaceId, name: RENAME_TO }).ops;

  let accountId: string;
  let renameAccountOps: unknown[] = [];
  const existingAccountId = await findExistingAccountId(personalSpaceId);
  if (existingAccountId) {
    accountId = existingAccountId;
  } else {
    const result = Account.make(smartAccount.account.address);
    accountId = result.accountId;
    renameAccountOps = result.ops;
  }
  const allOps = [...renameAccountOps, ...renameOps];

  // spaceId expects dashless 32-char hex (no 0x prefix)
  const { to, calldata } = await personalSpace.publishEdit({
    name: `Rename space to "${RENAME_TO}"`,
    ops: allOps as Parameters<typeof personalSpace.publishEdit>[0]['ops'],
    author: accountId,
    spaceId: personalSpaceId,
    network: 'TESTNET',
  });

  const txHash = await smartAccount.sendTransaction({ to, data: calldata });
  console.log(`     tx: ${txHash}`);
}

main().catch((err: unknown) => {
  const error = err as Error;
  console.error('ERROR:', error?.stack || error?.message || String(err));
  process.exit(1);
});
