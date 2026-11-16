import type { HomeSummary } from '@fulcra/core';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@fulcra/ui';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { setupStepText } from '@/lib/setup';
import { hideSetupAction } from './home-actions';

type Props = {
  setup: NonNullable<HomeSummary['setup']>;
  hasExternalWebsite: boolean;
};

/** "Get set up" card on the dashboard home. Steps tick themselves from the business's data. */
export function SetupChecklist({ setup, hasExternalWebsite }: Props) {
  const next = setup.steps.find((s) => !s.done)?.key;
  const percent = Math.round((setup.done / setup.total) * 100);
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Get set up</CardTitle>
            <CardDescription>
              {setup.done} of {setup.total} done. Finish these and the assistant can sell for you.
            </CardDescription>
          </div>
          <form action={hideSetupAction}>
            <Button type="submit" variant="ghost" size="sm" className="shrink-0">
              Hide
            </Button>
          </form>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col divide-y">
          {setup.steps.map((step) => {
            const text = setupStepText(step.key, hasExternalWebsite);
            const isNext = step.key === next;
            return (
              <li key={step.key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span
                  className={
                    step.done
                      ? 'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground'
                      : 'mt-0.5 size-6 shrink-0 rounded-full border-2 border-muted-foreground/40'
                  }
                  aria-hidden
                >
                  {step.done && <Check className="size-4" />}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className={step.done ? 'font-medium text-muted-foreground' : 'font-medium'}>
                    {text.title}
                    <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
                  </p>
                  {!step.done && (
                    <p className="text-sm text-muted-foreground">{text.description}</p>
                  )}
                  {!step.done && (
                    <Button
                      asChild
                      size="sm"
                      variant={isNext ? 'primary' : 'outline'}
                      className="mt-1 self-start"
                    >
                      <Link href={text.href}>{text.action}</Link>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
