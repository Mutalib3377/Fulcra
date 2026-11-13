/** Browser-safe rules for the website chat widget (W1). */

/** A visitor id made by the widget: random, kept in the visitor's browser. */
export const VISITOR_ID = /^[A-Za-z0-9_-]{16,64}$/;

/** The public widget key on the seller's website: "wk_" + 24 letters/digits. */
export const WIDGET_KEY = /^wk_[A-Za-z0-9]{24}$/;

/**
 * Which websites may use a business's widget key. Without a saved website, any site may (the
 * key is public anyway; message limits protect against abuse). With one, only that site
 * (and its subdomains), the business's Fulcra store, and local development.
 */
export function isAllowedWidgetOrigin(
  origin: string | null,
  allowed: { websiteHost: string | null; storeHost: string; allowLocal: boolean },
): boolean {
  if (!allowed.websiteHost) return true;
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  const site = allowed.websiteHost.toLowerCase().replace(/^www\./, '');
  if (host === site || host.endsWith(`.${site}`)) return true;
  if (host === allowed.storeHost.toLowerCase().split(':')[0]) return true;
  return (
    allowed.allowLocal &&
    (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1')
  );
}

/** The one-line install code for a seller's website. */
export function widgetScriptTag(scriptUrl: string, key: string): string {
  return `<script async src="${scriptUrl}" data-fulcra="${key}"></script>`;
}
