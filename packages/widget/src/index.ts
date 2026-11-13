/**
 * @fulcra/widget — the website chat bubble. One small script, loaded with `async`:
 *   <script async src="https://app.yourdomain.com/widget.js" data-fulcra="wk_..."></script>
 * Everything lives in a shadow root (no styles leak in or out) and every step is guarded,
 * so a problem here never breaks the seller's site. See docs/decisions/0017.
 */
import { linkify, randomId, shortTime, textOn } from './text';

type Config = { businessName: string; colour: string; logoUrl: string | null; greeting: string };
type Message = {
  id: string;
  from: 'visitor' | 'shop';
  text: string;
  imageUrl: string | null;
  createdAt: string;
  clientId: string | null;
};
type Pending = { clientId: string; text: string; failed: boolean };

declare global {
  interface Window {
    FulcraChat?: { open(): void; close(): void };
  }
}

const OPEN_POLL_MS = 3_000;
const CLOSED_POLL_MS = 30_000;

function storage(key: string) {
  const get = (name: string) => {
    try {
      return window.localStorage.getItem(`fulcra:${key}:${name}`);
    } catch {
      return null;
    }
  };
  const set = (name: string, value: string) => {
    try {
      window.localStorage.setItem(`fulcra:${key}:${name}`, value);
    } catch {
      // Private browsing: the chat still works for this visit.
    }
  };
  return { get, set };
}

const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.launcher{position:fixed;right:16px;bottom:16px;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;background:var(--c);color:var(--t);box-shadow:0 4px 14px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;z-index:2147483000}
.launcher svg{width:26px;height:26px}
.badge{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;border-radius:10px;background:#e11d48;color:#fff;font-size:12px;line-height:20px;text-align:center;padding:0 5px}
.panel{position:fixed;right:16px;bottom:84px;width:360px;max-width:calc(100vw - 32px);height:540px;max-height:calc(100vh - 110px);background:#fff;color:#111;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden;z-index:2147483000}
.panel[hidden]{display:none}
header{background:var(--c);color:var(--t);padding:12px 14px;display:flex;align-items:center;gap:10px}
header img{width:32px;height:32px;border-radius:50%;object-fit:cover;background:#fff}
header .name{font-weight:600;font-size:15px;flex:1}
header button{background:transparent;border:0;color:inherit;font-size:22px;cursor:pointer;line-height:1;padding:4px}
.list{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f6f7f8}
.msg{max-width:82%;padding:8px 11px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}
.msg.shop{background:#fff;align-self:flex-start;border-bottom-left-radius:4px}
.msg.visitor{background:var(--c);color:var(--t);align-self:flex-end;border-bottom-right-radius:4px}
.msg a{color:inherit;text-decoration:underline}
.msg img{display:block;max-width:100%;border-radius:8px;margin-bottom:4px}
.time{display:block;font-size:11px;opacity:.65;margin-top:3px;text-align:right}
.failed{font-size:12px;color:#e11d48;align-self:flex-end;background:none;border:0;cursor:pointer;padding:0}
.typing{align-self:flex-start;font-size:13px;color:#666;padding:2px 4px}
form{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff}
textarea{flex:1;resize:none;border:1px solid #d1d5db;border-radius:10px;padding:9px 10px;font-size:16px;max-height:96px;outline-color:var(--c)}
form button{border:0;border-radius:10px;padding:0 14px;background:var(--c);color:var(--t);font-weight:600;cursor:pointer}
form button:disabled{opacity:.5}
.foot{font-size:11px;color:#888;text-align:center;padding:0 0 8px;background:#fff}
@media (max-width:480px){.panel{right:0;bottom:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0}.launcher[aria-expanded="true"]{display:none}}
@media (prefers-reduced-motion:no-preference){.panel{animation:in .15s ease-out}@keyframes in{from{opacity:0;transform:translateY(8px)}}}
`;

const CHAT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

async function start(script: HTMLScriptElement): Promise<void> {
  const key = script.dataset.fulcra ?? '';
  if (!/^wk_[A-Za-z0-9]{24}$/.test(key)) return;
  const api = new URL(script.src).origin;
  const res = await fetch(`${api}/api/widget/config?key=${key}`, { mode: 'cors' });
  if (!res.ok) return;
  const config = (await res.json()) as Config;

  const store = storage(key);
  let visitorId = store.get('visitor');
  if (!visitorId) {
    visitorId = `v_${randomId(32)}`;
    store.set('visitor', visitorId);
  }
  const vid = visitorId;

  const host = el('div', { id: 'fulcra-chat' });
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const style = el('style', {}, CSS);
  root.appendChild(style);
  host.style.setProperty('--c', config.colour);
  host.style.setProperty('--t', textOn(config.colour));

  const launcher = el('button', {
    class: 'launcher',
    'aria-label': `Chat with ${config.businessName}`,
  });
  launcher.innerHTML = CHAT_ICON; // static icon, no visitor data
  const badge = el('span', { class: 'badge', hidden: '' });
  launcher.appendChild(badge);

  const panel = el('div', {
    class: 'panel',
    role: 'dialog',
    'aria-label': `Chat with ${config.businessName}`,
    hidden: '',
  });
  const header = el('header');
  if (config.logoUrl) header.appendChild(el('img', { src: config.logoUrl, alt: '' }));
  header.appendChild(el('div', { class: 'name' }, config.businessName));
  const close = el('button', { 'aria-label': 'Close chat' }, '×');
  header.appendChild(close);
  const list = el('div', { class: 'list', 'aria-live': 'polite' });
  const form = el('form');
  const input = el('textarea', {
    rows: '1',
    placeholder: 'Type a message…',
    'aria-label': 'Your message',
    maxlength: '2000',
  });
  const send = el('button', { type: 'submit' }, 'Send');
  form.append(input, send);
  const foot = el('div', { class: 'foot' }, 'Powered by Fulcra');
  panel.append(header, list, form, foot);
  root.append(panel, launcher);

  const messages: Message[] = [];
  const pending: Pending[] = [];
  let replying = false;
  let cursor: string | null = null;
  let open = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSeen = store.get('seen') ?? '';

  const bubble = (
    from: 'visitor' | 'shop',
    text: string,
    time?: string,
    imageUrl?: string | null,
  ) => {
    const node = el('div', { class: `msg ${from}` });
    if (imageUrl) node.appendChild(el('img', { src: imageUrl, alt: 'Photo' }));
    for (const part of linkify(text)) {
      node.appendChild(
        part.href
          ? Object.assign(
              el('a', { href: part.href, target: '_blank', rel: 'noopener noreferrer' }),
              {
                textContent: part.text,
              },
            )
          : document.createTextNode(part.text),
      );
    }
    if (time) node.appendChild(el('span', { class: 'time' }, time));
    return node;
  };

  const render = () => {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.replaceChildren();
    list.appendChild(bubble('shop', config.greeting));
    for (const m of messages)
      list.appendChild(bubble(m.from, m.text, shortTime(m.createdAt), m.imageUrl));
    for (const p of pending) {
      list.appendChild(bubble('visitor', p.text, p.failed ? undefined : 'Sending…'));
      if (p.failed) {
        const retry = el('button', { class: 'failed' }, 'Not sent. Tap to try again');
        retry.addEventListener('click', () => void deliver(p));
        list.appendChild(retry);
      }
    }
    if (replying) list.appendChild(el('div', { class: 'typing' }, 'Typing…'));
    if (atBottom || open) list.scrollTop = list.scrollHeight;
  };

  const updateBadge = () => {
    const unread = open
      ? 0
      : messages.filter((m) => m.from === 'shop' && m.createdAt > lastSeen).length;
    badge.textContent = String(unread);
    if (unread > 0) badge.removeAttribute('hidden');
    else badge.setAttribute('hidden', '');
  };

  const poll = async () => {
    clearTimeout(timer);
    try {
      const q = new URLSearchParams({
        key,
        visitorId: vid,
        ...(cursor ? { after: cursor } : {}),
        ...(open ? { seen: '1' } : {}),
      });
      const res = await fetch(`${api}/api/widget/messages?${q.toString()}`, { mode: 'cors' });
      if (res.ok) {
        const data = (await res.json()) as { messages: Message[]; replying: boolean };
        if (data.messages.length) {
          const known = new Set(messages.map((m) => m.id));
          for (const m of data.messages) {
            if (known.has(m.id)) continue;
            messages.push(m);
            const i = pending.findIndex((p) => p.clientId === m.clientId);
            if (i >= 0) pending.splice(i, 1);
          }
          cursor = messages.at(-1)!.createdAt;
          if (messages.length) store.set('history', '1');
        }
        replying = data.replying;
        if (open && messages.length) {
          lastSeen = messages.at(-1)!.createdAt;
          store.set('seen', lastSeen);
        }
        render();
        updateBadge();
      }
    } catch {
      // Offline: try again on the next tick.
    }
    if (open || store.get('history'))
      timer = setTimeout(() => void poll(), open ? OPEN_POLL_MS : CLOSED_POLL_MS);
  };

  const deliver = async (p: Pending) => {
    p.failed = false;
    render();
    try {
      const res = await fetch(`${api}/api/widget/messages`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, visitorId: vid, messageId: p.clientId, text: p.text }),
      });
      if (!res.ok) throw new Error(String(res.status));
      store.set('history', '1');
      replying = true;
      setTimeout(() => void poll(), 1500);
    } catch {
      p.failed = true;
    }
    render();
  };

  const setOpen = (next: boolean) => {
    open = next;
    if (open) {
      panel.removeAttribute('hidden');
      launcher.setAttribute('aria-expanded', 'true');
      render();
      void poll();
      setTimeout(() => input.focus(), 50);
    } else {
      panel.setAttribute('hidden', '');
      launcher.setAttribute('aria-expanded', 'false');
      void poll();
    }
    updateBadge();
  };

  launcher.addEventListener('click', () => setOpen(!open));
  close.addEventListener('click', () => setOpen(false));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const p: Pending = { clientId: randomId(24), text: text.slice(0, 2000), failed: false };
    pending.push(p);
    void deliver(p);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  // "Chat to buy" buttons anywhere on the page.
  document.addEventListener('click', (e) => {
    const target = (e.target as Element | null)?.closest?.('[data-fulcra-open]');
    if (target) {
      e.preventDefault();
      setOpen(true);
    }
  });
  window.FulcraChat = { open: () => setOpen(true), close: () => setOpen(false) };
  if (store.get('history')) void poll();
}

(() => {
  try {
    const script =
      (document.currentScript as HTMLScriptElement | null) ??
      document.querySelector<HTMLScriptElement>('script[data-fulcra]');
    if (!script) return;
    const run = () => void start(script).catch(() => undefined);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  } catch {
    // Never break the seller's site.
  }
})();
