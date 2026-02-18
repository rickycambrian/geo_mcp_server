/**
 * Shared wallet configuration helpers.
 * Extracted from spaces.ts for reuse in governance tools.
 */
import { getSmartAccountWalletClient } from '@geoprotocol/geo-sdk';
export function withHexPrefix(value) {
    const trimmed = value.trim().toLowerCase();
    return (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`);
}
export function normalizeAddress(value, field) {
    const normalized = withHexPrefix(value);
    if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
        throw new Error(`${field} must be an EVM address (20-byte hex, with or without 0x prefix)`);
    }
    return normalized;
}
export function normalizeBytes16Hex(value, field) {
    const normalized = withHexPrefix(value);
    if (!/^0x[0-9a-f]{32}$/.test(normalized)) {
        throw new Error(`${field} must be bytes16 hex (0x followed by 32 hex chars). Received: ${value}`);
    }
    return normalized;
}
export async function ensureWalletConfigured(session, privateKeyOverride) {
    const normalizedOverride = privateKeyOverride ? withHexPrefix(privateKeyOverride) : null;
    const normalizedSessionKey = session.privateKey ? withHexPrefix(session.privateKey) : null;
    const sessionClient = session.smartAccountClient;
    // Reuse the existing client only if it matches the session wallet address and
    // we're not being asked to switch keys.
    if (normalizedSessionKey
        && session.walletAddress
        && sessionClient
        && sessionClient.account.address.toLowerCase() === session.walletAddress.toLowerCase()
        && (!normalizedOverride || normalizedOverride === normalizedSessionKey)) {
        return { ok: true, address: session.walletAddress };
    }
    const privateKey = normalizedOverride
        ?? normalizedSessionKey
        ?? (process.env.GEO_PRIVATE_KEY ? withHexPrefix(process.env.GEO_PRIVATE_KEY) : null);
    if (!privateKey) {
        return {
            ok: false,
            error: 'Wallet not configured. Configure GEO_PRIVATE_KEY secret (recommended) or call configure_wallet with a privateKey.',
        };
    }
    try {
        const client = await getSmartAccountWalletClient({ privateKey: privateKey });
        session.smartAccountClient = client;
        session.privateKey = privateKey;
        session.walletAddress = client.account.address;
        return { ok: true, address: client.account.address };
    }
    catch (error) {
        return {
            ok: false,
            error: `Failed to configure wallet: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
//# sourceMappingURL=wallet.js.map