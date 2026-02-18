/**
 * Shared wallet configuration helpers.
 * Extracted from spaces.ts for reuse in governance tools.
 */
import { getSmartAccountWalletClient } from '@geoprotocol/geo-sdk';
import type { Hex } from 'viem';
import type { EditSession } from '../state/session.js';

export function withHexPrefix(value: string): `0x${string}` {
  const trimmed = value.trim().toLowerCase();
  return (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as `0x${string}`;
}

export function normalizeAddress(value: string, field: string): `0x${string}` {
  const normalized = withHexPrefix(value);
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${field} must be an EVM address (20-byte hex, with or without 0x prefix)`);
  }
  return normalized;
}

export function normalizeBytes16Hex(value: string, field: string): `0x${string}` {
  const normalized = withHexPrefix(value);
  if (!/^0x[0-9a-f]{32}$/.test(normalized)) {
    throw new Error(`${field} must be bytes16 hex (0x followed by 32 hex chars). Received: ${value}`);
  }
  return normalized;
}

export async function ensureWalletConfigured(
  session: EditSession,
  privateKeyOverride?: string,
): Promise<{ ok: true; address: Hex } | { ok: false; error: string }> {
  const normalizedOverride = privateKeyOverride ? withHexPrefix(privateKeyOverride) : null;
  const normalizedSessionKey = session.privateKey ? withHexPrefix(session.privateKey) : null;
  const sessionClient = session.smartAccountClient;

  // Reuse the existing client only if it matches the session wallet address and
  // we're not being asked to switch keys.
  if (
    normalizedSessionKey
    && session.walletAddress
    && sessionClient
    && sessionClient.account.address.toLowerCase() === session.walletAddress.toLowerCase()
    && (!normalizedOverride || normalizedOverride === normalizedSessionKey)
  ) {
    return { ok: true, address: session.walletAddress as Hex };
  }

  const privateKey =
    normalizedOverride
    ?? normalizedSessionKey
    ?? (process.env.GEO_PRIVATE_KEY ? withHexPrefix(process.env.GEO_PRIVATE_KEY) : null);

  if (!privateKey) {
    return {
      ok: false,
      error:
        'Wallet not configured. Configure GEO_PRIVATE_KEY secret (recommended) or call configure_wallet with a privateKey.',
    };
  }

  try {
    const client = await getSmartAccountWalletClient({ privateKey: privateKey as Hex });
    session.smartAccountClient = client;
    session.privateKey = privateKey;
    session.walletAddress = client.account.address;
    return { ok: true, address: client.account.address };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to configure wallet: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
