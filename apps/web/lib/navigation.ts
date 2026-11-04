/**
 * Full page navigation after a Server Action (sign-in, sign-out, switching business...).
 *
 * Server Actions must not call `redirect()` in this app: Next.js renders the redirect
 * target on the server without going through proxy.ts, so `/` would render the
 * marketing page instead of the dashboard. A normal navigation goes through the proxy,
 * and a full load also clears any client state from the previous session or business.
 */
export function goTo(path: string): void {
  window.location.assign(path);
}
