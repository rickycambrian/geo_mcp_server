import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@geoprotocol/geo-sdk', () => ({
  getSmartAccountWalletClient: vi.fn(),
}));

import { getSmartAccountWalletClient as mockGetClient } from '@geoprotocol/geo-sdk';
import { withHexPrefix, normalizeAddress, normalizeBytes16Hex, ensureWalletConfigured } from './wallet.js';

describe('withHexPrefix', () => {
  it('adds 0x prefix if missing', () => {
    expect(withHexPrefix('abc123')).toBe('0xabc123');
  });

  it('returns unchanged if already prefixed', () => {
    expect(withHexPrefix('0xabc123')).toBe('0xabc123');
  });

  it('lowercases and trims', () => {
    expect(withHexPrefix('  0xABC123  ')).toBe('0xabc123');
  });
});

describe('normalizeAddress', () => {
  const validAddr = '0x1234567890abcdef1234567890abcdef12345678';

  it('accepts valid 40-hex address with 0x', () => {
    expect(normalizeAddress(validAddr, 'test')).toBe(validAddr);
  });

  it('accepts valid address without 0x prefix', () => {
    expect(normalizeAddress('1234567890abcdef1234567890abcdef12345678', 'test')).toBe(validAddr);
  });

  it('throws on too-short address', () => {
    expect(() => normalizeAddress('0x1234', 'myField')).toThrow('myField must be an EVM address');
  });

  it('throws on too-long address', () => {
    expect(() => normalizeAddress('0x' + 'a'.repeat(42), 'addr')).toThrow('addr must be an EVM address');
  });

  it('throws on non-hex characters', () => {
    expect(() => normalizeAddress('0x' + 'g'.repeat(40), 'addr')).toThrow('addr must be an EVM address');
  });
});

describe('normalizeBytes16Hex', () => {
  const validBytes16 = '0x' + 'ab'.repeat(16);

  it('accepts valid 32-hex with 0x', () => {
    expect(normalizeBytes16Hex(validBytes16, 'test')).toBe(validBytes16);
  });

  it('accepts valid 32-hex without 0x', () => {
    expect(normalizeBytes16Hex('ab'.repeat(16), 'test')).toBe(validBytes16);
  });

  it('throws on wrong length', () => {
    expect(() => normalizeBytes16Hex('0x1234', 'spaceId')).toThrow('spaceId must be bytes16 hex');
  });
});

describe('ensureWalletConfigured', () => {
  let mockSession: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = {
      privateKey: null,
      walletAddress: null,
      smartAccountClient: null,
    };
  });

  it('returns error when no key available', async () => {
    delete process.env.GEO_PRIVATE_KEY;
    const result = await ensureWalletConfigured(mockSession);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Wallet not configured');
  });

  it('configures wallet with override key', async () => {
    const mockClient = { account: { address: '0xabc' } };
    (mockGetClient as any).mockResolvedValue(mockClient);

    const result = await ensureWalletConfigured(mockSession, '0x' + 'ab'.repeat(32));
    expect(result.ok).toBe(true);
    expect(mockSession.smartAccountClient).toBe(mockClient);
    expect(mockSession.walletAddress).toBe('0xabc');
  });

  it('reuses existing client when key matches', async () => {
    const key = '0x' + 'ab'.repeat(32);
    mockSession.privateKey = key;
    mockSession.walletAddress = '0xABC';
    mockSession.smartAccountClient = { account: { address: '0xABC' } };

    const result = await ensureWalletConfigured(mockSession);
    expect(result.ok).toBe(true);
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  it('returns error when SDK throws', async () => {
    (mockGetClient as any).mockRejectedValue(new Error('Invalid key'));
    const result = await ensureWalletConfigured(mockSession, '0x' + 'ff'.repeat(32));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Invalid key');
  });
});
