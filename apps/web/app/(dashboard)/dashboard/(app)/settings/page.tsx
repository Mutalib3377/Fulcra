import { getBusiness } from '@fulcra/core';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fulcra/ui';
import { ChevronRight, Palette, Plus, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionButton } from '@/components/action-button';
import { getDashboardContext } from '@/lib/auth';
import { storeHost } from '@/lib/urls';
import { switchBusinessAction } from './actions';

export const metadata: Metadata = { title: 'Settings' };

const categoryLabels = {
  fashion: 'Fashion & clothing',
  beauty: 'Beauty & skincare',
  food: 'Food & drinks',
  gadgets: 'Phones & gadgets',
  other: 'Something else',
} as const;

export default async function SettingsPage() {
  const { actor, membership, memberships } = await getDashboardContext();
  const business = await getBusiness(actor);

  const details = [
    ['Business name', business.name],
    ['What you sell', categoryLabels[business.category]],
    ['WhatsApp number', business.whatsappNumber],
    ['Store address', storeHost(business.subdomain)],
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Business details</CardTitle>
          <CardDescription>From your sign-up details.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-col gap-3">
            {details.map(([label, value]) => (
              <div key={label} className="flex flex-col sm:flex-row sm:gap-4">
                <dt className="text-sm text-muted-foreground sm:w-40">{label}</dt>
                <dd className="font-medium break-all">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Link href="/settings/brand" className="block">
        <Card className="transition-colors hover:bg-muted/50">
          <CardHeader className="flex-row items-center justify-between">
            <div className="flex items-center gap-3">
              <Palette className="size-5 text-primary" aria-hidden />
              <div>
                <CardTitle>Brand kit</CardTitle>
                <CardDescription>Logo, colours, font and how your assistant talks.</CardDescription>
              </div>
            </div>
            <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
          </CardHeader>
        </Card>
      </Link>

      <Link href="/settings/team" className="block">
        <Card className="transition-colors hover:bg-muted/50">
          <CardHeader className="flex-row items-center justify-between">
            <div className="flex items-center gap-3">
              <Users className="size-5 text-primary" aria-hidden />
              <div>
                <CardTitle>Team</CardTitle>
                <CardDescription>Invite staff and riders.</CardDescription>
              </div>
            </div>
            <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
          </CardHeader>
        </Card>
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Your businesses</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {memberships.map((m) => {
            const current = m.businessId === membership.businessId;
            return (
              <div
                key={m.businessId}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <span className="truncate font-medium">{m.businessName}</span>
                {current ? (
                  <Badge tone="success">Current</Badge>
                ) : (
                  <ActionButton
                    action={switchBusinessAction.bind(null, m.businessId)}
                    redirectTo="/"
                    variant="outline"
                    size="sm"
                  >
                    Switch
                  </ActionButton>
                )}
              </div>
            );
          })}
          <Button asChild variant="ghost" className="justify-start">
            <Link href="/onboarding?new=1">
              <Plus aria-hidden /> Add another business
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
