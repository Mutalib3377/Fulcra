/**
 * A simple in-memory limit (sliding window) for public endpoints such as the website chat.
 * Per web process: enough for one instance; with several instances each counts on its own.
 */
const hits = new Map<string, number[]>();
let sweeps = 0;

export function allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  // Forget idle keys now and then so memory stays small.
  if (++sweeps % 1000 === 0) {
    for (const [k, times] of hits) if (!times.some((t) => now - t < windowMs)) hits.delete(k);
  }
  return true;
}

/** The visitor's address as seen by our proxy (Cloudflare / Render), for limits only. */
export function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}
