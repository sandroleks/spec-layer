/**
 * Pure checks for the live landing deployment. No network here; the runner in
 * scripts/check-landing-live.mjs fetches and hands the results to these.
 *
 * Why this exists: on 2026-09-06 the custom domain served index.html for the
 * component schema URL (Pages falls back to index.html when a file is missing
 * and there is no 404.html) and a pre-5.1.0 body for the foundation schema.
 * Both returned HTTP 200, so a status check alone would have passed.
 */

/**
 * @param {{ url: string, status: number, contentType: string, body: string, expected: string }} r
 * @returns {string[]} problems, empty when the live response is the committed file
 */
export function evaluateSchema({ url, status, contentType, body, expected }) {
  const problems = [];
  if (status !== 200) problems.push(`${url}: HTTP ${status}, expected 200`);
  const type = (contentType || '').split(';')[0].trim();
  if (type !== 'application/json') {
    problems.push(`${url}: content-type is ${contentType}, expected application/json`);
  }
  if (body !== expected) problems.push(`${url}: body differs from the committed schema`);
  return problems;
}

/**
 * @param {{ url: string, status: number }} r
 * @returns {string[]}
 */
export function evaluateNotFound({ url, status }) {
  if (status === 404) return [];
  return [`${url}: HTTP ${status}, expected 404 (no 404.html deployed?)`];
}
