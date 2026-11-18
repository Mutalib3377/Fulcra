import * as Sentry from '@sentry/nextjs';
import { sentryDataCollection } from '@/lib/sentry-privacy';

/**
 * Error reports to Sentry from the server (pages, API routes, webhooks, Server Actions).
 * Does nothing without SENTRY_DSN, so local development is unchanged. No personal data is
 * sent (see sentry-privacy.ts), and no performance tracing.
 */
export function register() {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.RENDER_GIT_COMMIT,
    dataCollection: sentryDataCollection,
    tracesSampleRate: 0,
  });
}

export const onRequestError = Sentry.captureRequestError;
