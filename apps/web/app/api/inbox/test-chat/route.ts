import { getTestChat } from '@fulcra/core';
import { jsonRoute } from '@/lib/api';
import { imageUrls } from '@/lib/images';

export function GET() {
  return jsonRoute(async ({ actor }) => {
    const chat = await getTestChat(actor);
    return {
      ...chat,
      messages: chat.messages.map((message) => ({
        ...message,
        imageUrl: message.media?.image ? imageUrls(message.media.image).md : null,
      })),
    };
  });
}
