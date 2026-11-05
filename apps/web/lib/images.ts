import 'server-only';
import { imageUrl, type StoredImage } from '@fulcra/core';

/** URLs for each stored size, passed from Server Components to the browser. */
export type ImageUrls = { sm: string; md: string; lg: string };

export type ImageWithUrls = { image: StoredImage; urls: ImageUrls };

export function imageUrls(image: StoredImage): ImageUrls {
  return { sm: imageUrl(image, 'sm'), md: imageUrl(image, 'md'), lg: imageUrl(image, 'lg') };
}

export function withUrls(image: StoredImage): ImageWithUrls {
  return { image, urls: imageUrls(image) };
}
