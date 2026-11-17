'use client';

import { Button, SegmentedControl, Sheet, Switch } from '@fulcra/ui';
import { useState } from 'react';

/** The components that need a click to show what they do. */
export function InteractiveSamples() {
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [on, setOn] = useState(true);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <SegmentedControl
          label="Billing period"
          value={period}
          onValueChange={setPeriod}
          options={[
            { value: 'monthly', label: 'Monthly' },
            { value: 'yearly', label: 'Yearly' },
          ]}
        />
        <label className="flex items-center gap-3 text-[0.9375rem]">
          <Switch checked={on} onCheckedChange={setOn} aria-label="Assistant on" />
          Assistant {on ? 'on' : 'off'}
        </label>
      </div>
      <div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Open a sheet
        </Button>
      </div>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Cancel your plan?"
        description="Your plan keeps working until 16 December. You can choose a plan again any time."
      >
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button variant="danger" onClick={() => setOpen(false)}>
            Cancel plan
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Keep my plan
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
