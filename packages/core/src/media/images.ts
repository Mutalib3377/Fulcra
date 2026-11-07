import { randomUUID } from 'node:crypto';
import type { schema } from '@fulcra/db';
import sharp, { type Metadata } from 'sharp';
import { CoreError } from '../shared/errors';
import { deleteFiles, publicFileUrl, putFile } from './storage';

export type StoredImage = schema.StoredImage;

/** Stored versions of every image, by longest side in pixels. */
export const IMAGE_SIZES = { sm: 200, md: 600, lg: 1200 } as const;
export type ImageSize = keyof typeof IMAGE_SIZES;

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif', 'gif']);

export type ProcessedImage = {
  width: number;
  height: number;
  files: Record<ImageSize, Uint8Array>;
};

/**
 * Turns an uploaded photo into small/medium/large WebP files.
 * Fixes phone rotation, strips metadata (e.g. GPS location) and never upscales.
 */
export async function processImage(input: Uint8Array): Promise<ProcessedImage> {
  if (input.byteLength === 0) throw new CoreError('validation', 'The file is empty.');
  if (input.byteLength > MAX_IMAGE_BYTES) {
    throw new CoreError('validation', 'This photo is too large. Please use one under 10 MB.');
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input, { limitInputPixels: 50_000_000 }).metadata();
  } catch {
    throw new CoreError(
      'validation',
      'This file is not a photo we can read. Use a JPG, PNG or WebP.',
    );
  }
  if (!metadata.format || !ACCEPTED_FORMATS.has(metadata.format)) {
    throw new CoreError('validation', 'Please upload a JPG, PNG or WebP photo.');
  }

  const files = {} as Record<ImageSize, Uint8Array>;
  let width = 0;
  let height = 0;
  for (const [size, max] of Object.entries(IMAGE_SIZES) as [ImageSize, number][]) {
    const { data, info } = await sharp(input, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: size === 'sm' ? 70 : 78 })
      .toBuffer({ resolveWithObject: true });
    files[size] = new Uint8Array(data);
    if (size === 'lg') {
      width = info.width;
      height = info.height;
    }
  }
  return { width, height, files };
}

export function imageFileKey(image: Pick<StoredImage, 'path'>, size: ImageSize): string {
  return `${image.path}/${size}.webp`;
}

/** Public URL of one size of a stored image. */
export function imageUrl(image: Pick<StoredImage, 'path'>, size: ImageSize = 'md'): string {
  return publicFileUrl(imageFileKey(image, size));
}

/** Processes and stores an image for a business. Returns what to save in the database. */
export async function storeImage(businessId: string, input: Uint8Array): Promise<StoredImage> {
  const processed = await processImage(input);
  const image: StoredImage = {
    path: `${businessId}/${randomUUID()}`,
    width: processed.width,
    height: processed.height,
  };
  await Promise.all(
    (Object.keys(processed.files) as ImageSize[]).map((size) =>
      putFile(imageFileKey(image, size), processed.files[size], 'image/webp'),
    ),
  );
  return image;
}

/** Removes all stored sizes of images (best effort; never blocks the user). */
export async function deleteImages(images: Pick<StoredImage, 'path'>[]): Promise<void> {
  const keys = images.flatMap((image) =>
    (Object.keys(IMAGE_SIZES) as ImageSize[]).map((size) => imageFileKey(image, size)),
  );
  try {
    await deleteFiles(keys);
  } catch (error) {
    console.warn('[media] could not delete images', error);
  }
}

/** True if the path belongs to this business (prevents saving another business's image). */
export function isOwnImagePath(businessId: string, path: string): boolean {
  return new RegExp(`^${businessId}/[0-9a-f-]{36}$`).test(path);
}

const STORED_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

/**
 * A JPEG copy of a stored image for link previews (WhatsApp and others do not always show
 * WebP). Returns null when the path is not one of our image paths or the file is missing.
 */
export async function shareImageJpeg(path: string): Promise<Uint8Array | null> {
  if (!STORED_PATH.test(path)) return null;
  const response = await fetch(imageUrl({ path }, 'lg'));
  if (!response.ok) return null;
  const input = new Uint8Array(await response.arrayBuffer());
  const output = await sharp(input, { limitInputPixels: 50_000_000 })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  return new Uint8Array(output);
}
