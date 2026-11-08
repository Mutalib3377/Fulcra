'use client';

import { Button, FieldMessage } from '@fulcra/ui';
import { FileUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { goTo } from '@/lib/navigation';

const MAX_BYTES = 2 * 1024 * 1024;

/** Picks a CSV file and sends it; the review screen opens when it has been read. */
export function CsvUpload() {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError('This file is too large. Split it into files under 2 MB.');
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.set('file', file);
      const response = await fetch('/api/imports/csv', { method: 'POST', body });
      const result = (await response.json().catch(() => ({}))) as {
        importId?: string;
        error?: string;
      };
      if (!response.ok || !result.importId) {
        setError(result.error ?? 'Upload failed. Please try again.');
        return;
      }
      goTo(`/catalog/import/${result.importId}`);
    } catch {
      setError('The upload did not finish. Check your connection and try again.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-label="CSV file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button
        type="button"
        loading={busy}
        onClick={() => input.current?.click()}
        className="self-start"
      >
        <FileUp aria-hidden /> {busy ? 'Reading your file…' : 'Choose CSV file'}
      </Button>
      {error && <FieldMessage role="alert">{error}</FieldMessage>}
    </div>
  );
}
