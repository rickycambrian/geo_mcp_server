import { MainVotingAbi } from '@geoprotocol/geo-sdk/abis';
import { encodeFunctionData, stringToHex } from 'viem';
import { z } from 'zod';
import { ensureWalletConfigured, normalizeAddress } from '../utils/wallet.js';
import { executeTransaction } from '../utils/tx-executor.js';
import { ok, err } from './helpers.js';
const VOTE_OPTIONS = { YES: 2, NO: 3, ABSTAIN: 1 };
export function registerGovernanceTools(server, session) {
    // ── vote_on_proposal ─────────────────────────────────────────────
    server.tool('vote_on_proposal', 'Cast a vote on a DAO proposal (YES, NO, or ABSTAIN)', {
        mainVotingAddress: z.string().describe('0x address of the MainVoting plugin contract'),
        proposalId: z.string().describe('Proposal ID (uint256 as string)'),
        vote: z.enum(['YES', 'NO', 'ABSTAIN']).describe('Vote option'),
        tryEarlyExecution: z
            .boolean()
            .default(true)
            .describe('Attempt early execution if vote threshold is met'),
    }, { readOnlyHint: false }, async ({ mainVotingAddress, proposalId, vote, tryEarlyExecution }) => {
        try {
            const ensured = await ensureWalletConfigured(session);
            if (!ensured.ok) {
                return err(ensured.error);
            }
            if (session.walletMode !== 'APPROVAL' && !session.smartAccountClient) {
                return err('Wallet not configured.');
            }
            const normalizedAddress = normalizeAddress(mainVotingAddress, 'mainVotingAddress');
            const voteOption = VOTE_OPTIONS[vote];
            const data = encodeFunctionData({
                abi: MainVotingAbi,
                functionName: 'vote',
                args: [BigInt(proposalId), voteOption, tryEarlyExecution],
            });
            const txResult = await executeTransaction(session, {
                to: normalizedAddress,
                data,
                description: `Vote ${vote} on proposal ${proposalId}`,
                toolName: 'vote_on_proposal',
                metadata: { proposalId, vote, tryEarlyExecution },
            });
            if (txResult.mode === 'pending_approval') {
                return ok({ status: 'pending_signature', ...txResult.pendingTx });
            }
            return ok({ txHash: txResult.txHash, proposalId, vote, tryEarlyExecution });
        }
        catch (error) {
            return err(error);
        }
    });
    // ── propose_accept_editor ────────────────────────────────────────
    server.tool('propose_accept_editor', 'Propose adding a new editor to a DAO space', {
        mainVotingAddress: z.string().describe('0x address of the MainVoting plugin contract'),
        editorAddress: z.string().describe('0x address of the editor to add'),
        ipfsUri: z.string().describe('ipfs:// metadata URI for the proposal'),
    }, { readOnlyHint: false }, async ({ mainVotingAddress, editorAddress, ipfsUri }) => {
        try {
            const ensured = await ensureWalletConfigured(session);
            if (!ensured.ok) {
                return err(ensured.error);
            }
            if (session.walletMode !== 'APPROVAL' && !session.smartAccountClient) {
                return err('Wallet not configured.');
            }
            const normalizedMainVoting = normalizeAddress(mainVotingAddress, 'mainVotingAddress');
            const normalizedEditor = normalizeAddress(editorAddress, 'editorAddress');
            const data = encodeFunctionData({
                abi: MainVotingAbi,
                functionName: 'proposeAddEditor',
                args: [stringToHex(ipfsUri), normalizedEditor],
            });
            const txResult = await executeTransaction(session, {
                to: normalizedMainVoting,
                data,
                description: `Propose adding editor ${normalizedEditor}`,
                toolName: 'propose_accept_editor',
                metadata: { editorAddress: normalizedEditor, ipfsUri },
            });
            if (txResult.mode === 'pending_approval') {
                return ok({ status: 'pending_signature', ...txResult.pendingTx });
            }
            return ok({ txHash: txResult.txHash, editorAddress: normalizedEditor, ipfsUri });
        }
        catch (error) {
            return err(error);
        }
    });
    // ── propose_remove_editor ────────────────────────────────────────
    server.tool('propose_remove_editor', 'Propose removing an editor from a DAO space', {
        mainVotingAddress: z.string().describe('0x address of the MainVoting plugin contract'),
        editorAddress: z.string().describe('0x address of the editor to remove'),
        ipfsUri: z.string().describe('ipfs:// metadata URI for the proposal'),
    }, { readOnlyHint: false }, async ({ mainVotingAddress, editorAddress, ipfsUri }) => {
        try {
            const ensured = await ensureWalletConfigured(session);
            if (!ensured.ok) {
                return err(ensured.error);
            }
            if (session.walletMode !== 'APPROVAL' && !session.smartAccountClient) {
                return err('Wallet not configured.');
            }
            const normalizedMainVoting = normalizeAddress(mainVotingAddress, 'mainVotingAddress');
            const normalizedEditor = normalizeAddress(editorAddress, 'editorAddress');
            const data = encodeFunctionData({
                abi: MainVotingAbi,
                functionName: 'proposeRemoveEditor',
                args: [stringToHex(ipfsUri), normalizedEditor],
            });
            const txResult = await executeTransaction(session, {
                to: normalizedMainVoting,
                data,
                description: `Propose removing editor ${normalizedEditor}`,
                toolName: 'propose_remove_editor',
                metadata: { editorAddress: normalizedEditor, ipfsUri },
            });
            if (txResult.mode === 'pending_approval') {
                return ok({ status: 'pending_signature', ...txResult.pendingTx });
            }
            return ok({ txHash: txResult.txHash, editorAddress: normalizedEditor, ipfsUri });
        }
        catch (error) {
            return err(error);
        }
    });
    // ── propose_accept_subspace ──────────────────────────────────────
    server.tool('propose_accept_subspace', 'Propose accepting a subspace into a DAO space', {
        mainVotingAddress: z.string().describe('0x address of the MainVoting plugin contract'),
        spacePluginAddress: z.string().describe('0x address of the space plugin'),
        subspaceAddress: z.string().describe('0x address of the subspace DAO'),
        ipfsUri: z.string().describe('ipfs:// metadata URI for the proposal'),
    }, { readOnlyHint: false }, async ({ mainVotingAddress, spacePluginAddress, subspaceAddress, ipfsUri }) => {
        try {
            const ensured = await ensureWalletConfigured(session);
            if (!ensured.ok) {
                return err(ensured.error);
            }
            if (session.walletMode !== 'APPROVAL' && !session.smartAccountClient) {
                return err('Wallet not configured.');
            }
            const normalizedMainVoting = normalizeAddress(mainVotingAddress, 'mainVotingAddress');
            const normalizedSpacePlugin = normalizeAddress(spacePluginAddress, 'spacePluginAddress');
            const normalizedSubspace = normalizeAddress(subspaceAddress, 'subspaceAddress');
            const data = encodeFunctionData({
                abi: MainVotingAbi,
                functionName: 'proposeAcceptSubspace',
                args: [stringToHex(ipfsUri), normalizedSubspace, normalizedSpacePlugin],
            });
            const txResult = await executeTransaction(session, {
                to: normalizedMainVoting,
                data,
                description: `Propose accepting subspace ${normalizedSubspace}`,
                toolName: 'propose_accept_subspace',
                metadata: { subspaceAddress: normalizedSubspace, spacePluginAddress: normalizedSpacePlugin, ipfsUri },
            });
            if (txResult.mode === 'pending_approval') {
                return ok({ status: 'pending_signature', ...txResult.pendingTx });
            }
            return ok({
                txHash: txResult.txHash,
                subspaceAddress: normalizedSubspace,
                spacePluginAddress: normalizedSpacePlugin,
                ipfsUri,
            });
        }
        catch (error) {
            return err(error);
        }
    });
    // ── propose_remove_subspace ──────────────────────────────────────
    server.tool('propose_remove_subspace', 'Propose removing a subspace from a DAO space', {
        mainVotingAddress: z.string().describe('0x address of the MainVoting plugin contract'),
        spacePluginAddress: z.string().describe('0x address of the space plugin'),
        subspaceAddress: z.string().describe('0x address of the subspace DAO'),
        ipfsUri: z.string().describe('ipfs:// metadata URI for the proposal'),
    }, { readOnlyHint: false }, async ({ mainVotingAddress, spacePluginAddress, subspaceAddress, ipfsUri }) => {
        try {
            const ensured = await ensureWalletConfigured(session);
            if (!ensured.ok) {
                return err(ensured.error);
            }
            if (session.walletMode !== 'APPROVAL' && !session.smartAccountClient) {
                return err('Wallet not configured.');
            }
            const normalizedMainVoting = normalizeAddress(mainVotingAddress, 'mainVotingAddress');
            const normalizedSpacePlugin = normalizeAddress(spacePluginAddress, 'spacePluginAddress');
            const normalizedSubspace = normalizeAddress(subspaceAddress, 'subspaceAddress');
            const data = encodeFunctionData({
                abi: MainVotingAbi,
                functionName: 'proposeRemoveSubspace',
                args: [stringToHex(ipfsUri), normalizedSubspace, normalizedSpacePlugin],
            });
            const txResult = await executeTransaction(session, {
                to: normalizedMainVoting,
                data,
                description: `Propose removing subspace ${normalizedSubspace}`,
                toolName: 'propose_remove_subspace',
                metadata: { subspaceAddress: normalizedSubspace, spacePluginAddress: normalizedSpacePlugin, ipfsUri },
            });
            if (txResult.mode === 'pending_approval') {
                return ok({ status: 'pending_signature', ...txResult.pendingTx });
            }
            return ok({
                txHash: txResult.txHash,
                subspaceAddress: normalizedSubspace,
                spacePluginAddress: normalizedSpacePlugin,
                ipfsUri,
            });
        }
        catch (error) {
            return err(error);
        }
    });
}
//# sourceMappingURL=governance.js.map