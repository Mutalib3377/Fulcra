// Health check for Render and uptime monitoring.
export function GET() {
  return Response.json({ status: 'ok' });
}
