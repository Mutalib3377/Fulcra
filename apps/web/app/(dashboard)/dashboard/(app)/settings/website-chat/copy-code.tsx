'use client';

import { Button } from '@fulcra/ui';
import { useState } from 'react';

/** The install code with a Copy button. */
export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs break-all whitespace-pre-wrap">
        <code>{code}</code>
      </pre>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        aria-label="Copy the code"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? 'Copied' : 'Copy code'}
      </Button>
    </div>
  );
}
