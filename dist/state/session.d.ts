/**
 * Edit session state management for the Geo MCP server.
 * Manages op accumulation across tool calls and tracks created artifacts.
 */
import type { Op } from '@geoprotocol/grc-20';
import type { GeoSmartAccount } from '@geoprotocol/geo-sdk';
import type { PendingTransaction, TransactionContinuation } from '../utils/tx-executor.js';
export type WalletMode = 'PRIVATE_KEY' | 'APPROVAL';
export interface CreatedArtifact {
    id: string;
    type: 'property' | 'type' | 'entity' | 'relation' | 'image';
    name: string;
    opsCount: number;
}
export interface SessionStatus {
    opsCount: number;
    lastPublishedOpsCount: number;
    artifacts: CreatedArtifact[];
    walletConfigured: boolean;
    spaceId: string | null;
    walletAddress: string | null;
    network: 'TESTNET';
    mode: 'full' | 'read-only' | 'approval';
    pendingTransactionCount: number;
}
export declare class EditSession {
    private ops;
    private lastPublishedOps;
    private artifacts;
    private _privateKey;
    private _spaceId;
    private _walletAddress;
    private _smartAccountClient;
    private _walletMode;
    private _pendingTransactions;
    private _continuations;
    addOps(ops: Op[], artifact: CreatedArtifact): void;
    getOps(): Op[];
    setLastPublishedOps(ops: Op[]): void;
    getLastPublishedOps(): Op[];
    getArtifacts(): CreatedArtifact[];
    clear(options?: {
        includeLastPublished?: boolean;
    }): void;
    get opsCount(): number;
    get privateKey(): string | null;
    set privateKey(key: string | null);
    get spaceId(): string | null;
    set spaceId(id: string | null);
    get walletAddress(): string | null;
    set walletAddress(address: string | null);
    get smartAccountClient(): GeoSmartAccount | null;
    set smartAccountClient(client: GeoSmartAccount | null);
    get walletMode(): WalletMode;
    set walletMode(mode: WalletMode);
    get pendingTransactions(): PendingTransaction[];
    addPendingTransaction(tx: PendingTransaction): void;
    getPendingTransaction(id: string): PendingTransaction | undefined;
    removePendingTransaction(id: string): boolean;
    addContinuation(c: TransactionContinuation): void;
    getContinuation(pendingTxId: string): TransactionContinuation | undefined;
    removeContinuation(pendingTxId: string): boolean;
    getStatus(): SessionStatus;
}
export declare const session: EditSession;
//# sourceMappingURL=session.d.ts.map