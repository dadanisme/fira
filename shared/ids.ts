const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Random base62 string (uses Web Crypto; available in browsers and Node ≥ 19). */
export function randomId(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  // 248 = 62 * 4: reject higher bytes to avoid modulo bias.
  let out = '';
  while (out.length < length) {
    for (const b of bytes) if (b < 248 && out.length < length) out += ALPHABET[b % 62];
    crypto.getRandomValues(bytes);
  }
  return out;
}
