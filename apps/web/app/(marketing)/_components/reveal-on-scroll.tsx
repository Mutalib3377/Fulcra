'use client';

import { useEffect } from 'react';

/**
 * Fades sections in as they scroll into view: every element with `data-reveal` (children with
 * `data-reveal-item` follow one after another). Content is visible without JavaScript and with
 * reduced motion; GSAP only loads after the page has shown.
 */
export function RevealOnScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let revert: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import('gsap'),
        import('gsap/ScrollTrigger'),
      ]);
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      const ctx = gsap.context(() => {
        const below = (el: Element) => el.getBoundingClientRect().top > window.innerHeight * 0.9;
        gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((section) => {
          if (!below(section)) return; // already on screen: leave it alone
          const items = section.querySelectorAll('[data-reveal-item]');
          const targets = items.length ? items : [section];
          gsap.set(targets, { autoAlpha: 0, y: 28 });
          ScrollTrigger.create({
            trigger: section,
            start: 'top 85%',
            once: true,
            onEnter: () =>
              gsap.to(targets, {
                autoAlpha: 1,
                y: 0,
                duration: 0.9,
                ease: 'power3.out',
                stagger: 0.08,
                clearProps: 'transform',
              }),
          });
        });
      });
      revert = () => ctx.revert();
    })();
    return () => {
      cancelled = true;
      revert?.();
    };
  }, []);
  return null;
}
