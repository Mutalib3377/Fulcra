import { APP_NAME } from '@fulcra/config';
import type { Metadata } from 'next';
import { getRootDomain } from '@/lib/host-routing';
import { LegalPage } from '../_components/legal-page';

export const metadata: Metadata = { title: 'Privacy policy' };

export default function PrivacyPage() {
  const email = `privacy@${getRootDomain().replace(/:\d+$/, '')}`;
  return (
    <LegalPage title="Privacy policy" updated="17 November 2026">
      <p>
        {APP_NAME} helps businesses answer customers, take orders and receive payments on WhatsApp,
        Instagram and their websites. This policy explains what information we handle, why, and the
        choices you have. We follow the Nigeria Data Protection Act 2023.
      </p>

      <h2>Two kinds of people</h2>
      <ul>
        <li>
          <strong>Sellers</strong>: businesses that use {APP_NAME}, and their team members.
          {APP_NAME} is responsible for sellers’ account information.
        </li>
        <li>
          <strong>Customers</strong>: people who chat with or buy from a seller. The seller decides
          how their customers’ information is used; {APP_NAME} handles it on the seller’s behalf and
          only to provide the service.
        </li>
      </ul>

      <h2>What we collect</h2>
      <ul>
        <li>Account details: name, email, business name, WhatsApp number, team roles.</li>
        <li>
          Business information: products, prices, stock, delivery areas, brand details and settings.
        </li>
        <li>
          Customer conversations and orders: messages and photos sent to a seller, names, phone
          numbers, delivery addresses and order history.
        </li>
        <li>
          Payment information: payment status, amounts and references from Paystack. We do not store
          card numbers; Paystack does.
        </li>
        <li>
          Technical information: device and browser type, pages used and error reports, to keep the
          service working and secure.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To answer customers, create orders, send payment links and receipts for sellers.</li>
        <li>To send sellers alerts and daily summaries they switch on.</li>
        <li>To bill sellers for their plan and prevent fraud or abuse.</li>
        <li>To fix problems and improve {APP_NAME}.</li>
      </ul>
      <p>We do not sell personal information, and we do not use it for advertising.</p>

      <h2>Artificial intelligence</h2>
      <p>
        Replies are written by an AI model (provided by Anthropic) using the seller’s own product
        and order data. Conversations are sent to the model only to produce a reply and are not used
        by the provider to train its models. Prices, stock and payment status always come from the
        seller’s data, and the assistant passes a chat to a person when it is unsure.
      </p>

      <h2>Who we share it with</h2>
      <p>Only the service providers we need to run {APP_NAME}:</p>
      <ul>
        <li>Meta (WhatsApp and Instagram) to send and receive messages.</li>
        <li>Paystack to take payments, which settle directly to the seller’s bank account.</li>
        <li>Anthropic to write assistant replies.</li>
        <li>
          Supabase, Render and Cloudflare to host the service, data and files (in the European
          Union).
        </li>
        <li>Sentry and PostHog for error reports and usage statistics.</li>
      </ul>
      <p>
        We may also share information when the law requires it. Because our providers are outside
        Nigeria, information is transferred abroad with the safeguards the law requires.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep information while a seller’s account is active. When a seller closes their account,
        we delete or anonymise their data within 90 days, except records we must keep by law (such
        as payment records).
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see, correct, download or delete your information, or object to how it is
        used. Customers should first contact the seller they bought from; we will help the seller
        respond. Email us at{' '}
        <a className="text-primary underline" href={`mailto:${email}`}>
          {email}
        </a>
        . You may also complain to the Nigeria Data Protection Commission.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit, access keys for connected accounts are stored encrypted, and
        each business’s data is kept separate from every other business.
      </p>

      <h2>Changes</h2>
      <p>
        If we change this policy in a way that matters, we will tell sellers in the dashboard or by
        email before it takes effect.
      </p>
    </LegalPage>
  );
}
