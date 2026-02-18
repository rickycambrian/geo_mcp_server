/**
 * Edit session state management for the Geo MCP server.
 * Manages op accumulation across tool calls and tracks created artifacts.
 */
import type { Op } from '@geoprotocol/grc-20';
import type { GeoSmartAccount } from '@geoprotocol/geo-sdk';

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
}

export class EditSession {
  private ops: Op[] = [];
  private lastPublishedOps: Op[] = [];
  private artifacts: CreatedArtifact[] = [];
  private _privateKey: string | null = null;
  private _spaceId: string | null = null;
  private _walletAddress: string | null = null;
  private _smartAccountClient: GeoSmartAccount | null = null;

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

  getStatus(): SessionStatus {
    return {
      opsCount: this.ops.length,
      lastPublishedOpsCount: this.lastPublishedOps.length,
      artifacts: [...this.artifacts],
      walletConfigured: this._privateKey !== null,
      spaceId: this._spaceId,
      walletAddress: this._walletAddress,
      network: 'TESTNET',
    };
  }
}

// Singleton session instance
export const session = new EditSession();
