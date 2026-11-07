import { shareImageJpeg } from '@fulcra/core';

/**
 * JPEG copies of store photos for link previews (WhatsApp does not always show WebP).
 * Image paths never change, so the result is cached for a year by browsers and the CDN.
 */
export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get('path') ?? '';
  try {
    const jpeg = await shareImageJpeg(path);
    if (!jpeg) return new Response('Not found', { status: 404 });
    return new Response(jpeg as BodyInit, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('[share-image] could not make preview', error);
    return new Response('Could not load image', { status: 502 });
  }
}
