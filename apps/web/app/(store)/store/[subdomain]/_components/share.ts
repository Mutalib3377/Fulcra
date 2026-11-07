import 'server-only';
import { storeUrl, type StoreInfo, type StoredImage } from '@fulcra/core';
import type { Metadata } from 'next';

/** Absolute URL of a JPEG copy of a stored image, for link previews. */
export function shareImageUrl(store: StoreInfo, image: StoredImage): string {
  return storeUrl(store.subdomain, `/api/share-image?path=${encodeURIComponent(image.path)}`);
}

/** Open Graph tags so shared links show a title, description and photo. */
export function shareMetadata(
  store: StoreInfo,
  page: { path: string; title: string; description: string; image: StoredImage | null },
): Metadata {
  const url = storeUrl(store.subdomain, page.path);
  const images = page.image
    ? [
        {
          url: shareImageUrl(store, page.image),
          width: page.image.width,
          height: page.image.height,
        },
      ]
    : undefined;
  return {
    description: page.description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      siteName: store.name,
      title: page.title,
      description: page.description,
      images,
    },
    twitter: { card: images ? 'summary_large_image' : 'summary', title: page.title, images },
  };
}
