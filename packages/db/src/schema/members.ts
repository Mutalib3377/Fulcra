import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { appRole, currentBusinessId, id, timestamps } from './_shared';
import { businesses } from './businesses';

export const memberRoles = ['owner', 'staff', 'rider'] as const;
export const memberRole = pgEnum('member_role', memberRoles);

/** A user's role in a business. `user_id` is the Supabase Auth user id. */
export const members = pgTable(
  'members',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    email: text('email').notNull(),
    role: memberRole('role').notNull(),
    ...timestamps,
  },
  (t) => [
    unique('members_business_user_unique').on(t.businessId, t.userId),
    index('members_user_id_idx').on(t.userId),
    pgPolicy('members_tenant_isolation', {
      for: 'all',
      to: appRole,
      using: sql`${t.businessId} = ${currentBusinessId}`,
      withCheck: sql`${t.businessId} = ${currentBusinessId}`,
    }),
  ],
).enableRLS();

/** A pending invitation for someone to join a business. Shared as a link. */
export const memberInvites = pgTable(
  'member_invites',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    /** Lowercased. Only this email can accept the invite. */
    email: text('email').notNull(),
    role: memberRole('role').notNull(),
    /** SHA-256 of the secret token in the invite link. The token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('member_invites_business_id_idx').on(t.businessId),
    check('member_invites_not_owner', sql`${t.role} <> 'owner'`),
    pgPolicy('member_invites_tenant_isolation', {
      for: 'all',
      to: appRole,
      using: sql`${t.businessId} = ${currentBusinessId}`,
      withCheck: sql`${t.businessId} = ${currentBusinessId}`,
    }),
  ],
).enableRLS();

export type Member = typeof members.$inferSelect;
export type MemberRole = (typeof memberRoles)[number];
export type MemberInvite = typeof memberInvites.$inferSelect;
