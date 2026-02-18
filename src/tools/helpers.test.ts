import { describe, it, expect } from 'vitest';
import { ok, err } from './helpers.js';

describe('ok', () => {
  it('wraps data as MCP text content', () => {
    const result = ok({ id: 'abc', count: 3 });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ id: 'abc', count: 3 });
  });

  it('handles null and arrays', () => {
    const result = ok([1, 2, 3]);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([1, 2, 3]);
  });

  it('does not set isError', () => {
    const result = ok({ done: true });
    expect(result).not.toHaveProperty('isError');
  });
});

describe('err', () => {
  it('wraps Error instances with message', () => {
    const result = err(new Error('something broke'));
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('something broke');
  });

  it('wraps strings', () => {
    const result = err('plain string');
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('plain string');
  });

  it('wraps numbers and other types', () => {
    const result = err(42);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('42');
  });
});
