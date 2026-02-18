/**
 * Governance tools for DAO operations: voting and membership/subspace proposals.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TESTNET_RPC_URL } from '@geoprotocol/geo-sdk';
import { MainVotingAbi } from '@geoprotocol/geo-sdk/abis';
import { createPublicClient, encodeFunctionData, type Hex, http, stringToHex } from 'viem';
import { z } from 'zod';
import { type EditSession } from '../state/session.js';
import { ensureWalletConfigured, normalizeAddress } from '../utils/wallet.js';
import { ok, err } from './helpers.js';

const VOTE_OPTIONS = { YES: 2, NO: 3, ABSTAIN: 1 } as const;

export function registerGovernanceTools(server: McpServer, session: EditSession): void {
  const publicClient = createPublicClient({ transport: http(TESTNET_RPC_URL) });

  // ── vote_on_proposal ─────────────────────────────────────────────
  server.tool(
    'vote_on_proposal',
    'Cast a vote on a DAO proposal (YES, NO, or ABSTAIN)',
    {
      mainVotingAddress: z.string().describe('0x address of the MainVoting plugin contract'),
      proposalId: z.string().describe('Proposal ID (uint256 as string)'),
      vote: z.enum(['YES', 'NO', 'ABSTAIN']).describe('Vote option'),
      tryEarlyExecution: z
        .boolean()
        .default(true)
        .describe('Attempt early execution if vote threshold is met'),
    },
    async ({ mainVotingAddress, proposalId, vote, tryEarlyExecution }) => {
      try {
        const ensured = await ensureWalletConfigured(session);
        if (!ensured.ok || !session.smartAccountClient) {
          return err(ensured.ok ? 'Wallet not configured.' : ensured.error);
        }

        const normalizedAddress = normalizeAddress(mainVotingAddress, 'mainVotingAddress');
        const voteOption = VOTE_OPTIONS[vote];

        const data = encodeFunctionData({
          abi: MainVotingAbi,
          functionName: 'vote',
          args: [BigInt(proposalId), voteOption, tryEarlyExecution],
        });

        const txHash = await session.smartAccountClient.sendTransaction({
          to: normalizedAddress,
          data,
        });

        await publicClient.waitForTransactionReceipt({ hash: txHash });

        return ok({ txHash, proposalId, vote, tryEarlyExecution });
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── propose_accept_editor ────────────────────────────────────────
  server.tool(
    'propose_accept_editor',
    'Propose adding a new editor to a DAO space',
    {
      mainVotingAddress: z.string().describe('0x address of the MainVoting plugin contract'),
      editorAddress: z.string().describe('0x address of the editor to add'),
      ipfsUri: z.string().describe('ipfs:// metadata URI for the proposal'),
    },
    async ({ mainVotingAddress, editorAddress, ipfsUri }) => {
      try {
        const ensured = await ensureWalletConfigured(session);
        if (!ensured.ok || !session.smartAccountClient) {
          return err(ensured.ok ? 'Wallet not configured.' : ensured.error);
        }

        const normalizedMainVoting = normalizeAddress(mainVotingAddress, 'mainVotingAddress');
        const normalizedEditor = normalizeAddress(editorAddress, 'editorAddress');

        const data = encodeFunctionData({
          abi: MainVotingAbi,
          functionName: 'proposeAddEditor',
          args: [stringToHex(ipfsUri), normalizedEditor],
        });

        const txHash = await session.smartAccountClient.sendTransaction({
          to: normalizedMainVoting,
          data,
        });

        await publicClient.waitForTransactionReceipt({ hash: txHash });

        return ok({ txHash, editorAddress: normalizedEditor, ipfsUri });
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── propose_remove_editor ────────────────────────────────────────
  server.tool(
    'propose_remove_editor',
    'Propose removing an editor from a DAO space',
    {
      mainVotingAddress: z.string().describe('0x address of the MainVoting plugin contract'),
      editorAddress: z.string().describe('0x address of the editor to remove'),
      ipfsUri: z.string().describe('ipfs:// metadata URI for the proposal'),
    },
    async ({ mainVotingAddress, editorAddress, ipfsUri }) => {
      try {
        const ensured = await ensureWalletConfigured(session);
        if (!ensured.ok || !session.smartAccountClient) {
          return err(ensured.ok ? 'Wallet not configured.' : ensured.error);
        }

        const normalizedMainVoting = normalizeAddress(mainVotingAddress, 'mainVotingAddress');
        const normalizedEditor = normalizeAddress(editorAddress, 'editorAddress');

        const data = encodeFunctionData({
          abi: MainVotingAbi,
          functionName: 'proposeRemoveEditor',
          args: [stringToHex(ipfsUri), normalizedEditor],
        });

        const txHash = await session.smartAccountClient.sendTransaction({
          to: normalizedMainVoting,
          data,
        });

        await publicClient.waitForTransactionReceipt({ hash: txHash });

        return ok({ txHash, editorAddress: normalizedEditor, ipfsUri });
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── propose_accept_subspace ──────────────────────────────────────
  server.tool(
    'propose_accept_subspace',
    'Propose accepting a subspace into a DAO space',
    {
      mainVotingAddress: z.string().describe('0x address of the MainVoting plugin contract'),
      spacePluginAddress: z.string().describe('0x address of the space plugin'),
      subspaceAddress: z.string().describe('0x address of the subspace DAO'),
      ipfsUri: z.string().describe('ipfs:// metadata URI for the proposal'),
    },
    async ({ mainVotingAddress, spacePluginAddress, subspaceAddress, ipfsUri }) => {
      try {
        const ensured = await ensureWalletConfigured(session);
        if (!ensured.ok || !session.smartAccountClient) {
          return err(ensured.ok ? 'Wallet not configured.' : ensured.error);
        }

        const normalizedMainVoting = normalizeAddress(mainVotingAddress, 'mainVotingAddress');
        const normalizedSpacePlugin = normalizeAddress(spacePluginAddress, 'spacePluginAddress');
        const normalizedSubspace = normalizeAddress(subspaceAddress, 'subspaceAddress');

        const data = encodeFunctionData({
          abi: MainVotingAbi,
          functionName: 'proposeAcceptSubspace',
          args: [stringToHex(ipfsUri), normalizedSubspace, normalizedSpacePlugin],
        });

        const txHash = await session.smartAccountClient.sendTransaction({
          to: normalizedMainVoting,
          data,
        });

        await publicClient.waitForTransactionReceipt({ hash: txHash });

        return ok({
          txHash,
          subspaceAddress: normalizedSubspace,
          spacePluginAddress: normalizedSpacePlugin,
          ipfsUri,
        });
      } catch (error) {
        return err(error);
      }
    },
  );

  // ── propose_remove_subspace ──────────────────────────────────────
  server.tool(
    'propose_remove_subspace',
    'Propose removing a subspace from a DAO space',
    {
      mainVotingAddress: z.string().describe('0x address of the MainVoting plugin contract'),
      spacePluginAddress: z.string().describe('0x address of the space plugin'),
      subspaceAddress: z.string().describe('0x address of the subspace DAO'),
      ipfsUri: z.string().describe('ipfs:// metadata URI for the proposal'),
    },
    async ({ mainVotingAddress, spacePluginAddress, subspaceAddress, ipfsUri }) => {
      try {
        const ensured = await ensureWalletConfigured(session);
        if (!ensured.ok || !session.smartAccountClient) {
          return err(ensured.ok ? 'Wallet not configured.' : ensured.error);
        }

        const normalizedMainVoting = normalizeAddress(mainVotingAddress, 'mainVotingAddress');
        const normalizedSpacePlugin = normalizeAddress(spacePluginAddress, 'spacePluginAddress');
        const normalizedSubspace = normalizeAddress(subspaceAddress, 'subspaceAddress');

        const data = encodeFunctionData({
          abi: MainVotingAbi,
          functionName: 'proposeRemoveSubspace',
          args: [stringToHex(ipfsUri), normalizedSubspace, normalizedSpacePlugin],
        });

        const txHash = await session.smartAccountClient.sendTransaction({
          to: normalizedMainVoting,
          data,
        });

        await publicClient.waitForTransactionReceipt({ hash: txHash });

        return ok({
          txHash,
          subspaceAddress: normalizedSubspace,
          spacePluginAddress: normalizedSpacePlugin,
          ipfsUri,
        });
      } catch (error) {
        return err(error);
      }
    },
  );
}
