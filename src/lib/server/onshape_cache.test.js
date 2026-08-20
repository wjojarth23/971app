import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getCached, setCached, clearOnshapeCache, buildCacheKey, CACHE_TTL_MS } from './onshape_cache.js';

describe('buildCacheKey', () => {
  it('joins the action and params into a stable, distinct key', () => {
    expect(buildCacheKey('document-info', ['doc1'])).toBe('document-info:doc1');
  });

  it('produces different keys for different params on the same action', () => {
    const a = buildCacheKey('assembly-bom', ['doc1', 'ws1', 'el1']);
    const b = buildCacheKey('assembly-bom', ['doc1', 'ws2', 'el1']);
    expect(a).not.toBe(b);
  });

  it('produces different keys for the same params on different actions', () => {
    const a = buildCacheKey('versions', ['doc1']);
    const b = buildCacheKey('document-info', ['doc1']);
    expect(a).not.toBe(b);
  });
});

describe('getCached / setCached', () => {
  beforeEach(() => {
    clearOnshapeCache();
    vi.useRealTimers();
  });

  it('returns null for a key that was never set', () => {
    expect(getCached('nope')).toBeNull();
  });

  it('returns the stored value while still within its TTL', () => {
    setCached('key1', { hello: 'world' }, 60_000);
    expect(getCached('key1')).toEqual({ hello: 'world' });
  });

  it('returns null once the TTL has expired', () => {
    vi.useFakeTimers();
    setCached('key1', { hello: 'world' }, 1000);
    vi.advanceTimersByTime(1001);
    expect(getCached('key1')).toBeNull();
    vi.useRealTimers();
  });

  it('does not return a value for a different key (no key collisions)', () => {
    setCached('key1', 'value1', 60_000);
    setCached('key2', 'value2', 60_000);
    expect(getCached('key1')).toBe('value1');
    expect(getCached('key2')).toBe('value2');
  });

  it('overwrites a previous value stored under the same key', () => {
    setCached('key1', 'first', 60_000);
    setCached('key1', 'second', 60_000);
    expect(getCached('key1')).toBe('second');
  });
});

describe('CACHE_TTL_MS', () => {
  it('only enables caching for the intended read-mostly metadata actions', () => {
    expect(CACHE_TTL_MS['document-info']).toBeGreaterThan(0);
    expect(CACHE_TTL_MS['assembly-bom']).toBeGreaterThan(0);
    expect(CACHE_TTL_MS['versions']).toBeGreaterThan(0);
    expect(CACHE_TTL_MS['version-details']).toBeGreaterThan(0);
    expect(CACHE_TTL_MS['shaded-views']).toBeGreaterThan(0);
    // File-download/translation actions must never be cached - see the
    // route's own reasoning (one-shot user-triggered, not repeat traffic).
    expect(CACHE_TTL_MS['download-step']).toBeUndefined();
    expect(CACHE_TTL_MS['download-stl']).toBeUndefined();
    expect(CACHE_TTL_MS['translate-part']).toBeUndefined();
    expect(CACHE_TTL_MS['convert-to-svg']).toBeUndefined();
  });

  it('caches version-details the longest, since a version is immutable once it exists', () => {
    expect(CACHE_TTL_MS['version-details']).toBeGreaterThan(CACHE_TTL_MS['document-info']);
    expect(CACHE_TTL_MS['version-details']).toBeGreaterThan(CACHE_TTL_MS['versions']);
  });
});
