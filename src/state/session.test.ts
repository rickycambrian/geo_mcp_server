import { describe, it, expect, beforeEach } from 'vitest';
import { EditSession } from './session.js';

describe('EditSession', () => {
  let session: EditSession;

  beforeEach(() => {
    session = new EditSession();
  });

  it('starts with zero ops', () => {
    expect(session.opsCount).toBe(0);
    expect(session.getOps()).toEqual([]);
  });

  it('accumulates ops via addOps', () => {
    const ops = [{ type: 0 }, { type: 1 }] as any[];
    session.addOps(ops, { id: 'a', type: 'entity', name: 'Test', opsCount: 2 });
    expect(session.opsCount).toBe(2);
    expect(session.getOps()).toHaveLength(2);
  });

  it('tracks artifacts', () => {
    session.addOps([{ type: 0 }] as any[], { id: 'a', type: 'property', name: 'Prop', opsCount: 1 });
    session.addOps([{ type: 1 }] as any[], { id: 'b', type: 'type', name: 'Type', opsCount: 1 });
    const artifacts = session.getArtifacts();
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].name).toBe('Prop');
    expect(artifacts[1].name).toBe('Type');
  });

  it('clear resets ops and artifacts but preserves lastPublished', () => {
    session.addOps([{ type: 0 }] as any[], { id: 'a', type: 'entity', name: 'E', opsCount: 1 });
    session.setLastPublishedOps([{ type: 99 }] as any[]);
    session.clear();
    expect(session.opsCount).toBe(0);
    expect(session.getArtifacts()).toEqual([]);
    expect(session.getLastPublishedOps()).toHaveLength(1);
  });

  it('clear with includeLastPublished clears everything', () => {
    session.addOps([{ type: 0 }] as any[], { id: 'a', type: 'entity', name: 'E', opsCount: 1 });
    session.setLastPublishedOps([{ type: 99 }] as any[]);
    session.clear({ includeLastPublished: true });
    expect(session.opsCount).toBe(0);
    expect(session.getLastPublishedOps()).toEqual([]);
  });

  it('getOps returns a copy', () => {
    session.addOps([{ type: 0 }] as any[], { id: 'a', type: 'entity', name: 'E', opsCount: 1 });
    const ops = session.getOps();
    ops.push({ type: 999 } as any);
    expect(session.opsCount).toBe(1);
  });

  it('wallet properties start null', () => {
    expect(session.privateKey).toBeNull();
    expect(session.walletAddress).toBeNull();
    expect(session.spaceId).toBeNull();
    expect(session.smartAccountClient).toBeNull();
  });

  it('getStatus reflects current state', () => {
    session.privateKey = '0xabc';
    session.walletAddress = '0x123';
    session.spaceId = 'space1';
    session.addOps([{ type: 0 }] as any[], { id: 'a', type: 'entity', name: 'E', opsCount: 1 });

    const status = session.getStatus();
    expect(status.walletConfigured).toBe(true);
    expect(status.walletAddress).toBe('0x123');
    expect(status.spaceId).toBe('space1');
    expect(status.opsCount).toBe(1);
    expect(status.network).toBe('TESTNET');
    expect(status.mode).toBe('full');
    expect(status.pendingTransactionCount).toBe(0);
  });

  // ── Wallet mode ──────────────────────────────────────────────────

  it('defaults to PRIVATE_KEY wallet mode', () => {
    expect(session.walletMode).toBe('PRIVATE_KEY');
  });

  it('can switch to APPROVAL mode', () => {
    session.walletMode = 'APPROVAL';
    expect(session.walletMode).toBe('APPROVAL');
  });

  it('getStatus returns approval mode when walletMode is APPROVAL with address', () => {
    session.walletMode = 'APPROVAL';
    session.walletAddress = '0xabc';
    const status = session.getStatus();
    expect(status.mode).toBe('approval');
    expect(status.walletConfigured).toBe(true);
  });

  it('getStatus returns read-only when APPROVAL mode without address', () => {
    session.walletMode = 'APPROVAL';
    const status = session.getStatus();
    expect(status.mode).toBe('read-only');
    expect(status.walletConfigured).toBe(false);
  });

  // ── Pending transactions ─────────────────────────────────────────

  it('starts with empty pending transactions', () => {
    expect(session.pendingTransactions).toEqual([]);
  });

  it('adds and retrieves pending transactions', () => {
    const tx = { id: 'tx1', to: '0x1' as `0x${string}`, data: '0x2' as `0x${string}`, description: 'test', toolName: 'test' };
    session.addPendingTransaction(tx);
    expect(session.pendingTransactions).toHaveLength(1);
    expect(session.getPendingTransaction('tx1')).toEqual(tx);
  });

  it('removes pending transactions', () => {
    const tx = { id: 'tx1', to: '0x1' as `0x${string}`, data: '0x2' as `0x${string}`, description: 'test', toolName: 'test' };
    session.addPendingTransaction(tx);
    expect(session.removePendingTransaction('tx1')).toBe(true);
    expect(session.pendingTransactions).toHaveLength(0);
    expect(session.removePendingTransaction('tx1')).toBe(false);
  });

  it('pendingTransactions getter returns a copy', () => {
    const tx = { id: 'tx1', to: '0x1' as `0x${string}`, data: '0x2' as `0x${string}`, description: 'test', toolName: 'test' };
    session.addPendingTransaction(tx);
    const copy = session.pendingTransactions;
    copy.push({ id: 'tx2', to: '0x3' as `0x${string}`, data: '0x4' as `0x${string}`, description: 'test2', toolName: 'test2' });
    expect(session.pendingTransactions).toHaveLength(1);
  });

  it('getStatus includes pendingTransactionCount', () => {
    const tx = { id: 'tx1', to: '0x1' as `0x${string}`, data: '0x2' as `0x${string}`, description: 'test', toolName: 'test' };
    session.addPendingTransaction(tx);
    expect(session.getStatus().pendingTransactionCount).toBe(1);
  });

  // ── Continuations ────────────────────────────────────────────────

  it('adds and retrieves continuations', () => {
    const cont = { pendingTxId: 'tx1', onComplete: 'auto_vote' as const, context: { proposalId: 'p1' } };
    session.addContinuation(cont);
    expect(session.getContinuation('tx1')).toEqual(cont);
  });

  it('removes continuations', () => {
    const cont = { pendingTxId: 'tx1', onComplete: 'auto_vote' as const, context: {} };
    session.addContinuation(cont);
    expect(session.removeContinuation('tx1')).toBe(true);
    expect(session.getContinuation('tx1')).toBeUndefined();
    expect(session.removeContinuation('tx1')).toBe(false);
  });

  it('clear resets pending transactions and continuations', () => {
    session.addPendingTransaction({ id: 'tx1', to: '0x1' as `0x${string}`, data: '0x2' as `0x${string}`, description: 'test', toolName: 'test' });
    session.addContinuation({ pendingTxId: 'tx1', onComplete: 'auto_vote' as const, context: {} });
    session.clear();
    expect(session.pendingTransactions).toHaveLength(0);
    expect(session.getContinuation('tx1')).toBeUndefined();
  });
});
