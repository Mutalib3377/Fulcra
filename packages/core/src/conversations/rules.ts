// Pure conversation rules (no database). Browser-safe via `@fulcra/core/rules`.

/** Meta: free-form replies only within 24 hours of the customer's last message. */
export const REPLY_WINDOW_HOURS = 24;

const WINDOWED = new Set(['whatsapp', 'instagram']);

export type ReplyWindow =
  { open: true; closesAt: Date | null } | { open: false; closedAt: Date | null };

/**
 * Whether the team (or the assistant) may send a free-form message now.
 * Website chat has no window. On WhatsApp and Instagram it closes 24 hours after the
 * customer's last message (and is closed if the customer never wrote).
 */
export function replyWindow(
  channel: string,
  lastCustomerMessageAt: Date | string | null,
  now: Date = new Date(),
): ReplyWindow {
  if (!WINDOWED.has(channel)) return { open: true, closesAt: null };
  if (!lastCustomerMessageAt) return { open: false, closedAt: null };
  const closes = new Date(
    new Date(lastCustomerMessageAt).getTime() + REPLY_WINDOW_HOURS * 3_600_000,
  );
  return closes > now ? { open: true, closesAt: closes } : { open: false, closedAt: closes };
}

/** A short line for the inbox list. */
export function messagePreview(message: { type: string; text: string }): string {
  const label: Record<string, string> = {
    image: '📷 Photo',
    audio: '🎤 Voice note',
    video: '🎬 Video',
    document: '📄 File',
    location: '📍 Location',
    unsupported: 'Message',
  };
  const text = message.text.replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 120);
  return label[message.type] ?? 'Message';
}

export const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  web: 'Website chat',
};
