import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Request counters for public endpoints (e.g. the website chat), shared by every web instance.
 * Not business data: no business_id. RLS is on with no policy, so only `withSystem` can use it.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    /** What is being limited, e.g. "widget:ip:1.2.3.4". */
    key: text('key').primaryKey(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
    count: integer('count').notNull().default(0),
  },
  (t) => [index('rate_limits_window_start_idx').on(t.windowStart)],
).enableRLS();
