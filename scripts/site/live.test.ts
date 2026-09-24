import { describe, expect, it } from 'vitest';
import { evaluateSchema, evaluateNotFound } from './live.mjs';

const url = 'https://spec-layer.com/schemas/foundation-context/v5.json';
const expected = Buffer.from('{"$id":"https://spec-layer.com/schemas/foundation-context/v5.json"}');

describe('evaluateSchema', () => {
  it('passes when status, type, and bytes all match the committed file', () => {
    expect(
      evaluateSchema({ url, status: 200, contentType: 'application/json', body: Buffer.from(expected), expected }),
    ).toEqual([]);
  });

  it('reports an HTML body, which is what the index.html fallback returns', () => {
    const problems = evaluateSchema({
      url,
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: Buffer.from('<!DOCTYPE html><html></html>'),
      expected,
    });
    expect(problems).toContain(`${url}: content-type is text/html; charset=utf-8, expected application/json`);
    expect(problems).toContain(`${url}: body bytes differ from the committed schema`);
  });

  it('reports a stale body even when the type is right', () => {
    const problems = evaluateSchema({
      url,
      status: 200,
      contentType: 'application/json',
      body: Buffer.from('{"$id":"https://spec-layer.com/schemas/foundation-context/v5.json","old":true}'),
      expected,
    });
    expect(problems).toEqual([`${url}: body bytes differ from the committed schema`]);
  });

  // `res.text()` strips a UTF-8 byte order mark, so a string comparison
  // called this equal. The contract is the bytes.
  it('reports a body that differs only by a byte order mark', () => {
    const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), expected]);
    expect(evaluateSchema({ url, status: 200, contentType: 'application/json', body, expected })).toEqual([
      `${url}: body bytes differ from the committed schema`,
    ]);
  });

  it('reports a non-200 status', () => {
    expect(evaluateSchema({ url, status: 404, contentType: 'text/html', body: Buffer.alloc(0), expected })).toContain(
      `${url}: HTTP 404, expected 200`,
    );
  });
});

describe('evaluateNotFound', () => {
  it('passes on 404', () => {
    expect(evaluateNotFound({ url: 'https://spec-layer.com/no-such-page', status: 404 })).toEqual([]);
  });

  it('reports a 200, which means the index.html fallback is masking a missing file', () => {
    expect(evaluateNotFound({ url: 'https://spec-layer.com/no-such-page', status: 200 })).toEqual([
      'https://spec-layer.com/no-such-page: HTTP 200, expected 404 (no 404.html deployed?)',
    ]);
  });
});
