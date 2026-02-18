import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock external dependencies
vi.mock('@geoprotocol/geo-sdk', () => ({
  personalSpace: {
    hasSpace: vi.fn(),
    createSpace: vi.fn(() => ({ to: '0xspace', calldata: '0xcalldata' })),
    publishEdit: vi.fn(),
  },
  daoSpace: {
    proposeEdit: vi.fn(),
  },
  TESTNET_RPC_URL: 'https://rpc.testnet.example.com',
  Account: {
    make: vi.fn(() => ({ accountId: 'account1', ops: [{ type: 99 }] })),
  },
}));

vi.mock('@geoprotocol/geo-sdk/abis', () => ({
  SpaceRegistryAbi: [{ name: 'addressToSpaceId', type: 'function', inputs: [], outputs: [] }],
}));

vi.mock('@geoprotocol/geo-sdk/contracts', () => ({
  TESTNET: { SPACE_REGISTRY_ADDRESS: '0xregistry' },
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    createPublicClient: () => ({
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
      readContract: vi.fn().mockResolvedValue('0x' + 'ab'.repeat(16) + '00'.repeat(16)),
    }),
  };
});

vi.mock('../utils/wallet.js', () => ({
  ensureWalletConfigured: vi.fn(),
  normalizeAddress: vi.fn((value: string) => value.toLowerCase() as `0x${string}`),
  normalizeBytes16Hex: vi.fn((value: string) => value.toLowerCase() as `0x${string}`),
}));

import { personalSpace, daoSpace, Account } from '@geoprotocol/geo-sdk';
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

describe('space tools', () => {
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
      spaceId: null,
      opsCount: 0,
      getOps: vi.fn(() => []),
      getLastPublishedOps: vi.fn(() => []),
      addOps: vi.fn(),
      setLastPublishedOps: vi.fn(),
      clear: vi.fn(),
      getStatus: vi.fn(() => ({
        walletConfigured: true,
        walletAddress: '0x1234',
        spaceId: null,
        opsCount: 0,
        network: 'TESTNET',
      })),
    };
  });

  async function setupTools() {
    const { registerSpaceTools } = await import('./spaces.js');
    const { mockServer, tools } = captureTools();
    registerSpaceTools(mockServer as any, mockSession);
    return tools;
  }

  describe('configure_wallet', () => {
    it('configures wallet successfully', async () => {
      (mockEnsureWallet as any).mockResolvedValue({ ok: true, address: '0xaddr' });
      const tools = await setupTools();
      const result = await tools.configure_wallet.handler({ privateKey: '0xabc' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.message).toBe('Wallet configured successfully');
      expect(parsed.source).toBe('provided');
    });

    it('uses env when no key provided', async () => {
      (mockEnsureWallet as any).mockResolvedValue({ ok: true, address: '0xaddr' });
      const tools = await setupTools();
      const result = await tools.configure_wallet.handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.source).toBe('env');
    });

    it('returns error when wallet config fails', async () => {
      (mockEnsureWallet as any).mockResolvedValue({ ok: false, error: 'Bad key' });
      const tools = await setupTools();
      const result = await tools.configure_wallet.handler({});
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Bad key');
    });
  });

  describe('setup_space', () => {
    it('finds existing space', async () => {
      (mockEnsureWallet as any).mockResolvedValue({ ok: true, address: '0xaddr' });
      (personalSpace.hasSpace as any).mockResolvedValue(true);
      const tools = await setupTools();
      const result = await tools.setup_space.handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.spaceId).toBe('ab'.repeat(16));
      expect(parsed.created).toBe(false);
      expect(mockSession.spaceId).toBe('ab'.repeat(16));
    });

    it('creates new space when none exists', async () => {
      (mockEnsureWallet as any).mockResolvedValue({ ok: true, address: '0xaddr' });
      (personalSpace.hasSpace as any).mockResolvedValue(false);
      const tools = await setupTools();
      const result = await tools.setup_space.handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.created).toBe(true);
      expect(mockSession.smartAccountClient.sendTransaction).toHaveBeenCalledOnce();
    });

    it('returns error when wallet not configured', async () => {
      (mockEnsureWallet as any).mockResolvedValue({ ok: false, error: 'No wallet' });
      mockSession.smartAccountClient = null;
      const tools = await setupTools();
      const result = await tools.setup_space.handler({});
      expect(result.isError).toBe(true);
    });
  });

  describe('publish_edit', () => {
    it('publishes accumulated ops', async () => {
      (mockEnsureWallet as any).mockResolvedValue({ ok: true, address: '0xaddr' });
      mockSession.spaceId = 'space1';
      mockSession.getOps.mockReturnValue([{ type: 0 }, { type: 1 }]);
      (personalSpace.publishEdit as any).mockResolvedValue({
        editId: 'edit1', cid: 'QmCid', to: '0xto', calldata: '0xdata',
      });
      const tools = await setupTools();
      const result = await tools.publish_edit.handler({ name: 'Test edit' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.editId).toBe('edit1');
      expect(parsed.txHash).toBe('0xtxhash');
      expect(parsed.opsPublished).toBe(2);
      expect(mockSession.clear).toHaveBeenCalledOnce();
      expect(mockSession.setLastPublishedOps).toHaveBeenCalledOnce();
    });

    it('returns error when no space set up', async () => {
      (mockEnsureWallet as any).mockResolvedValue({ ok: true, address: '0xaddr' });
      mockSession.spaceId = null;
      const tools = await setupTools();
      const result = await tools.publish_edit.handler({ name: 'Test' });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('Space not set up');
    });

    it('returns error when no ops accumulated', async () => {
      (mockEnsureWallet as any).mockResolvedValue({ ok: true, address: '0xaddr' });
      mockSession.spaceId = 'space1';
      mockSession.getOps.mockReturnValue([]);
      const tools = await setupTools();
      const result = await tools.publish_edit.handler({ name: 'Test' });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('No ops accumulated');
    });

    it('returns error when wallet not configured', async () => {
      (mockEnsureWallet as any).mockResolvedValue({ ok: false, error: 'No wallet' });
      mockSession.smartAccountClient = null;
      const tools = await setupTools();
      const result = await tools.publish_edit.handler({ name: 'Test' });
      expect(result.isError).toBe(true);
    });
  });

  describe('propose_dao_edit', () => {
    it('proposes with accumulated ops', async () => {
      (mockEnsureWallet as any).mockResolvedValue({ ok: true, address: '0xaddr' });
      mockSession.spaceId = '0x' + 'ab'.repeat(16);
      mockSession.getOps.mockReturnValue([{ type: 0 }]);
      (daoSpace.proposeEdit as any).mockResolvedValue({
        editId: 'edit1', cid: 'QmCid', to: '0xto', calldata: '0xdata', proposalId: 'prop1',
      });
      const tools = await setupTools();
      const result = await tools.propose_dao_edit.handler({
        name: 'DAO edit',
        daoSpaceAddress: '0x' + 'ab'.repeat(20),
        daoSpaceId: '0x' + 'cd'.repeat(16),
        votingMode: 'FAST',
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.proposalId).toBe('prop1');
      expect(parsed.txHash).toBe('0xtxhash');
      expect(mockSession.clear).toHaveBeenCalledWith({ includeLastPublished: true });
    });

    it('falls back to last published ops when no pending ops', async () => {
      (mockEnsureWallet as any).mockResolvedValue({ ok: true, address: '0xaddr' });
      mockSession.spaceId = '0x' + 'ab'.repeat(16);
      mockSession.getOps.mockReturnValue([]);
      mockSession.getLastPublishedOps.mockReturnValue([{ type: 0 }]);
      (daoSpace.proposeEdit as any).mockResolvedValue({
        editId: 'edit1', cid: 'QmCid', to: '0xto', calldata: '0xdata', proposalId: 'prop1',
      });
      const tools = await setupTools();
      const result = await tools.propose_dao_edit.handler({
        name: 'DAO edit',
        daoSpaceAddress: '0x' + 'ab'.repeat(20),
        daoSpaceId: '0x' + 'cd'.repeat(16),
        votingMode: 'FAST',
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.opsProposed).toBe(1);
    });

    it('returns error when no ops and no last published', async () => {
      (mockEnsureWallet as any).mockResolvedValue({ ok: true, address: '0xaddr' });
      mockSession.spaceId = '0x' + 'ab'.repeat(16);
      mockSession.getOps.mockReturnValue([]);
      mockSession.getLastPublishedOps.mockReturnValue([]);
      const tools = await setupTools();
      const result = await tools.propose_dao_edit.handler({
        name: 'DAO edit',
        daoSpaceAddress: '0x' + 'ab'.repeat(20),
        daoSpaceId: '0x' + 'cd'.repeat(16),
        votingMode: 'FAST',
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('get_session_status', () => {
    it('returns session status', async () => {
      const tools = await setupTools();
      const result = await tools.get_session_status.handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.walletConfigured).toBe(true);
      expect(parsed.network).toBe('TESTNET');
    });
  });

  describe('clear_session', () => {
    it('clears session and returns previous counts', async () => {
      mockSession.opsCount = 5;
      mockSession.getLastPublishedOps.mockReturnValue([{ type: 0 }, { type: 1 }]);
      const tools = await setupTools();
      const result = await tools.clear_session.handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.message).toBe('Session cleared');
      expect(parsed.previousOpsCount).toBe(5);
      expect(parsed.previousLastPublishedOpsCount).toBe(2);
      expect(mockSession.clear).toHaveBeenCalledWith({ includeLastPublished: true });
    });
  });
});
