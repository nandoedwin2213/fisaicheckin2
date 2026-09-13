import { createHash, timingSafeEqual } from 'node:crypto';

/** Hash determinista: permite buscar el terminal por clave sin guardarla en claro. */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey.trim()).digest('hex');
}

export function comparacionSegura(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
