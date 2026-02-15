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
export declare class EditSession {
    private ops;
    private artifacts;
    private _privateKey;
    private _spaceId;
    private _walletAddress;
    addOps(ops: Op[], artifact: CreatedArtifact): void;
    getOps(): Op[];
    getArtifacts(): CreatedArtifact[];
    clear(): void;
    get opsCount(): number;
    get privateKey(): string | null;
    set privateKey(key: string | null);
    get spaceId(): string | null;
    set spaceId(id: string | null);
    get walletAddress(): string | null;
    set walletAddress(address: string | null);
    getStatus(): SessionStatus;
}
export declare const session: EditSession;
//# sourceMappingURL=session.d.ts.map