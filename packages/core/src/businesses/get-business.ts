import { schema, withTenant } from '@fulcra/db';
import { requireMember, type ActorContext } from '../members/access';
import { CoreError } from '../shared/errors';

/** The actor's current business. */
export async function getBusiness(actor: ActorContext): Promise<schema.Business> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    const [business] = await tx.select().from(schema.businesses).limit(1);
    if (!business) throw new CoreError('not_found', 'Business not found.');
    return business;
  });
}
