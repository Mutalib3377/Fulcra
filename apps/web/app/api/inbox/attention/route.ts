import { countConversationsNeedingAttention } from '@fulcra/core';
import { jsonRoute } from '@/lib/api';

/** Chats waiting for the team (badge on the Inbox tab). */
export function GET() {
  return jsonRoute(async ({ actor }) => ({
    count: await countConversationsNeedingAttention(actor),
  }));
}
