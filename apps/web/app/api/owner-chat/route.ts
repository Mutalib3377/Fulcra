import { getOwnerDashboardChat } from '@fulcra/core';
import { jsonRoute } from '@/lib/api';
import { imageUrls } from '@/lib/images';

/** The owner's "Ask Fulcra" chat (polled while open). */
export function GET() {
  return jsonRoute(async ({ actor }) => {
    const chat = await getOwnerDashboardChat(actor);
    return {
      ...chat,
      messages: chat.messages.map((m) => ({
        id: m.id,
        sender: m.sender,
        text: m.text,
        createdAt: m.createdAt,
        imageUrl: m.image ? imageUrls(m.image).sm : null,
      })),
    };
  });
}
