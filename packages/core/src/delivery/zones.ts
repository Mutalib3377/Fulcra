import { schema, withTenant } from '@fulcra/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requireMember, type ActorContext } from '../members/access';
import { CoreError, isUniqueViolation } from '../shared/errors';

export const deliveryZoneInput = z.object({
  name: z.string().trim().min(2, 'Enter the area name, e.g. Lekki.').max(60),
  fee: z.number().int().min(0, 'Fee cannot be negative.').max(100_000_000),
  estimatedTime: z.string().trim().max(60).default(''),
  isActive: z.boolean().default(true),
});
export type DeliveryZoneInput = z.input<typeof deliveryZoneInput>;

const EDITORS = ['owner', 'staff'] as const;

function rethrow(error: unknown): never {
  if (isUniqueViolation(error, 'delivery_zones_name_unique')) {
    throw new CoreError('conflict', 'You already have an area with this name.', 'name');
  }
  throw error;
}

/** Delivery areas, in display order. Archived ones are never listed. */
export async function listDeliveryZones(
  actor: ActorContext,
  options: { activeOnly?: boolean } = {},
): Promise<schema.DeliveryZone[]> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    const z_ = schema.deliveryZones;
    return tx
      .select()
      .from(z_)
      .where(and(isNull(z_.archivedAt), options.activeOnly ? eq(z_.isActive, true) : undefined))
      .orderBy(asc(z_.position), asc(z_.name));
  });
}

export async function createDeliveryZone(
  actor: ActorContext,
  input: DeliveryZoneInput,
): Promise<schema.DeliveryZone> {
  const data = deliveryZoneInput.parse(input);
  try {
    return await withTenant(actor.businessId, async (tx) => {
      await requireMember(tx, actor, EDITORS);
      const [zone] = await tx
        .insert(schema.deliveryZones)
        .values({ businessId: actor.businessId, ...data })
        .returning();
      return zone!;
    });
  } catch (error) {
    rethrow(error);
  }
}

export async function updateDeliveryZone(
  actor: ActorContext,
  zoneId: string,
  input: DeliveryZoneInput,
): Promise<schema.DeliveryZone> {
  const id = z.uuid().parse(zoneId);
  const data = deliveryZoneInput.parse(input);
  try {
    return await withTenant(actor.businessId, async (tx) => {
      await requireMember(tx, actor, EDITORS);
      const [zone] = await tx
        .update(schema.deliveryZones)
        .set(data)
        .where(and(eq(schema.deliveryZones.id, id), isNull(schema.deliveryZones.archivedAt)))
        .returning();
      if (!zone) throw new CoreError('not_found', 'This delivery area no longer exists.');
      return zone;
    });
  } catch (error) {
    rethrow(error);
  }
}

/** Removes an area from the list. Past orders keep their copy of its name and fee. */
export async function archiveDeliveryZone(actor: ActorContext, zoneId: string): Promise<void> {
  const id = z.uuid().parse(zoneId);
  await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    await tx
      .update(schema.deliveryZones)
      .set({ archivedAt: new Date(), isActive: false })
      .where(eq(schema.deliveryZones.id, id));
  });
}
