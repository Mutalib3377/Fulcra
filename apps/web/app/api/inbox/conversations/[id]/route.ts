import { getConversation } from '@fulcra/core';
import { jsonRoute } from '@/lib/api';
import { imageUrls } from '@/lib/images';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return jsonRoute(async ({ actor }) => {
    const view = await getConversation(actor, id);
    return {
      ...view,
      messages: view.messages.map((message) => ({
        ...message,
        imageUrl: message.media?.image ? imageUrls(message.media.image).md : null,
      })),
    };
  });
}
