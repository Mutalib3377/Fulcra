import { systemHealth } from '@fulcra/core';

export const dynamic = 'force-dynamic';

/**
 * Health check. Plain (Render's check): the web process answers.
 * With ?deep=1 (uptime monitor): database reachable, worker keeping up with jobs, webhooks
 * being processed. Answers 503 when something is wrong. Counts only, no business data.
 */
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get('deep') !== '1') {
    return Response.json({ status: 'ok' });
  }
  const health = await systemHealth();
  return Response.json(
    { status: health.ok ? 'ok' : 'degraded', checks: health.checks },
    { status: health.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
