'use client';

import type { StoredImage } from '@fulcra/core/rules';

export type UploadedImage = { image: StoredImage; urls: { sm: string; md: string; lg: string } };

const MAX_SIDE = 1600;

/**
 * Shrinks a photo in the browser before upload (phones take 4000px+ photos).
 * Saves the seller's data and time on slow networks. Falls back to the original file.
 */
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/** Uploads one photo. Throws an Error with a friendly message on failure. */
export async function uploadImage(file: File): Promise<UploadedImage> {
  const body = new FormData();
  body.append('file', await shrink(file), file.name.replace(/\.\w+$/, '') + '.jpg');
  let res: Response;
  try {
    res = await fetch('/api/uploads', { method: 'POST', body });
  } catch {
    throw new Error('No connection. Check your internet and try again.');
  }
  const data = (await res.json().catch(() => ({}))) as Partial<UploadedImage> & { error?: string };
  if (!res.ok || !data.image || !data.urls)
    throw new Error(data.error ?? 'Upload failed. Please try again.');
  return { image: data.image, urls: data.urls };
}
