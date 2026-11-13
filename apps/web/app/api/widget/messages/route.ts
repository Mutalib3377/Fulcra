import { getWidgetMessages, sendWidgetMessage, widgetMessageInput } from '@fulcra/core';
import { allow, clientIp } from '@/lib/rate-limit';
import { corsHeaders, json, widgetConfig } from '@/lib/widget';

/**
 * The website chat: visitors send messages and fetch replies. Public, so every call checks
 * the key and the website, and is rate limited (AI replies cost money).
 */

async function cors(request: Request, key: string) {
  return corsHeaders(request.headers.get('origin'), await widgetConfig(key));
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  // The key is not sent with a preflight: allow it, the real call is checked.
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin ?? '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
      vary: 'Origin',
    },
  });
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const key = query.get('key') ?? '';
  const headers = await cors(request, key);
  if (!headers) return json({ error: 'Not available' }, 404);
  if (!allow(`widget-get:${clientIp(request)}`, 120, 60_000))
    return json({ error: 'Too many requests' }, 429, headers);
  try {
    const result = await getWidgetMessages(key, {
      visitorId: query.get('visitorId') ?? '',
      after: query.get('after'),
      seen: query.get('seen') === '1',
    });
    return result ? json(result, 200, headers) : json({ error: 'Not available' }, 404, headers);
  } catch {
    return json({ error: 'Bad request' }, 400, headers);
  }
}

export async function POST(request: Request) {
  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const key = typeof raw?.key === 'string' ? raw.key : '';
  const headers = await cors(request, key);
  if (!headers) return json({ error: 'Not available' }, 404);
  const parsed = widgetMessageInput.safeParse(raw);
  if (!parsed.success)
    return json({ error: parsed.error.issues[0]?.message ?? 'Bad request' }, 400, headers);
  // Limits: a visitor can't flood the chat, nor one address many chats.
  if (
    !allow(`widget-visitor:${parsed.data.visitorId}`, 15, 60_000) ||
    !allow(`widget-ip:${clientIp(request)}`, 40, 60_000)
  )
    return json(
      { error: 'You are sending messages too fast. Please wait a moment.' },
      429,
      headers,
    );
  const ok = await sendWidgetMessage(key, parsed.data);
  return ok ? json({ ok: true }, 202, headers) : json({ error: 'Not available' }, 404, headers);
}
