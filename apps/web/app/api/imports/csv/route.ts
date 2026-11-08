import { isCoreError, MAX_CSV_BYTES, startCsvImport } from '@fulcra/core';
import { getActionContext } from '@/lib/auth';

/**
 * CSV upload for catalog import (multipart field "file"). A Route Handler because
 * Server Actions limit request bodies to 1 MB. Opens the review screen; nothing is saved
 * to the catalog until the seller confirms.
 */
export async function POST(request: Request) {
  const context = await getActionContext();
  if (!context) return Response.json({ error: 'Please sign in again.' }, { status: 401 });

  if (Number(request.headers.get('content-length') ?? 0) > MAX_CSV_BYTES + 64 * 1024) {
    return Response.json(
      { error: 'This file is too large. Split it into files under 2 MB.' },
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
    return Response.json({ error: 'Choose a CSV file to upload.' }, { status: 400 });
  }
  try {
    const created = await startCsvImport(context.actor, {
      fileName: file.name.slice(0, 200),
      text: await file.text(),
    });
    return Response.json({ importId: created.id }, { status: 201 });
  } catch (error) {
    if (isCoreError(error)) {
      return Response.json(
        { error: error.message },
        { status: error.code === 'forbidden' ? 403 : 400 },
      );
    }
    console.error('[imports] csv upload failed', error);
    return Response.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
  }
}
