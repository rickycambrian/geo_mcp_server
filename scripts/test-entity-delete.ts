#!/usr/bin/env npx tsx

/**
 * Test entity deletion by clearing values first, then deleting.
 * Tests with a single entity to confirm the approach works.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Graph,
  Account,
  daoSpace,
  getSmartAccountWalletClient,
  TESTNET_RPC_URL,
} from '@geoprotocol/geo-sdk';
import { SpaceRegistryAbi, DaoSpaceAbi } from '@geoprotocol/geo-sdk/abis';
import { TESTNET } from '@geoprotocol/geo-sdk/contracts';
import {
  createPublicClient,
  http,
  encodeFunctionData,
  encodeAbiParameters,
} from 'viem';

const __dirname = dirname(fileURLToPath(import.meta.url));

const GEO_GRAPHQL_URL = 'https://testnet-api.geobrowser.io/graphql';
const DAO_SPACE_ADDRESS = '0xd3a0cce0d01214a1fc5cdedf8ca78bc1618f7c2f';
const DAO_SPACE_ID_HEX = '0x6b05a4fc85e69e56c15e2c6891e1df32';
const DAO_SPACE_ID = DAO_SPACE_ID_HEX.slice(2);
const ACCOUNT_TYPE_ID = 'cb69723f7456471aa8ad3e93ddc3edfe';

const VoteOption = { None: 0, Yes: 1, No: 2, Abstain: 3 } as const;
const PROPOSAL_VOTED_ACTION = '0x4ebf5f29676cedf7e2e4d346a8433289278f95a9fda73691dc1ce24574d5819e' as `0x${string}`;
const PROPOSAL_EXECUTED_ACTION = '0x62a60c0a9681612871e0dafa0f24bb0c83cbdde8be5a6299979c88d382369e96' as `0x${string}`;

let PERSONAL_SPACE_ID: `0x${string}`;

function withHexPrefix(value: string): `0x${string}` {
  const trimmed = value.trim().toLowerCase();
  return (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as `0x${string}`;
}

function bytes16ToBytes32(b16: string): `0x${string}` {
  return ('0x' + b16.slice(2) + '0'.repeat(32)) as `0x${string}`;
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

async function main(): Promise<void> {
  loadRootEnv();

  const privateKey = process.env.GEO_PRIVATE_KEY || process.env.PK;
  if (!privateKey) {
    console.error('ERROR: Set GEO_PRIVATE_KEY in repo root .env');
    process.exit(1);
  }
  const hexKey = withHexPrefix(privateKey);

  const smartAccount = await getSmartAccountWalletClient({ privateKey: hexKey });
  const publicClient = createPublicClient({ transport: http(TESTNET_RPC_URL) });

  const rawSpaceId = await publicClient.readContract({
    address: TESTNET.SPACE_REGISTRY_ADDRESS as `0x${string}`,
    abi: SpaceRegistryAbi,
    functionName: 'addressToSpaceId',
    args: [smartAccount.account.address],
  });
  PERSONAL_SPACE_ID = `0x${String(rawSpaceId).slice(2, 34).toLowerCase()}` as `0x${string}`;
  console.log(`Smart account: ${smartAccount.account.address}`);
  console.log(`Personal space ID: ${PERSONAL_SPACE_ID}`);

  // 1) Get before-count
  const beforeData = await gqlFetch(
    `query($spaceId: UUID!) { entitiesConnection(first: 0, spaceId: $spaceId) { totalCount } }`,
    { spaceId: DAO_SPACE_ID },
  );
  const beforeCount = (beforeData.entitiesConnection as { totalCount: number }).totalCount;
  console.log(`\nEntities before: ${beforeCount}`);

  // 2) Pick a test entity (not Account type, not wallet address)
  const entityData = await gqlFetch(
    `query($spaceId: UUID!) {
      entitiesConnection(first: 5, spaceId: $spaceId, orderBy: CREATED_AT_ASC) {
        nodes { id name typeIds }
      }
    }`,
    { spaceId: DAO_SPACE_ID },
  );
  const entities = (entityData.entitiesConnection as { nodes: Array<{ id: string; name: string | null; typeIds: string[] }> }).nodes;
  const testEntity = entities.find(e =>
    !e.typeIds.includes(ACCOUNT_TYPE_ID) &&
    !(e.name && /^0x[a-fA-F0-9]{40}$/i.test(e.name))
  );

  if (!testEntity) {
    console.error('No suitable test entity found');
    process.exit(1);
  }

  console.log(`\nTest entity: ${testEntity.id} :: ${testEntity.name}`);

  // 3) Get the entity's values
  const dashedId = testEntity.id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  const valuesData = await gqlFetch(
    `query($id: UUID!) {
      entity(id: $id) {
        valuesList { id propertyId text language }
      }
    }`,
    { id: dashedId },
  );
  const values = (valuesData.entity as { valuesList: Array<{ id: string; propertyId: string; text: string | null; language: string | null }> }).valuesList;
  console.log(`Entity has ${values.length} values:`);
  for (const v of values) {
    console.log(`  - property: ${v.propertyId}, text: ${v.text?.slice(0, 50)}`);
  }

  // 4) Build ops: unset all property values, then delete entity
  // Collect unique property IDs
  const propertyIds = [...new Set(values.map(v => v.propertyId))];
  console.log(`\nUnsetting ${propertyIds.length} properties, then deleting entity...`);

  const unsetOps = Graph.updateEntity({
    id: testEntity.id,
    unset: propertyIds.map(p => ({ property: p, language: 'all' as const })),
  }).ops;

  const deleteOps = Graph.deleteEntity({ id: testEntity.id }).ops;

  // Find existing Account entity
  const accountData = await gqlFetch(
    `query($spaceId: UUID!) {
      entitiesConnection(first: 10, spaceId: $spaceId, orderBy: UPDATED_AT_DESC) {
        nodes { id name typeIds }
      }
    }`,
    { spaceId: DAO_SPACE_ID },
  );
  const accountNodes = (accountData.entitiesConnection as { nodes: Array<{ id: string; name: string | null; typeIds: string[] }> }).nodes;
  const existingAccount = accountNodes.find(n =>
    n.typeIds.includes(ACCOUNT_TYPE_ID) ||
    (n.name && /^0x[a-fA-F0-9]{40}$/i.test(n.name))
  );
  const accountId = existingAccount?.id ?? 'unknown';
  console.log(`Using Account entity: ${accountId}`);

  const allOps = [...unsetOps, ...deleteOps];
  console.log(`Total ops: ${allOps.length} (${unsetOps.length} unset + ${deleteOps.length} delete)`);

  // 5) Propose, vote, execute
  const { proposalId, to, calldata } = await daoSpace.proposeEdit({
    name: 'Test entity deletion with value clearing',
    ops: allOps as Parameters<typeof daoSpace.proposeEdit>[0]['ops'],
    author: accountId,
    daoSpaceAddress: DAO_SPACE_ADDRESS,
    callerSpaceId: PERSONAL_SPACE_ID,
    daoSpaceId: DAO_SPACE_ID_HEX,
    votingMode: 'FAST',
    network: 'TESTNET',
  });

  const proposeTxHash = await smartAccount.sendTransaction({ to, data: calldata });
  const proposeReceipt = await publicClient.waitForTransactionReceipt({ hash: proposeTxHash });
  console.log(`\nproposalId: ${proposalId}`);
  console.log(`propose tx: ${proposeTxHash} (status: ${proposeReceipt.status})`);

  // Vote YES
  const voteData = encodeAbiParameters(
    [
      { type: 'bytes16', name: 'proposalId' },
      { type: 'uint8', name: 'voteOption' },
    ],
    [proposalId as `0x${string}`, VoteOption.Yes],
  );
  const voteCalldata = encodeFunctionData({
    abi: SpaceRegistryAbi,
    functionName: 'enter',
    args: [
      PERSONAL_SPACE_ID,
      DAO_SPACE_ID_HEX as `0x${string}`,
      PROPOSAL_VOTED_ACTION,
      bytes16ToBytes32(proposalId),
      voteData,
      '0x',
    ],
  });
  const voteTxHash = await smartAccount.sendTransaction({
    to: TESTNET.SPACE_REGISTRY_ADDRESS,
    data: voteCalldata,
  });
  const voteReceipt = await publicClient.waitForTransactionReceipt({ hash: voteTxHash });
  console.log(`vote tx: ${voteTxHash} (status: ${voteReceipt.status})`);

  // Check execution
  const infoAfter = await publicClient.readContract({
    address: DAO_SPACE_ADDRESS as `0x${string}`,
    abi: DaoSpaceAbi,
    functionName: 'getLatestProposalInformation',
    args: [proposalId as `0x${string}`],
  });
  const executed = (infoAfter as unknown[])[0];
  if (executed) {
    console.log('auto-executed with vote');
  } else {
    const execData = encodeAbiParameters(
      [{ type: 'bytes16', name: 'proposalId' }],
      [proposalId as `0x${string}`],
    );
    const execCalldata = encodeFunctionData({
      abi: SpaceRegistryAbi,
      functionName: 'enter',
      args: [
        PERSONAL_SPACE_ID,
        DAO_SPACE_ID_HEX as `0x${string}`,
        PROPOSAL_EXECUTED_ACTION,
        bytes16ToBytes32(proposalId),
        execData,
        '0x',
      ],
    });
    const execTxHash = await smartAccount.sendTransaction({
      to: TESTNET.SPACE_REGISTRY_ADDRESS,
      data: execCalldata,
    });
    const execReceipt = await publicClient.waitForTransactionReceipt({ hash: execTxHash });
    console.log(`exec tx: ${execTxHash} (status: ${execReceipt.status})`);
  }

  // 6) Wait a moment for indexer, then verify
  console.log('\nWaiting 5s for indexer...');
  await new Promise(r => setTimeout(r, 5000));

  const afterData = await gqlFetch(
    `query($spaceId: UUID!) { entitiesConnection(first: 0, spaceId: $spaceId) { totalCount } }`,
    { spaceId: DAO_SPACE_ID },
  );
  const afterCount = (afterData.entitiesConnection as { totalCount: number }).totalCount;
  console.log(`\nEntities after: ${afterCount}`);
  console.log(`Delta: ${beforeCount - afterCount}`);

  if (afterCount < beforeCount) {
    console.log('\n*** SUCCESS: Entity deletion works when values are cleared first! ***');
  } else {
    console.log('\n*** FAILED: Entity count did not decrease. ***');

    // Check if entity still exists
    const checkData = await gqlFetch(
      `query($id: UUID!) { entity(id: $id) { id name description } }`,
      { id: dashedId },
    );
    console.log('Entity still exists:', JSON.stringify(checkData.entity));
  }
}

main().catch((err: unknown) => {
  const error = err as Error;
  console.error('ERROR:', error?.stack || error?.message || String(err));
  process.exit(1);
});
