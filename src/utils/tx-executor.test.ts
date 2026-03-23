import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@geoprotocol/geo-sdk', () => ({
  TESTNET_RPC_URL: 'https://rpc.testnet.example.com',
  IdUtils: { generate: vi.fn(() => 'aabbccdd11223344aabbccdd11223344') },
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

import { executeTransaction } from './tx-executor.js';
import type { TxRequest } from './tx-executor.js';

describe('executeTransaction', () => {
  const baseTxRequest: TxRequest = {
    to: '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`,
    data: '0xdeadbeef' as `0x${string}`,
    description: 'Test transaction',
    toolName: 'test_tool',
    metadata: { foo: 'bar' },
  };

  describe('PRIVATE_KEY mode', () => {
    let mockSession: any;

    beforeEach(() => {
      vi.clearAllMocks();
      mockSession = {
        walletMode: 'PRIVATE_KEY',
        smartAccountClient: {
          sendTransaction: vi.fn().mockResolvedValue('0xtxhash123'),
        },
        addPendingTransaction: vi.fn(),
      };
    });

    it('sends transaction via smartAccountClient and returns txHash', async () => {
      const result = await executeTransaction(mockSession, baseTxRequest);
      expect(result.mode).toBe('executed');
      expect(result.txHash).toBe('0xtxhash123');
      expect(result.pendingTx).toBeUndefined();
      expect(mockSession.smartAccountClient.sendTransaction).toHaveBeenCalledWith({
        to: baseTxRequest.to,
        data: baseTxRequest.data,
      });
    });

    it('passes value when provided', async () => {
      const result = await executeTransaction(mockSession, {
        ...baseTxRequest,
        value: BigInt(1000),
      });
      expect(result.mode).toBe('executed');
      expect(mockSession.smartAccountClient.sendTransaction).toHaveBeenCalledWith({
        to: baseTxRequest.to,
        data: baseTxRequest.data,
        value: BigInt(1000),
      });
    });

    it('throws when smartAccountClient is null', async () => {
      mockSession.smartAccountClient = null;
      await expect(executeTransaction(mockSession, baseTxRequest)).rejects.toThrow(
        'Smart account client not available',
      );
    });
  });

  describe('APPROVAL mode', () => {
    let mockSession: any;

    beforeEach(() => {
      vi.clearAllMocks();
      mockSession = {
        walletMode: 'APPROVAL',
        smartAccountClient: null,
        addPendingTransaction: vi.fn(),
      };
    });

    it('returns pending_approval with PendingTransaction', async () => {
      const result = await executeTransaction(mockSession, baseTxRequest);
      expect(result.mode).toBe('pending_approval');
      expect(result.txHash).toBeUndefined();
      expect(result.pendingTx).toBeDefined();
      expect(result.pendingTx!.to).toBe(baseTxRequest.to);
      expect(result.pendingTx!.data).toBe(baseTxRequest.data);
      expect(result.pendingTx!.description).toBe('Test transaction');
      expect(result.pendingTx!.toolName).toBe('test_tool');
      expect(result.pendingTx!.metadata).toEqual({ foo: 'bar' });
      expect(result.pendingTx!.id).toBe('aabbccdd11223344aabbccdd11223344');
    });

    it('adds pending transaction to session', async () => {
      const result = await executeTransaction(mockSession, baseTxRequest);
      expect(mockSession.addPendingTransaction).toHaveBeenCalledWith(result.pendingTx);
    });

    it('converts value to string for JSON safety', async () => {
      const result = await executeTransaction(mockSession, {
        ...baseTxRequest,
        value: BigInt(999),
      });
      expect(result.pendingTx!.value).toBe('999');
    });

    it('does not include value field when value is undefined', async () => {
      const result = await executeTransaction(mockSession, baseTxRequest);
      expect(result.pendingTx!.value).toBeUndefined();
    });

    it('does not call smartAccountClient', async () => {
      await executeTransaction(mockSession, baseTxRequest);
      // smartAccountClient is null in APPROVAL mode, no sendTransaction called
      expect(mockSession.smartAccountClient).toBeNull();
    });
  });
});
