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
  });
});
