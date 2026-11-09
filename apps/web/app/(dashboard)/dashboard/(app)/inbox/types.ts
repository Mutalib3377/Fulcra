import type { ConversationHandler, MessageMedia } from '@fulcra/core/rules';

// What the inbox endpoints return (dates arrive as strings over JSON).

export type InboxItem = {
  id: string;
  customerName: string;
  customerPhone: string | null;
  channel: string;
  isTest: boolean;
  handledBy: ConversationHandler;
  needsAttention: boolean;
  attentionReason: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadCount: number;
};

export type ChatMessage = {
  id: string;
  direction: 'inbound' | 'outbound';
  sender: 'customer' | 'agent' | 'human' | 'system';
  type: string;
  text: string;
  media: MessageMedia | null;
  /** Stored photo, ready to show. */
  imageUrl?: string | null;
  status: string;
  error: string | null;
  createdAt: string;
};

export type ChatView = {
  conversation: {
    id: string;
    channel: string;
    handledBy: ConversationHandler;
    needsAttention: boolean;
    attentionReason: string | null;
  };
  customer: { id: string; name: string; phone: string | null };
  connection: { mode: 'live' | 'test'; displayName: string };
  messages: ChatMessage[];
  window: { open: true; closesAt: string | null } | { open: false; closedAt: string | null };
  agentEnabled: boolean;
};

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Could not load. Check your connection.');
  return body;
}
