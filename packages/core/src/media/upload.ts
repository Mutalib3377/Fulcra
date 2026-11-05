import { withTenant } from '@fulcra/db';
import { requireMember, type ActorContext } from '../members/access';
import { storeImage, type StoredImage } from './images';

/**
 * Uploads a photo (product photo or logo) for the actor's business.
 * Owner or staff only. Returns the reference to save on the product or brand kit.
 */
export async function uploadImage(actor: ActorContext, file: Uint8Array): Promise<StoredImage> {
  await withTenant(actor.businessId, (tx) => requireMember(tx, actor, ['owner', 'staff']));
  return storeImage(actor.businessId, file);
}
