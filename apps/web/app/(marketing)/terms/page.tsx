import { APP_NAME } from '@fulcra/config';
import type { Metadata } from 'next';
import { getRootDomain } from '@/lib/host-routing';
import { LegalPage } from '../_components/legal-page';

export const metadata: Metadata = { title: 'Terms of service' };

export default function TermsPage() {
  const email = `hello@${getRootDomain().replace(/:\d+$/, '')}`;
  return (
    <LegalPage title="Terms of service" updated="17 November 2026">
      <p>
        These terms are an agreement between {APP_NAME} and the business that signs up (“you”). By
        creating an account you agree to them.
      </p>

      <h2>The service</h2>
      <p>
        {APP_NAME} gives you an AI sales assistant for WhatsApp, Instagram and your website, a store
        page, order and payment tools, and a dashboard. Some features depend on Meta and Paystack
        approving your accounts.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be at least 18 and able to run a business in Nigeria.</li>
        <li>
          Keep your sign-in secure. You are responsible for what your team does in your account.
        </li>
        <li>Give accurate business, product and bank details.</li>
      </ul>

      <h2>What you sell and say</h2>
      <ul>
        <li>
          You are the seller. You are responsible for your products, prices, delivery, refunds and
          for following consumer law.
        </li>
        <li>
          Do not use {APP_NAME} for illegal or prohibited goods, spam, or anything that breaks
          WhatsApp, Instagram or Paystack rules.
        </li>
        <li>Keep your product information correct: the assistant relies on it.</li>
      </ul>

      <h2>The assistant</h2>
      <p>
        The assistant answers from your data and hands chats to you when unsure. It can still make
        mistakes. Check your orders, and step in when needed; you remain responsible for what is
        agreed with your customers.
      </p>

      <h2>Payments</h2>
      <p>
        Customer payments go through Paystack and settle to your bank account; {APP_NAME} never
        holds them. Paystack’s own terms and fees apply.
      </p>

      <h2>Plans, trial and billing</h2>
      <ul>
        <li>New accounts get a 14-day free trial of the Growth plan. No card is needed.</li>
        <li>
          Paid plans renew automatically each month or year until cancelled. You can cancel any
          time; your plan works until the end of the period you paid for.
        </li>
        <li>Upgrades start straight away; smaller plans start at your next renewal.</li>
        <li>
          If a renewal fails, you have 7 days to fix it before the assistant and alerts pause. Your
          store, orders and payments keep working.
        </li>
        <li>We will tell you at least 30 days before a price change affects you.</li>
      </ul>

      <h2>Your data</h2>
      <p>
        Your products, customers and orders belong to you. Our{' '}
        <a className="text-primary underline" href="/privacy">
          privacy policy
        </a>{' '}
        explains how we handle them. You can ask us for a copy at any time.
      </p>

      <h2>Availability</h2>
      <p>
        We work hard to keep {APP_NAME} running, but it may sometimes be unavailable, including when
        Meta or Paystack are down.
      </p>

      <h2>Liability</h2>
      <p>
        As far as the law allows, {APP_NAME} is not liable for lost profits or indirect losses, and
        our total liability is limited to what you paid us in the 12 months before the claim.
      </p>

      <h2>Ending the agreement</h2>
      <p>
        You can close your account at any time. We may suspend accounts that break these terms, and
        will tell you why unless the law prevents it.
      </p>

      <h2>Law and contact</h2>
      <p>
        These terms are governed by the laws of the Federal Republic of Nigeria. Questions? Email{' '}
        <a className="text-primary underline" href={`mailto:${email}`}>
          {email}
        </a>
        .
      </p>
    </LegalPage>
  );
}
