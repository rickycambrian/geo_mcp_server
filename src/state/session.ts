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

export class EditSession {
  private ops: Op[] = [];
  private lastPublishedOps: Op[] = [];
  private artifacts: CreatedArtifact[] = [];
  private _privateKey: string | null = null;
  private _spaceId: string | null = null;
  private _walletAddress: string | null = null;
  private _smartAccountClient: GeoSmartAccount | null = null;
  private _walletMode: WalletMode = 'PRIVATE_KEY';
  private _pendingTransactions: PendingTransaction[] = [];
  private _continuations: Map<string, TransactionContinuation> = new Map();

  addOps(ops: Op[], artifact: CreatedArtifact): void {
    this.ops.push(...ops);
    this.artifacts.push(artifact);
  }

  getOps(): Op[] {
    return [...this.ops];
  }

  setLastPublishedOps(ops: Op[]): void {
    this.lastPublishedOps = [...ops];
  }

  getLastPublishedOps(): Op[] {
    return [...this.lastPublishedOps];
  }

  getArtifacts(): CreatedArtifact[] {
    return [...this.artifacts];
  }

  clear(options?: { includeLastPublished?: boolean }): void {
    this.ops = [];
    this.artifacts = [];
    if (options?.includeLastPublished) {
      this.lastPublishedOps = [];
    }
    this._pendingTransactions = [];
    this._continuations = new Map();
  }

  get opsCount(): number {
    return this.ops.length;
  }

  get privateKey(): string | null {
    return this._privateKey;
  }

  set privateKey(key: string | null) {
    this._privateKey = key;
  }

  get spaceId(): string | null {
    return this._spaceId;
  }

  set spaceId(id: string | null) {
    this._spaceId = id;
  }

  get walletAddress(): string | null {
    return this._walletAddress;
  }

  set walletAddress(address: string | null) {
    this._walletAddress = address;
  }

  get smartAccountClient(): GeoSmartAccount | null {
    return this._smartAccountClient;
  }

  set smartAccountClient(client: GeoSmartAccount | null) {
    this._smartAccountClient = client;
  }

  get walletMode(): WalletMode {
    return this._walletMode;
  }

  set walletMode(mode: WalletMode) {
    this._walletMode = mode;
  }

  // ── Pending transactions ───────────────────────────────────────────

  get pendingTransactions(): PendingTransaction[] {
    return [...this._pendingTransactions];
  }

  addPendingTransaction(tx: PendingTransaction): void {
    this._pendingTransactions.push(tx);
  }

  getPendingTransaction(id: string): PendingTransaction | undefined {
    return this._pendingTransactions.find((tx) => tx.id === id);
  }

  removePendingTransaction(id: string): boolean {
    const idx = this._pendingTransactions.findIndex((tx) => tx.id === id);
    if (idx === -1) return false;
    this._pendingTransactions.splice(idx, 1);
    return true;
  }

  // ── Continuations ──────────────────────────────────────────────────

  addContinuation(c: TransactionContinuation): void {
    this._continuations.set(c.pendingTxId, c);
  }

  getContinuation(pendingTxId: string): TransactionContinuation | undefined {
    return this._continuations.get(pendingTxId);
  }

  removeContinuation(pendingTxId: string): boolean {
    return this._continuations.delete(pendingTxId);
  }

  getStatus(): SessionStatus {
    const walletConfigured =
      this._walletMode === 'APPROVAL'
        ? this._walletAddress !== null
        : this._privateKey !== null;

    let mode: 'full' | 'read-only' | 'approval';
    if (this._walletMode === 'APPROVAL' && this._walletAddress !== null) {
      mode = 'approval';
    } else if (walletConfigured) {
      mode = 'full';
    } else {
      mode = 'read-only';
    }

    return {
      opsCount: this.ops.length,
      lastPublishedOpsCount: this.lastPublishedOps.length,
      artifacts: [...this.artifacts],
      walletConfigured,
      spaceId: this._spaceId,
      walletAddress: this._walletAddress,
      network: 'TESTNET',
      mode,
      pendingTransactionCount: this._pendingTransactions.length,
    };
  }
}

// Singleton session instance
export const session = new EditSession();
