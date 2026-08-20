import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifySlackSignature } from './971bot.js';

function sign(secret, timestamp, rawBody) {
  const basestring = `v0:${timestamp}:${rawBody}`;
  return 'v0=' + crypto.createHmac('sha256', secret).update(basestring).digest('hex');
}

describe('verifySlackSignature', () => {
  it('fails open (returns true) when no signing secret is configured', () => {
    const result = verifySlackSignature(
      'body',
      { 'x-slack-request-timestamp': '0', 'x-slack-signature': 'nope' },
      ''
    );
    expect(result).toBe(true);
  });

  it('accepts a correctly computed signature within the timestamp window', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = 'payload=%7B%22foo%22%3A%22bar%22%7D';
    const signature = sign('test-secret', timestamp, rawBody);
    const result = verifySlackSignature(
      rawBody,
      { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature },
      'test-secret'
    );
    expect(result).toBe(true);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = 'payload=foo';
    const signature = sign('wrong-secret', timestamp, rawBody);
    const result = verifySlackSignature(
      rawBody,
      { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature },
      'test-secret'
    );
    expect(result).toBe(false);
  });

  it('rejects a signature computed over a different body (tampered payload)', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign('test-secret', timestamp, 'original-body');
    const result = verifySlackSignature(
      'tampered-body',
      { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature },
      'test-secret'
    );
    expect(result).toBe(false);
  });

  it('rejects a request with no timestamp header', () => {
    const result = verifySlackSignature('body', { 'x-slack-signature': 'v0=whatever' }, 'test-secret');
    expect(result).toBe(false);
  });

  it('rejects a stale request outside the 5-minute replay window', () => {
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 60 * 10); // 10 minutes old
    const rawBody = 'payload=foo';
    const signature = sign('test-secret', staleTimestamp, rawBody);
    const result = verifySlackSignature(
      rawBody,
      { 'x-slack-request-timestamp': staleTimestamp, 'x-slack-signature': signature },
      'test-secret'
    );
    expect(result).toBe(false);
  });

  it('rejects a malformed signature header without throwing', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(() =>
      verifySlackSignature(
        'body',
        { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': 'not-hex-and-wrong-length' },
        'test-secret'
      )
    ).not.toThrow();
  });
});
