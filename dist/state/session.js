export class EditSession {
    ops = [];
    lastPublishedOps = [];
    artifacts = [];
    _privateKey = null;
    _spaceId = null;
    _walletAddress = null;
    addOps(ops, artifact) {
        this.ops.push(...ops);
        this.artifacts.push(artifact);
    }
    getOps() {
        return [...this.ops];
    }
    setLastPublishedOps(ops) {
        this.lastPublishedOps = [...ops];
    }
    getLastPublishedOps() {
        return [...this.lastPublishedOps];
    }
    getArtifacts() {
        return [...this.artifacts];
    }
    clear(options) {
        this.ops = [];
        this.artifacts = [];
        if (options?.includeLastPublished) {
            this.lastPublishedOps = [];
        }
    }
    get opsCount() {
        return this.ops.length;
    }
    get privateKey() {
        return this._privateKey;
    }
    set privateKey(key) {
        this._privateKey = key;
    }
    get spaceId() {
        return this._spaceId;
    }
    set spaceId(id) {
        this._spaceId = id;
    }
    get walletAddress() {
        return this._walletAddress;
    }
    set walletAddress(address) {
        this._walletAddress = address;
    }
    getStatus() {
        return {
            opsCount: this.ops.length,
            lastPublishedOpsCount: this.lastPublishedOps.length,
            artifacts: [...this.artifacts],
            walletConfigured: this._privateKey !== null,
            spaceId: this._spaceId,
            network: 'TESTNET',
        };
    }
}
// Singleton session instance
export const session = new EditSession();
//# sourceMappingURL=session.js.map