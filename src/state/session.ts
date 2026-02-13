/**
 * Edit session state management for the Geo MCP server.
 * Manages op accumulation across tool calls and tracks created artifacts.
 */
import type { Op } from '@geoprotocol/grc-20';

export interface CreatedArtifact {
  id: string;
  type: 'property' | 'type' | 'entity' | 'relation' | 'image';
  name: string;
  opsCount: number;
}

export interface SessionStatus {
  opsCount: number;
  artifacts: CreatedArtifact[];
  walletConfigured: boolean;
  spaceId: string | null;
  network: 'TESTNET';
}

export class EditSession {
  private ops: Op[] = [];
  private artifacts: CreatedArtifact[] = [];
  private _privateKey: string | null = null;
  private _spaceId: string | null = null;
  private _walletAddress: string | null = null;

  addOps(ops: Op[], artifact: CreatedArtifact): void {
    this.ops.push(...ops);
    this.artifacts.push(artifact);
  }

  getOps(): Op[] {
    return [...this.ops];
  }

  getArtifacts(): CreatedArtifact[] {
    return [...this.artifacts];
  }

  clear(): void {
    this.ops = [];
    this.artifacts = [];
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

  getStatus(): SessionStatus {
    return {
      opsCount: this.ops.length,
      artifacts: [...this.artifacts],
      walletConfigured: this._privateKey !== null,
      spaceId: this._spaceId,
      network: 'TESTNET',
    };
  }
}

// Singleton session instance
export const session = new EditSession();
