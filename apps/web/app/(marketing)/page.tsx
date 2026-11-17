import { APP_NAME } from '@fulcra/config';
import { PLAN_CODES, PLANS } from '@fulcra/core/rules';
import { Button } from '@fulcra/ui';
import {
  BellRing,
  Boxes,
  Camera,
  CreditCard,
  Globe,
  HandHelping,
  MessageCircle,
  Sparkles,
  Store,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import { getRootDomain } from '@/lib/host-routing';
import { dashboardUrl } from '@/lib/urls';
import { HeroScene } from './_components/hero-scene';
import { Pricing } from './_components/pricing';
import { RevealOnScroll } from './_components/reveal-on-scroll';
import { SaleStory } from './_components/sale-story';

export const metadata: Metadata = {
  title: {
    absolute: `${APP_NAME} — Your AI sales assistant on WhatsApp, Instagram and your website`,
  },
  description:
    'Fulcra answers every customer in seconds, takes the order, sends the payment link and confirms the money. 14 days free.',
};

const channels = [
  {
    icon: MessageCircle,
    name: 'WhatsApp',
    text: 'Replies on your business number, sends photos and payment links, and follows up the right way.',
  },
  {
    icon: Camera,
    name: 'Instagram',
    text: 'Answers DMs about your posts, “how much?” screenshots included.',
  },
  {
    icon: Globe,
    name: 'Your website',
    text: 'One line of code or our WordPress plugin. Or use the free store we make for you.',
  },
] as const;

const features = [
  {
    icon: CreditCard,
    title: 'Payments that confirm themselves',
    text: 'Paystack links and personal transfer accounts. Fulcra checks every payment, sends the receipt, and the money lands in your bank. We never hold it.',
    wide: true,
  },
  {
    icon: Boxes,
    title: 'Knows your stock',
    text: 'Prices, sizes and stock come from your catalogue. It never sells what you don’t have.',
  },
  {
    icon: HandHelping,
    title: 'Hands over at the right time',
    text: 'Unhappy customer or a tricky question? It passes the chat to you and pings your phone.',
  },
  {
    icon: BellRing,
    title: 'Your morning briefing',
    text: 'Yesterday’s sales, unpaid orders and low stock, on WhatsApp at 8am.',
  },
  {
    icon: Users,
    title: 'Remembers every customer',
    text: 'Name, address and past orders, across WhatsApp, Instagram and your site.',
  },
] as const;

const faqs = [
  {
    q: 'Will it make up prices or promise things I can’t do?',
    a: 'No. Prices, stock, delivery fees and payment status always come from your own data. If the assistant is unsure, it hands the chat to you instead of guessing.',
  },
  {
    q: 'Where does the money go?',
    a: 'Straight to your bank account through Paystack. Fulcra never holds your customers’ money.',
  },
  {
    q: 'Can I still chat with customers myself?',
    a: 'Any time. Tap “Take over” on a chat and the assistant steps back. Give it back when you’re done.',
  },
  {
    q: 'I don’t have a website. Can I still use it?',
    a: 'Yes. We make a simple store for you with your brand colours, ready to share in your bio and status.',
  },
  {
    q: 'What happens after the 14-day trial?',
    a: 'Choose a plan to keep the assistant answering. If you don’t, your store, orders and payments keep working; only the assistant and alerts pause.',
  },
  {
    q: 'Do I need a new WhatsApp number?',
    a: 'You connect a WhatsApp Business number. We guide you through it in a few taps when you sign up.',
  },
] as const;

export default function MarketingHome() {
  const signUp = dashboardUrl('/sign-in');
  const plans = PLAN_CODES.map((code) => {
    const { name, summary, monthlyPrice, annualPrice, conversationsPerMonth } = PLANS[code];
    return { code, name, summary, monthlyPrice, annualPrice, conversationsPerMonth };
  });
  const storeExample = `yourbrand.${getRootDomain().replace(/:\d+$/, '')}`;

  return (
    <main className="overflow-x-clip">
      <RevealOnScroll />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-[#050f0c] text-white">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(80%_60%_at_60%_10%,#0f6b4c_0%,transparent_60%),radial-gradient(60%_50%_at_10%_80%,#0a3d2e_0%,transparent_70%),radial-gradient(50%_40%_at_90%_90%,#0c4a37_0%,transparent_70%)]"
        />
        <div className="absolute inset-0 -z-10">
          <HeroScene />
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-b from-transparent to-[#050f0c]/70"
        />

        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <span className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em]">
            <span className="inline-block size-2.5 rounded-full bg-[#2fd08f]" aria-hidden />
            {APP_NAME}
          </span>
          <nav aria-label="Main" className="flex items-center gap-1 text-sm sm:gap-2">
            <a
              href="#pricing"
              className="hidden rounded-full px-3 py-2 text-white/75 hover:text-white sm:block"
            >
              Pricing
            </a>
            <a
              href={dashboardUrl('/sign-in')}
              className="rounded-full px-3 py-2 text-white/75 hover:text-white"
            >
              Sign in
            </a>
            <Button asChild size="sm" className="bg-white text-[#06140f] hover:bg-white/90">
              <a href={signUp}>Start free</a>
            </Button>
          </nav>
        </header>

        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 pt-10 pb-24">
          <p
            className="mb-6 inline-flex w-fit animate-rise-in items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[0.8125rem] text-white/80 backdrop-blur-md"
            style={{ animationDelay: '80ms' }}
          >
            <Sparkles className="size-3.5 text-[#8ff0c5]" aria-hidden />
            AI sales assistant for WhatsApp, Instagram and your website
          </p>
          <h1 className="max-w-4xl text-5xl font-semibold sm:text-6xl md:text-7xl">
            <span className="block animate-rise-in" style={{ animationDelay: '160ms' }}>
              Sell while
            </span>
            <span
              className="block animate-rise-in bg-gradient-to-r from-[#b8ffdc] via-[#5ee6a8] to-[#2fd08f] bg-clip-text text-transparent"
              style={{ animationDelay: '260ms' }}
            >
              you sleep.
            </span>
          </h1>
          <p
            className="mt-6 max-w-xl animate-rise-in text-lg text-white/70 sm:text-xl sm:leading-8"
            style={{ animationDelay: '380ms' }}
          >
            {APP_NAME} answers every customer in seconds, takes the order, sends the payment link
            and confirms the money. Then it tells you. A full-time sales assistant, without the
            salary.
          </p>
          <div
            className="mt-10 flex animate-rise-in flex-col gap-3 sm:flex-row sm:items-center"
            style={{ animationDelay: '480ms' }}
          >
            <Button asChild size="lg" className="bg-[#2fd08f] text-[#04140d] hover:bg-[#4cdba0]">
              <a href={signUp}>Start free for 14 days</a>
            </Button>
            <Button asChild size="lg" variant="ghost" className="text-white hover:bg-white/10">
              <a href="#how">See it work ↓</a>
            </Button>
          </div>
          <p
            className="mt-4 animate-rise-in text-sm text-white/50"
            style={{ animationDelay: '560ms' }}
          >
            No card needed · Set up in an afternoon
          </p>
        </div>
      </section>

      {/* ── A sale, step by step (GSAP) ───────────────────────────────────── */}
      <SaleStory />

      {/* ── Channels ─────────────────────────────────────────────────────── */}
      <section className="bg-background py-24 md:py-32" aria-labelledby="channels-title">
        <div className="mx-auto flex max-w-6xl flex-col gap-14 px-6">
          <div className="flex max-w-2xl flex-col gap-4" data-reveal>
            <p className="text-sm font-medium text-primary" data-reveal-item>
              One assistant
            </p>
            <h2 id="channels-title" className="text-4xl font-semibold md:text-5xl" data-reveal-item>
              Everywhere your customers already are.
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3" data-reveal>
            {channels.map(({ icon: Icon, name, text }) => (
              <div
                key={name}
                data-reveal-item
                className="flex flex-col gap-5 rounded-2xl bg-card p-7 shadow-card"
              >
                <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                  <Icon className="size-6" aria-hidden />
                </span>
                <div className="flex flex-col gap-2">
                  <h3 className="text-xl font-semibold">{name}</h3>
                  <p className="text-muted-foreground">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features (bento) ─────────────────────────────────────────────── */}
      <section className="bg-card py-24 md:py-32" aria-labelledby="features-title">
        <div className="mx-auto flex max-w-6xl flex-col gap-14 px-6">
          <div className="flex max-w-2xl flex-col gap-4" data-reveal>
            <p className="text-sm font-medium text-primary" data-reveal-item>
              Built for how you sell
            </p>
            <h2 id="features-title" className="text-4xl font-semibold md:text-5xl" data-reveal-item>
              The boring parts, handled.
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3" data-reveal>
            {features.map(({ icon: Icon, title, text, ...rest }) => (
              <div
                key={title}
                data-reveal-item
                className={`flex flex-col justify-between gap-10 rounded-2xl bg-background p-7 ${
                  'wide' in rest && rest.wide ? 'md:col-span-2' : ''
                }`}
              >
                <Icon className="size-7 text-primary" aria-hidden />
                <div className="flex flex-col gap-2">
                  <h3 className="text-xl font-semibold">{title}</h3>
                  <p className="max-w-lg text-muted-foreground">{text}</p>
                </div>
              </div>
            ))}
            <div
              data-reveal-item
              className="flex flex-col justify-between gap-10 rounded-2xl bg-[#06140f] p-7 text-white md:col-span-3 md:flex-row md:items-end"
            >
              <div className="flex flex-col gap-2">
                <Store className="mb-8 size-7 text-[#8ff0c5]" aria-hidden />
                <h3 className="text-2xl font-semibold">No website? You get a store.</h3>
                <p className="max-w-lg text-white/65">
                  Your products, your colours, ready to share. With “Order on WhatsApp” and “Chat to
                  buy” on every product.
                </p>
              </div>
              <p className="rounded-full border border-white/15 bg-white/5 px-4 py-2 font-mono text-sm text-[#b8ffdc]">
                {storeExample}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="bg-background py-24 md:py-32" aria-labelledby="steps-title">
        <div className="mx-auto flex max-w-6xl flex-col gap-14 px-6">
          <div className="flex max-w-2xl flex-col gap-4" data-reveal>
            <p className="text-sm font-medium text-primary" data-reveal-item>
              How it works
            </p>
            <h2 id="steps-title" className="text-4xl font-semibold md:text-5xl" data-reveal-item>
              Ready this afternoon.
            </h2>
          </div>
          <ol className="grid gap-10 md:grid-cols-3 md:gap-8" data-reveal>
            {[
              [
                'Add your products',
                'Type them in, or bring them from Shopify, WooCommerce, a spreadsheet or your website link.',
              ],
              [
                'Connect your chats',
                'WhatsApp, Instagram, your website, or all three. A few taps each.',
              ],
              [
                'Let it sell',
                'Try it in a test chat, switch it on, and watch orders come in. Step in whenever you like.',
              ],
            ].map(([title, text], index) => (
              <li key={title} data-reveal-item className="flex flex-col gap-3 border-t pt-6">
                <span className="text-sm font-medium text-muted-foreground tabular-nums">
                  0{index + 1}
                </span>
                <h3 className="text-2xl font-semibold">{title}</h3>
                <p className="text-muted-foreground">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section
        id="pricing"
        className="scroll-mt-8 bg-card py-24 md:py-32"
        aria-labelledby="pricing-title"
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-12 px-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-4 text-center" data-reveal>
            <p className="text-sm font-medium text-primary" data-reveal-item>
              Pricing
            </p>
            <h2 id="pricing-title" className="text-4xl font-semibold md:text-5xl" data-reveal-item>
              Cheaper than hiring. Faster at replying.
            </h2>
          </div>
          <Pricing plans={plans} signUpUrl={signUp} />
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className="bg-background py-24 md:py-32" aria-labelledby="faq-title">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 md:grid-cols-[1fr_1.4fr] md:gap-16">
          <h2 id="faq-title" className="text-4xl font-semibold md:text-5xl" data-reveal>
            Questions sellers ask.
          </h2>
          <div className="flex flex-col" data-reveal>
            {faqs.map(({ q, a }) => (
              <details key={q} data-reveal-item className="group border-b py-5 first:pt-0">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-6 text-lg font-medium [&::-webkit-details-marker]:hidden">
                  {q}
                  <span
                    aria-hidden
                    className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-transform duration-200 group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-xl text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final call ───────────────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden bg-[#050f0c] px-6 py-28 text-center text-white md:py-36">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(60%_80%_at_50%_120%,#0f6b4c_0%,transparent_70%)]"
        />
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-6" data-reveal>
          <h2 className="text-4xl font-semibold md:text-6xl" data-reveal-item>
            Your next customer is typing.
          </h2>
          <p className="text-lg text-white/65" data-reveal-item>
            Start free for 14 days. Set up today, sell tonight.
          </p>
          <div data-reveal-item>
            <Button asChild size="lg" className="bg-[#2fd08f] text-[#04140d] hover:bg-[#4cdba0]">
              <a href={signUp}>Start free trial</a>
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
