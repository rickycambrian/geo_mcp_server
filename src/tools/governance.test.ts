import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock external dependencies
vi.mock('@geoprotocol/geo-sdk', () => ({
  TESTNET_RPC_URL: 'https://rpc.testnet.example.com',
}));

vi.mock('@geoprotocol/geo-sdk/abis', () => ({
  MainVotingAbi: [
    {
      name: 'vote',
      type: 'function',
      inputs: [
        { name: 'proposalId', type: 'uint256' },
        { name: 'voteOption', type: 'uint8' },
        { name: 'tryEarlyExecution', type: 'bool' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    },
    {
      name: 'proposeAddEditor',
      type: 'function',
      inputs: [
        { name: 'metadataContentUri', type: 'bytes' },
        { name: 'proposedEditor', type: 'address' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    },
  ],
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    createPublicClient: () => ({
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
    }),
  };
});

vi.mock('../utils/wallet.js', () => ({
  ensureWalletConfigured: vi.fn(),
  normalizeAddress: vi.fn((value: string) => value.toLowerCase() as `0x${string}`),
}));

import { ensureWalletConfigured as mockEnsureWallet } from '../utils/wallet.js';

function captureTools() {
  const tools: Record<string, { handler: Function }> = {};
  const mockServer = {
    tool: (name: string, _desc: string, _schema: unknown, handler: Function) => {
      tools[name] = { handler };
    },
  };
  return { mockServer, tools };
}

describe('governance tools', () => {
  let mockSession: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = {
      smartAccountClient: {
        sendTransaction: vi.fn().mockResolvedValue('0xtxhash'),
        account: { address: '0x1234567890abcdef1234567890abcdef12345678' },
      },
      privateKey: '0xkey',
      walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
    };
  });

  async function setupTools() {
    const { registerGovernanceTools } = await import('./governance.js');
    const { mockServer, tools } = captureTools();
    registerGovernanceTools(mockServer as any, mockSession);
    return tools;
  }

  describe('vote_on_proposal', () => {
    it('sends vote transaction', async () => {
      (mockEnsureWallet as any).mockResolvedValue({ ok: true, address: '0xaddr' });
      const tools = await setupTools();

      const result = await tools.vote_on_proposal.handler({
        mainVotingAddress: '0x1234567890abcdef1234567890abcdef12345678',
        proposalId: '42',
        vote: 'YES',
        tryEarlyExecution: true,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.txHash).toBe('0xtxhash');
      expect(parsed.vote).toBe('YES');
      expect(mockSession.smartAccountClient.sendTransaction).toHaveBeenCalledOnce();
    });

    it('returns error when wallet not configured', async () => {
      (mockEnsureWallet as any).mockResolvedValue({ ok: false, error: 'No wallet' });
      const tools = await setupTools();

      const result = await tools.vote_on_proposal.handler({
        mainVotingAddress: '0x1234567890abcdef1234567890abcdef12345678',
        proposalId: '1',
        vote: 'NO',
        tryEarlyExecution: false,
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('No wallet');
    });
  });

  describe('propose_accept_editor', () => {
    it('sends proposeAddEditor transaction', async () => {
      (mockEnsureWallet as any).mockResolvedValue({ ok: true, address: '0xaddr' });
      const tools = await setupTools();

      const result = await tools.propose_accept_editor.handler({
        mainVotingAddress: '0x1234567890abcdef1234567890abcdef12345678',
        editorAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        ipfsUri: 'ipfs://QmTest',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.txHash).toBe('0xtxhash');
      expect(mockSession.smartAccountClient.sendTransaction).toHaveBeenCalledOnce();
    });
  });

  describe('propose_remove_editor', () => {
    it('returns error when wallet not configured', async () => {
      (mockEnsureWallet as any).mockResolvedValue({ ok: false, error: 'Not configured' });
      mockSession.smartAccountClient = null;
      const tools = await setupTools();

      const result = await tools.propose_remove_editor.handler({
        mainVotingAddress: '0x1234567890abcdef1234567890abcdef12345678',
        editorAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        ipfsUri: 'ipfs://QmTest',
      });

      expect(result.isError).toBe(true);
    });
  });
});
