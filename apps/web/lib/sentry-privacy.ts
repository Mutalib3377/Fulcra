/**
 * What Sentry may collect: nothing personal. Webhook bodies hold customer messages, phone
 * numbers and payment data, and some URLs carry one-time codes, so bodies, headers, cookies,
 * query strings, user info, queue payloads and local variables are all switched off.
 */
import type { init } from '@sentry/nextjs';

type DataCollection = NonNullable<NonNullable<Parameters<typeof init>[0]>['dataCollection']>;

export const sentryDataCollection: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  genAI: { inputs: false, outputs: false },
};
