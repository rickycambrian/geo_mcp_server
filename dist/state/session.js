export class EditSession {
    ops = [];
    lastPublishedOps = [];
    artifacts = [];
    _privateKey = null;
    _spaceId = null;
    _walletAddress = null;
    _smartAccountClient = null;
    _walletMode = 'PRIVATE_KEY';
    _pendingTransactions = [];
    _continuations = new Map();
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
        this._pendingTransactions = [];
        this._continuations = new Map();
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
    get smartAccountClient() {
        return this._smartAccountClient;
    }
    set smartAccountClient(client) {
        this._smartAccountClient = client;
    }
    get walletMode() {
        return this._walletMode;
    }
    set walletMode(mode) {
        this._walletMode = mode;
    }
    // ── Pending transactions ───────────────────────────────────────────
    get pendingTransactions() {
        return [...this._pendingTransactions];
    }
    addPendingTransaction(tx) {
        this._pendingTransactions.push(tx);
    }
    getPendingTransaction(id) {
        return this._pendingTransactions.find((tx) => tx.id === id);
    }
    removePendingTransaction(id) {
        const idx = this._pendingTransactions.findIndex((tx) => tx.id === id);
        if (idx === -1)
            return false;
        this._pendingTransactions.splice(idx, 1);
        return true;
    }
    // ── Continuations ──────────────────────────────────────────────────
    addContinuation(c) {
        this._continuations.set(c.pendingTxId, c);
    }
    getContinuation(pendingTxId) {
        return this._continuations.get(pendingTxId);
    }
    removeContinuation(pendingTxId) {
        return this._continuations.delete(pendingTxId);
    }
    getStatus() {
        const walletConfigured = this._walletMode === 'APPROVAL'
            ? this._walletAddress !== null
            : this._privateKey !== null;
        let mode;
        if (this._walletMode === 'APPROVAL' && this._walletAddress !== null) {
            mode = 'approval';
        }
        else if (walletConfigured) {
            mode = 'full';
        }
        else {
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
//# sourceMappingURL=session.js.map