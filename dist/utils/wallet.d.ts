import type { Hex } from 'viem';
import type { EditSession } from '../state/session.js';
export declare function withHexPrefix(value: string): `0x${string}`;
export declare function normalizeAddress(value: string, field: string): `0x${string}`;
export declare function normalizeBytes16Hex(value: string, field: string): `0x${string}`;
export declare function ensureWalletConfigured(session: EditSession, privateKeyOverride?: string): Promise<{
    ok: true;
    address: Hex;
} | {
    ok: false;
    error: string;
}>;
//# sourceMappingURL=wallet.d.ts.map