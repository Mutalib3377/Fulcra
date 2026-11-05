'use client';

import { MAX_PRODUCT_PHOTOS } from '@fulcra/core/rules';
import { Button, FieldMessage, cn } from '@fulcra/ui';
import { ArrowLeft, ImagePlus, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { uploadImage, type UploadedImage } from '@/components/upload-image';

type Props = {
  value: UploadedImage[];
  onChange: (photos: UploadedImage[]) => void;
};

/** Pick, upload, reorder and remove product photos. The first photo is the main one. */
export function PhotoPicker({ value, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Uploads finish one by one; keep the latest list in a ref so none are lost.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const room = MAX_PRODUCT_PHOTOS - latest.current.length;
    const chosen = Array.from(files).slice(0, room);
    if (files.length > room) setError(`You can add up to ${MAX_PRODUCT_PHOTOS} photos.`);
    setUploading((n) => n + chosen.length);
    for (const file of chosen) {
      try {
        const uploaded = await uploadImage(file);
        onChange([...latest.current, uploaded]);
        latest.current = [...latest.current, uploaded];
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed. Please try again.');
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (input.current) input.current.value = '';
  };

  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));
  const moveLeft = (index: number) => {
    const next = [...value];
    [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {value.map((photo, index) => (
          <div
            key={photo.image.path}
            className="relative aspect-square overflow-hidden rounded-md border bg-muted"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- storage URLs, sizes pre-made */}
            <img src={photo.urls.sm} alt="" className="size-full object-cover" />
            {index === 0 && (
              <span className="absolute bottom-1 left-1 rounded bg-foreground/70 px-1.5 text-xs text-card">
                Main
              </span>
            )}
            <div className="absolute top-1 right-1 flex gap-1">
              {index > 0 && (
                <button
                  type="button"
                  onClick={() => moveLeft(index)}
                  aria-label="Move photo left"
                  className="rounded-full bg-card/90 p-1.5 shadow"
                >
                  <ArrowLeft className="size-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label="Remove photo"
                className="rounded-full bg-card/90 p-1.5 shadow"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        ))}
        {Array.from({ length: uploading }).map((_, i) => (
          <div
            key={`uploading-${i}`}
            className="flex aspect-square items-center justify-center rounded-md border bg-muted"
          >
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Uploading" />
          </div>
        ))}
        {value.length + uploading < MAX_PRODUCT_PHOTOS && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className={cn(
              'flex aspect-square flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-input text-sm text-muted-foreground hover:bg-muted',
            )}
          >
            <ImagePlus className="size-6" aria-hidden />
            Add photo
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => void add(e.target.files)}
      />
      {error ? (
        <FieldMessage error>{error}</FieldMessage>
      ) : (
        <FieldMessage>
          The first photo is shown first. Up to {MAX_PRODUCT_PHOTOS} photos.
        </FieldMessage>
      )}
      {value.length === 0 && uploading === 0 && (
        <Button
          type="button"
          variant="outline"
          className="sm:hidden"
          onClick={() => input.current?.click()}
        >
          <ImagePlus aria-hidden /> Take or choose photos
        </Button>
      )}
    </div>
  );
}
