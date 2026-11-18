'use client';

import { CheckCircle2, Lock } from 'lucide-react';
import { useEffect, useRef } from 'react';

const steps = [
  {
    title: 'A customer asks',
    text: 'At 11pm, on WhatsApp, Instagram or your website. Fulcra replies in seconds.',
  },
  {
    title: 'It answers from your catalogue',
    text: 'Real prices, sizes, stock and delivery fees from your products. Never guessed.',
  },
  {
    title: 'It sends the payment link',
    text: 'Paystack link or bank transfer. The money goes straight to your bank account.',
  },
  {
    title: 'Payment confirmed. Receipt sent.',
    text: 'Fulcra checks the payment itself, records the order and tells you on WhatsApp.',
  },
] as const;

type Bubble = { step: number; from: 'customer' | 'assistant' | 'system'; text: string };

const bubbles: Bubble[] = [
  {
    step: 0,
    from: 'customer',
    text: 'Good evening 👋 How much is the Ankara midi dress? Size 12?',
  },
  {
    step: 1,
    from: 'assistant',
    text: 'Good evening! The Ankara midi dress is ₦15,000 and we have size 12 🎉 Delivery to Lekki is ₦2,000, same day.',
  },
  { step: 1, from: 'customer', text: 'Perfect. I’ll take it' },
  {
    step: 2,
    from: 'assistant',
    text: 'Lovely! Your total is ₦17,000. Pay securely here and I’ll confirm right away:',
  },
  { step: 3, from: 'system', text: 'Payment received · ₦17,000' },
  {
    step: 3,
    from: 'assistant',
    text: 'Thank you, Chioma! Order #1042 is confirmed. Here’s your receipt 🧾',
  },
];

/**
 * "Watch a sale happen": the phone stays on screen while the chat plays out with the scroll.
 * Without JavaScript, or with reduced motion, everything is simply shown.
 */
export function SaleStory() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = root.current;
    if (!section || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let revert: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import('gsap'),
        import('gsap/ScrollTrigger'),
      ]);
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      section.dataset.animated = '';
      const ctx = gsap.context(() => {
        const q = gsap.utils.selector(section);
        const items = q('[data-bubble]');
        const captions = q('[data-caption]');
        const dots = q('[data-dot]');
        gsap.set(items, { autoAlpha: 0, y: 18, scale: 0.96, transformOrigin: 'bottom center' });
        gsap.set(captions.slice(1), { autoAlpha: 0, y: 12 });
        gsap.set(q('[data-alert]'), { autoAlpha: 0, y: -24 });

        const tl = gsap.timeline({
          defaults: { ease: 'power3.out', duration: 0.5 },
          scrollTrigger: {
            trigger: q('[data-pin]')[0],
            start: 'top top',
            end: '+=2200',
            pin: true,
            scrub: 0.7,
            anticipatePin: 1,
          },
        });
        tl.fromTo(
          q('[data-phone]'),
          { rotationX: 14, rotationY: -12, y: 40, scale: 0.94 },
          { rotationX: 0, rotationY: 0, y: 0, scale: 1, duration: 1, ease: 'power2.out' },
        );
        const viewport = q('[data-chat]')[0] as HTMLElement;
        const track = q('[data-chat-track]')[0] as HTMLElement;
        const green = dots[0] ? getComputedStyle(dots[0]).backgroundColor : '#0b7a57';
        let current = 0;
        items.forEach((element) => {
          const item = element as HTMLElement;
          const step = Number(item.dataset.step);
          if (step !== current) {
            tl.to(captions[current]!, { autoAlpha: 0, y: -12, duration: 0.25 }, '+=0.15')
              .to(captions[step]!, { autoAlpha: 1, y: 0, duration: 0.4 })
              .to(dots[step]!, { backgroundColor: green, scale: 1.25, duration: 0.3 }, '<')
              .to(dots[current]!, { scale: 1, duration: 0.3 }, '<');
            current = step;
          }
          // Like a real chat: once messages fill the screen, older ones move up out of view.
          const overflow = item.offsetTop + item.offsetHeight + 16 - viewport.clientHeight;
          tl.to(item, { autoAlpha: 1, y: 0, scale: 1 }, '+=0.25');
          if (overflow > 0) tl.to(track, { y: -overflow, duration: 0.5 }, '<');
        });
        tl.to(q('[data-alert]'), { autoAlpha: 1, y: 0, duration: 0.6 }, '+=0.2').to(
          {},
          {
            duration: 0.6,
          },
        );
      }, section);
      revert = () => {
        ctx.revert();
        delete section.dataset.animated;
      };
    })();
    return () => {
      cancelled = true;
      revert?.();
    };
  }, []);

  return (
    <section
      ref={root}
      id="how"
      aria-labelledby="story-title"
      className="group relative bg-background pt-24 md:pt-32"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 text-center">
        <p className="text-sm font-medium text-primary">Watch a sale happen</p>
        <h2 id="story-title" className="text-4xl font-semibold md:text-6xl">
          From “how much?” to paid. Without lifting a finger.
        </h2>
      </div>
      <div
        data-pin
        className="mx-auto grid max-w-6xl content-center items-center gap-8 px-6 py-12 group-data-[animated]:h-dvh group-data-[animated]:py-6 md:grid-cols-[1fr_auto] md:gap-16 md:py-16"
      >
        <div className="flex flex-col gap-6 md:max-w-md">
          <div className="relative group-data-[animated]:min-h-32 md:group-data-[animated]:min-h-40">
            {steps.map((step, index) => (
              <div
                key={step.title}
                data-caption
                className="flex flex-col gap-1.5 group-data-[animated]:absolute group-data-[animated]:inset-x-0 group-data-[animated]:top-0 [&:not(:first-child)]:mt-6 group-data-[animated]:[&:not(:first-child)]:mt-0"
              >
                <p className="text-sm font-medium text-muted-foreground">Step {index + 1}</p>
                <p className="text-xl font-semibold md:text-2xl">{step.title}</p>
                <p className="text-muted-foreground md:text-lg">{step.text}</p>
              </div>
            ))}
          </div>
          <div className="hidden gap-2 md:flex" aria-hidden>
            {steps.map((step, index) => (
              <span
                key={step.title}
                data-dot
                className={`size-2 rounded-full ${index === 0 ? 'bg-primary' : 'bg-input'}`}
              />
            ))}
          </div>
        </div>

        <div className="relative mx-auto [perspective:1200px]">
          <div
            data-alert
            className="absolute -top-6 left-1/2 z-20 flex w-[290px] -translate-x-1/2 items-center gap-3 rounded-2xl border border-white/60 bg-white/85 p-3 shadow-raised backdrop-blur-xl"
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-sm font-bold text-white">
              F
            </span>
            <span className="flex min-w-0 flex-col text-left">
              <span className="text-[0.8125rem] font-semibold text-foreground">
                New paid order #1042
              </span>
              <span className="truncate text-xs text-muted-foreground">
                Chioma · Ankara midi dress · ₦17,000
              </span>
            </span>
          </div>
          <div
            data-phone
            className="relative w-[272px] rounded-[3rem] bg-[#0b0b0d] p-3 shadow-[0_40px_80px_-24px_rgb(4_40_30/0.45),0_0_0_1px_rgb(255_255_255/0.06)_inset] sm:w-[320px]"
          >
            <div className="overflow-hidden rounded-[2.4rem] bg-[#efeae2]">
              <div className="flex items-center gap-3 bg-[#0b5c47] px-4 pt-9 pb-3 text-white">
                <span className="flex size-9 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">
                  AS
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-sm font-semibold">Adaeze Styles</span>
                  <span className="text-xs text-white/70">online</span>
                </span>
              </div>
              <div data-chat className="h-[min(440px,48dvh)] min-h-[340px] overflow-hidden">
                <ol
                  data-chat-track
                  aria-label="Example chat"
                  className="relative flex flex-col gap-2 px-3 pt-3 pb-4 text-[0.8125rem] leading-snug"
                >
                  {bubbles.map((bubble, index) => (
                    <li
                      key={index}
                      data-bubble
                      data-step={bubble.step}
                      className={
                        bubble.from === 'customer'
                          ? 'max-w-[82%] self-end rounded-2xl rounded-br-md bg-[#d9fdd3] px-3 py-2 text-[#111b21] shadow-xs'
                          : bubble.from === 'system'
                            ? 'flex items-center gap-1.5 self-center rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#0b7a57] shadow-xs'
                            : 'max-w-[82%] self-start rounded-2xl rounded-bl-md bg-white px-3 py-2 text-[#111b21] shadow-xs'
                      }
                    >
                      {bubble.from === 'system' && (
                        <CheckCircle2 className="size-3.5" aria-hidden />
                      )}
                      {bubble.text}
                      {bubble.step === 2 && bubble.from === 'assistant' && (
                        <span className="mt-2 flex items-center gap-2 rounded-xl bg-[#f0f2f5] px-3 py-2 text-xs font-medium text-[#0b7a57]">
                          <Lock className="size-3.5" aria-hidden /> Pay ₦17,000 securely
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
