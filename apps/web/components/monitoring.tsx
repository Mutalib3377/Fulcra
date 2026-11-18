'use client';

import { useEffect } from 'react';
import { sentryDataCollection } from '@/lib/sentry-privacy';

type Props = { area: 'dashboard'; userId: string; businessId: string } | { area: 'marketing' };

/**
 * Browser-side error reports (Sentry, dashboard only) and analytics (PostHog). Both load after
 * the page is idle and only when their keys are set, so they never slow the first view.
 * Never loaded on sellers' stores. Marketing visitors get no cookies (memory only); signed-in
 * owners are known by their user id only, never their email.
 */
export function Monitoring(props: Props) {
  const userId = props.area === 'dashboard' ? props.userId : undefined;
  const businessId = props.area === 'dashboard' ? props.businessId : undefined;

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
      if (sentryDsn && props.area === 'dashboard') {
        const Sentry = await import('@sentry/nextjs');
        if (cancelled) return;
        Sentry.init({
          dsn: sentryDsn,
          environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
          dataCollection: sentryDataCollection,
          tracesSampleRate: 0,
        });
        if (userId) Sentry.setUser({ id: userId });
      }

      const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
      if (posthogKey) {
        const { default: posthog } = await import('posthog-js');
        if (cancelled) return;
        if (!posthog.__loaded) {
          posthog.init(posthogKey, {
            api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
            capture_pageview: 'history_change',
            person_profiles: 'identified_only',
            persistence: props.area === 'marketing' ? 'memory' : 'localStorage',
            autocapture: false,
            disable_session_recording: true,
          });
        }
        if (userId) posthog.identify(userId, { business_id: businessId });
      }
    };
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    const timer = idle ? idle(() => void start()) : window.setTimeout(() => void start(), 1500);
    return () => {
      cancelled = true;
      if (!idle) window.clearTimeout(timer);
    };
  }, [props.area, userId, businessId]);

  return null;
}
