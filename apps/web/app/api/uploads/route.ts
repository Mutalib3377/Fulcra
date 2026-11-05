import { isCoreError, MAX_IMAGE_BYTES, uploadImage } from '@fulcra/core';
import { getActionContext } from '@/lib/auth';
import { withUrls } from '@/lib/images';

/**
 * Photo upload for product photos and logos (multipart field "file").
 * Uses a Route Handler because Server Actions limit request bodies to 1 MB.
 */
export async function POST(request: Request) {
  const context = await getActionContext();
  if (!context) return Response.json({ error: 'Please sign in again.' }, { status: 401 });

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_IMAGE_BYTES + 64 * 1024) {
    return Response.json(
      { error: 'This photo is too large. Please use one under 10 MB.' },
      { status: 413 },
    );
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get('file');
  } catch {
    return Response.json(
      { error: 'The upload did not finish. Please try again.' },
      { status: 400 },
    );
  }
  if (!(file instanceof File)) {
    return Response.json({ error: 'Choose a photo to upload.' }, { status: 400 });
  }

  try {
    const image = await uploadImage(context.actor, new Uint8Array(await file.arrayBuffer()));
    return Response.json(withUrls(image), { status: 201 });
  } catch (error) {
    if (isCoreError(error)) {
      return Response.json(
        { error: error.message },
        { status: error.code === 'forbidden' ? 403 : 400 },
      );
    }
    console.error('[uploads] failed', error);
    return Response.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
  }
}
