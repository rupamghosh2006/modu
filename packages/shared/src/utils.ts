import crypto from 'node:crypto';

/**
 * Convert human-readable decimal amount (e.g. "0.01") to micro-units (e.g. "10000")
 * using exact string parsing to avoid floating-point errors.
 */
export function toBaseUnits(amount: string | number, decimals: number = 6): string {
  const str = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) {
    throw new Error(`Invalid amount format: "${amount}"`);
  }

  const [whole, fraction = ''] = str.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  const combined = `${whole}${paddedFraction}`.replace(/^0+(?=\d)/, '');
  return combined === '' ? '0' : combined;
}

/**
 * Convert micro-units (e.g. "10000") to human-readable decimal amount (e.g. "0.01")
 */
export function fromBaseUnits(baseUnits: string | number | bigint, decimals: number = 6): string {
  const str = String(baseUnits).trim();
  if (!/^\d+$/.test(str)) {
    throw new Error(`Invalid base units format: "${baseUnits}"`);
  }

  if (str.length <= decimals) {
    const padded = str.padStart(decimals, '0');
    const trimmed = padded.replace(/0+$/, '');
    return trimmed.length > 0 ? `0.${trimmed}` : '0';
  }

  const whole = str.slice(0, str.length - decimals);
  const fraction = str.slice(str.length - decimals).replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

/**
 * Generate a cryptographically secure random challenge nonce
 */
export function generateNonce(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Encode note string into Uint8Array for Algorand transaction
 */
export function encodeNote(nonce: string, prefix = 'modu:'): Uint8Array {
  const text = `${prefix}${nonce}`;
  return new TextEncoder().encode(text);
}

/**
 * Decode Algorand note bytes or base64 string into plain text
 */
export function decodeNote(note: Uint8Array | string): string {
  let raw: string;
  if (typeof note === 'string') {
    // Might be base64 from indexer
    try {
      raw = Buffer.from(note, 'base64').toString('utf8');
    } catch {
      raw = note;
    }
  } else {
    raw = new TextDecoder().decode(note);
  }

  if (raw.startsWith('modu:')) {
    return raw.slice(5);
  }
  return raw;
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'x-payment-txid',
  'x-payment',
  'payment-signature',
]);

/**
 * Determine if an HTTP header is hop-by-hop and should not be forwarded
 */
export function isHopByHopHeader(headerName: string): boolean {
  return HOP_BY_HOP_HEADERS.has(headerName.toLowerCase());
}
