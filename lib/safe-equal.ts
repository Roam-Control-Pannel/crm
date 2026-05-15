// Constant-time string comparison for shared-secret checks (bearer tokens,
// internal-call secrets). Equivalent to crypto.timingSafeEqual but works in
// both the Node and Edge runtimes — middleware.ts can't reach node:crypto.
//
// A length mismatch returns immediately; this leaks the length only, which
// is the same trade-off the stdlib version makes.
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
