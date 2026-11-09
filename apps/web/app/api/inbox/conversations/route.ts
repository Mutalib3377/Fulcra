import { inboxFilters, listConversations, type InboxFilter } from '@fulcra/core';
import { jsonRoute } from '@/lib/api';

export function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('filter');
  const filter: InboxFilter = (inboxFilters as readonly string[]).includes(raw ?? '')
    ? (raw as InboxFilter)
    : 'all';
  return jsonRoute(({ actor }) => listConversations(actor, filter));
}
