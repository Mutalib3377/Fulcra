import * as Sentry from '@sentry/node';

/**
 * Error reports to Sentry from the worker. Does nothing without SENTRY_DSN. Job payloads hold
 * customer messages and payment data, so no request, queue or variable data is collected.
 */
export function initMonitoring(): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.RENDER_GIT_COMMIT,
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
    },
  });
}

/** Reports a failed job (with its queue name only) before pg-boss retries it. */
export function reportJobError(job: string, error: unknown): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(error, { tags: { job } });
}

/** Wraps a job handler so failures reach Sentry; the error is re-thrown for pg-boss. */
export function reported<T extends unknown[], R>(
  job: string,
  handler: (...args: T) => Promise<R>,
): (...args: T) => Promise<R> {
  return async (...args: T) => {
    try {
      return await handler(...args);
    } catch (error) {
      reportJobError(job, error);
      throw error;
    }
  };
}
