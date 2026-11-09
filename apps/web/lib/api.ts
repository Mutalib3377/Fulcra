import 'server-only';
import { isCoreError } from '@fulcra/core';
import { ZodError } from 'zod';
import { getActionContext, type DashboardContext } from './auth';

/**
 * JSON endpoints for live screens (polled with TanStack Query). Signed-in members only;
 * expected errors become 4xx with a plain message.
 */
export async function jsonRoute<T>(
  handler: (context: DashboardContext) => Promise<T>,
): Promise<Response> {
  const context = await getActionContext();
  if (!context) return Response.json({ error: 'Please sign in again.' }, { status: 401 });
  try {
    return Response.json(await handler(context), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (isCoreError(error)) {
      const status = error.code === 'not_found' ? 404 : error.code === 'forbidden' ? 403 : 400;
      return Response.json({ error: error.message }, { status });
    }
    if (error instanceof ZodError) return Response.json({ error: 'Not found.' }, { status: 404 });
    throw error;
  }
}
