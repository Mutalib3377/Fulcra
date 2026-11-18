import { getBusiness } from '@fulcra/core';
import { Badge, ListGroup, ListRow, ListRowContent } from '@fulcra/ui';
import {
  Bell,
  Camera,
  CreditCard,
  MessagesSquare,
  Bot,
  Smartphone,
  Globe,
  Landmark,
  MapPin,
  MessageCircle,
  Palette,
  Plus,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ActionButton } from '@/components/action-button';
import { PageHeader } from '@/components/page-header';
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

  const link = (href: string, icon: ReactNode, title: string, description: string) => (
    <ListRow asChild>
      <Link href={href}>
        <ListRowContent icon={icon} title={title} description={description} chevron />
      </Link>
    </ListRow>
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Settings" />

      <ListGroup title="Business" footer="From your sign-up details.">
        {details.map(([label, value]) => (
          <ListRow key={label} title={label} trailing={<span className="truncate">{value}</span>} />
        ))}
      </ListGroup>

      <ListGroup title="Selling">
        {link(
          '/settings/store',
          <Globe aria-hidden />,
          'Store or website',
          business.hasExternalWebsite && business.websiteUrl
            ? `Your website: ${business.websiteUrl.replace(/^https?:\/\//, '')}`
            : 'Customers shop on your Fulcra store.',
        )}
        {link(
          '/settings/assistant',
          <Bot aria-hidden />,
          'Assistant',
          'Switch it on, opening hours, policies, what to pass to you.',
        )}
        {link(
          '/settings/payments',
          <Landmark aria-hidden />,
          'Get paid',
          'Your bank account for online payments.',
        )}
        {link(
          '/settings/delivery',
          <MapPin aria-hidden />,
          'Delivery areas',
          'Where you deliver and how much it costs.',
        )}
        {link(
          '/settings/brand',
          <Palette aria-hidden />,
          'Brand kit',
          'Logo, colours, font and how your assistant talks.',
        )}
      </ListGroup>

      <ListGroup title="Chats">
        {link(
          '/settings/whatsapp',
          <Smartphone aria-hidden />,
          'WhatsApp number',
          'Connect your number so chats arrive in your inbox.',
        )}
        {link(
          '/settings/instagram',
          <Camera aria-hidden />,
          'Instagram',
          'Connect your account so DMs arrive in your inbox.',
        )}
        {link(
          '/settings/website-chat',
          <MessagesSquare aria-hidden />,
          'Website chat',
          'A chat bubble for your website and store.',
        )}
        {link(
          '/settings/whatsapp-buttons',
          <MessageCircle aria-hidden />,
          'WhatsApp buttons',
          'Links and buttons for your website, Instagram bio and flyers.',
        )}
        {link(
          '/settings/alerts',
          <Bell aria-hidden />,
          'Alerts',
          'WhatsApp alerts, daily briefing and automatic customer messages.',
        )}
      </ListGroup>

      <ListGroup title="Account">
        {link(
          '/settings/billing',
          <CreditCard aria-hidden />,
          'Plans and billing',
          'Your plan, free trial and assistant chats this month.',
        )}
        {link('/settings/team', <Users aria-hidden />, 'Team', 'Invite staff and riders.')}
      </ListGroup>

      <ListGroup title="Your businesses">
        {memberships.map((m) => {
          const current = m.businessId === membership.businessId;
          return (
            <ListRow
              key={m.businessId}
              title={m.businessName}
              trailing={
                current ? (
                  <Badge tone="success">Current</Badge>
                ) : (
                  <ActionButton
                    action={switchBusinessAction.bind(null, m.businessId)}
                    redirectTo="/"
                    variant="secondary"
                    size="sm"
                  >
                    Switch
                  </ActionButton>
                )
              }
            />
          );
        })}
        <ListRow asChild>
          <Link href="/onboarding?new=1">
            <ListRowContent icon={<Plus aria-hidden />} title="Add another business" />
          </Link>
        </ListRow>
      </ListGroup>
    </div>
  );
}
