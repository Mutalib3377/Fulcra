import type { schema } from '@fulcra/db';
import { MAX_IMAGE_BYTES, storeImage } from '../media/images';
import { safeFetch } from '../shared/safe-fetch';

/**
 * Downloads a product's photos from their links and stores them like normal uploads
 * (resized, metadata removed). A photo that fails is skipped; the product still saves.
 */
export async function importPhotos(
  businessId: string,
  urls: string[],
): Promise<{ photos: schema.StoredImage[]; failed: number }> {
  const photos: schema.StoredImage[] = [];
  let failed = 0;
  for (const url of urls) {
    try {
      const { body } = await safeFetch(url, {
        maxBytes: MAX_IMAGE_BYTES,
        timeoutMs: 20_000,
        accept: 'image/*',
      });
      photos.push(await storeImage(businessId, body));
    } catch {
      failed++;
    }
  }
  return { photos, failed };
}
