import { inboxTemplateOptions } from '@fulcra/core';
import { jsonRoute } from '@/lib/api';

/** The templates the team can send in a chat whose 24-hour window has closed. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return jsonRoute(({ actor }) => inboxTemplateOptions(actor, id));
}
