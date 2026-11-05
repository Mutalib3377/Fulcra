import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { isOwnImagePath, processImage } from './images';

async function makePhoto(width: number, height: number, format: 'jpeg' | 'png' = 'jpeg') {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: '#c0392b' } })
      .toFormat(format)
      .toBuffer(),
  );
}

describe('processImage', () => {
  it('makes three WebP sizes without upscaling', async () => {
    const result = await processImage(await makePhoto(3000, 2000));
    expect(result.width).toBe(1200);
    expect(result.height).toBe(800);
    for (const [size, max] of [
      ['sm', 200],
      ['md', 600],
      ['lg', 1200],
    ] as const) {
      const meta = await sharp(result.files[size]).metadata();
      expect(meta.format).toBe('webp');
      expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(max);
    }

    const small = await processImage(await makePhoto(400, 300, 'png'));
    expect([small.width, small.height]).toEqual([400, 300]);
  });

  it('rejects files that are not photos', async () => {
    await expect(processImage(new TextEncoder().encode('not an image'))).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(processImage(new Uint8Array())).rejects.toMatchObject({ code: 'validation' });
  });
});

describe('isOwnImagePath', () => {
  const business = '11111111-1111-4111-8111-111111111111';
  it('only accepts paths inside the business folder', () => {
    expect(isOwnImagePath(business, `${business}/22222222-2222-4222-8222-222222222222`)).toBe(true);
    expect(
      isOwnImagePath(
        business,
        `33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222`,
      ),
    ).toBe(false);
    expect(isOwnImagePath(business, `${business}/../other`)).toBe(false);
  });
});
