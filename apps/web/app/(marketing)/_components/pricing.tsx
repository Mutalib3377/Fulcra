'use client';

import { formatNaira } from '@fulcra/config';
import { Button, SegmentedControl, cn } from '@fulcra/ui';
import { Check } from 'lucide-react';
import { useState } from 'react';

type Period = 'monthly' | 'yearly';
type PlanCode = 'starter' | 'growth' | 'pro';

/** What the page needs from each plan (passed from the server, so no rules code ships). */
export type PricingPlan = {
  code: PlanCode;
  name: string;
  summary: string;
  monthlyPrice: number;
  annualPrice: number;
  conversationsPerMonth: number;
};

const highlights: Record<PlanCode, string[]> = {
  starter: [
    'Your store or website chat',
    'Payment links and bank transfers',
    'One channel: WhatsApp, Instagram or website',
  ],
  growth: [
    'WhatsApp, Instagram and website together',
    'WhatsApp alerts and daily briefing',
    'Import from Shopify and WooCommerce',
  ],
  pro: ['Everything in Growth', 'Three times the conversations', 'New modules as they launch'],
};

/** The three plans, read from the same PLANS the billing page uses. */
export function Pricing({ plans, signUpUrl }: { plans: PricingPlan[]; signUpUrl: string }) {
  const [period, setPeriod] = useState<Period>('monthly');
  return (
    <div className="flex flex-col items-center gap-10">
      <SegmentedControl
        label="Billing period"
        value={period}
        onValueChange={setPeriod}
        options={[
          { value: 'monthly', label: 'Monthly' },
          { value: 'yearly', label: 'Yearly · 2 months free' },
        ]}
      />
      <div className="grid w-full gap-4 md:grid-cols-3" data-reveal>
        {plans.map((plan) => {
          const code = plan.code;
          const featured = code === 'growth';
          const price = period === 'monthly' ? plan.monthlyPrice : plan.annualPrice;
          return (
            <div
              key={code}
              data-reveal-item
              className={cn(
                'relative flex flex-col gap-6 rounded-2xl border p-7',
                featured
                  ? 'border-transparent bg-[#06140f] text-white shadow-overlay'
                  : 'bg-card shadow-card',
              )}
            >
              {featured && (
                <span className="absolute top-7 right-7 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-[#8ff0c5]">
                  Most popular
                </span>
              )}
              <div className="flex flex-col gap-1">
                <h3 className="text-xl font-semibold">{plan.name}</h3>
                <p className={cn('text-sm', featured ? 'text-white/65' : 'text-muted-foreground')}>
                  {plan.summary}
                </p>
              </div>
              <p className="flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold tabular-nums">
                  {formatNaira(price).replace(/\.00$/, '')}
                </span>
                <span className={featured ? 'text-white/60' : 'text-muted-foreground'}>
                  / {period === 'monthly' ? 'month' : 'year'}
                </span>
              </p>
              <ul className="flex flex-1 flex-col gap-3 text-[0.9375rem]">
                <li className="flex gap-3">
                  <Check
                    className={cn(
                      'mt-0.5 size-4 shrink-0',
                      featured ? 'text-[#8ff0c5]' : 'text-primary',
                    )}
                    aria-hidden
                  />
                  {plan.conversationsPerMonth.toLocaleString('en-NG')} customer chats a month
                </li>
                {highlights[code].map((item) => (
                  <li key={item} className="flex gap-3">
                    <Check
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        featured ? 'text-[#8ff0c5]' : 'text-primary',
                      )}
                      aria-hidden
                    />
                    {item}
                  </li>
                ))}
              </ul>
              <Button
                asChild
                size="lg"
                variant={featured ? 'primary' : 'secondary'}
                className={featured ? 'bg-[#2fd08f] text-[#04140d] hover:bg-[#4cdba0]' : ''}
              >
                <a href={signUpUrl}>Start free trial</a>
              </Button>
            </div>
          );
        })}
      </div>
      <p className="text-center text-sm text-muted-foreground">
        Every plan starts with 14 days of Growth, free. No card needed. Prices in naira; cancel any
        time.
      </p>
    </div>
  );
}
