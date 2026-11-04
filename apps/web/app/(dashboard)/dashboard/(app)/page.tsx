import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@fulcra/ui';
import { ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import { getDashboardContext } from '@/lib/auth';
import { storeHost, storeUrl } from '@/lib/urls';

export const metadata: Metadata = { title: 'Home' };

export default async function DashboardHome() {
  const { membership } = await getDashboardContext();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Welcome</h1>
        <p className="text-muted-foreground">
          Here is how {membership.businessName} is doing today.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your store link</CardTitle>
          <CardDescription>Share this with customers once you add products.</CardDescription>
        </CardHeader>
        <CardContent>
          <a
            href={storeUrl(membership.subdomain)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 font-medium break-all text-primary underline-offset-4 hover:underline"
          >
            {storeHost(membership.subdomain)}
            <ExternalLink className="size-4 shrink-0" aria-hidden />
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Today</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="No sales yet today"
            description="Your sales, orders and chats will show here once you start selling."
          />
        </CardContent>
      </Card>
    </div>
  );
}
