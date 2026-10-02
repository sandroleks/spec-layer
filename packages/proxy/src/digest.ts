/**
 * SHA-256 of a string's UTF-8 bytes as lowercase hex, through the runtime's
 * own Web Crypto instead of the pure-JavaScript js-sha256. For a bundle of up
 * to 5 MB, hashed on every publish, native code is the difference that shows
 * in Worker CPU time. The hex is byte for byte what js-sha256 gives, so a
 * stored hash or ETag reads the same either way.
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let hex = '';
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
