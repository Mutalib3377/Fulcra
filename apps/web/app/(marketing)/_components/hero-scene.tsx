'use client';

import { useEffect, useRef, useState } from 'react';

type NetworkInformation = { saveData?: boolean };

/**
 * Whether this device should draw the 3D background. Phones that are short on memory, on data
 * saver, set to reduce motion, or without WebGL keep the still gradient underneath.
 */
function canAnimate(): boolean {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: NetworkInformation;
  };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if (nav.connection?.saveData) return false;
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 2) return false;
  if (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency < 4) return false;
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Waits until the page has loaded and the browser is idle, so the 3D never delays the text. */
function whenIdle(callback: () => void): () => void {
  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    const idle = (
      window as Window & { requestIdleCallback?: (cb: () => void, o?: object) => number }
    ).requestIdleCallback;
    if (idle) idle(() => !cancelled && callback(), { timeout: 2000 });
    else setTimeout(() => !cancelled && callback(), 300);
  };
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener('load', run);
  };
}

/** The hero's moving background (three.js + a GLSL shader). Fades in over the CSS gradient. */
export function HeroScene() {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = host.current;
    if (!container || !canAnimate()) return;
    let dispose: (() => void) | undefined;
    let stopped = false;

    const cancelIdle = whenIdle(async () => {
      const [THREE, { heroFragmentShader, heroVertexShader }] = await Promise.all([
        import('three'),
        import('./hero-shader'),
      ]);
      if (stopped) return;

      const renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: false,
        powerPreference: 'low-power',
      });
      // The shader is soft, so drawing at a lower resolution looks the same and saves battery.
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.6;
      renderer.setPixelRatio(scale);
      const canvas = renderer.domElement;
      canvas.setAttribute('aria-hidden', 'true');
      canvas.className = 'absolute inset-0 h-full w-full';
      container.appendChild(canvas);

      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const uniforms = {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uPointer: { value: new THREE.Vector2(0, 0) },
        uScroll: { value: 0 },
      };
      const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: heroVertexShader,
        fragmentShader: heroFragmentShader,
        depthTest: false,
        depthWrite: false,
      });
      const geometry = new THREE.PlaneGeometry(2, 2);
      scene.add(new THREE.Mesh(geometry, material));

      const resize = () => {
        const { clientWidth: w, clientHeight: h } = container;
        renderer.setSize(w, h, false);
        uniforms.uResolution.value.set(w * scale, h * scale);
      };
      resize();
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);

      const target = { x: 0, y: 0 };
      const onPointer = (event: PointerEvent) => {
        target.x = (event.clientX / window.innerWidth) * 2 - 1;
        target.y = -((event.clientY / window.innerHeight) * 2 - 1);
      };
      window.addEventListener('pointermove', onPointer, { passive: true });

      // Draw only while the hero is on screen and the tab is visible.
      let visible = true;
      const intersection = new IntersectionObserver(([entry]) => {
        visible = Boolean(entry?.isIntersecting);
        if (visible) loop();
      });
      intersection.observe(container);
      const onVisibility = () => document.visibilityState === 'visible' && loop();
      document.addEventListener('visibilitychange', onVisibility);

      let frame = 0;
      let running = false;
      const start = performance.now();
      const loop = () => {
        if (running || stopped) return;
        running = true;
        const tick = () => {
          if (!visible || document.visibilityState !== 'visible' || stopped) {
            running = false;
            return;
          }
          const pointer = uniforms.uPointer.value;
          pointer.x += (target.x - pointer.x) * 0.04;
          pointer.y += (target.y - pointer.y) * 0.04;
          uniforms.uTime.value = (performance.now() - start) / 1000;
          uniforms.uScroll.value = Math.min(
            1,
            window.scrollY / Math.max(1, container.clientHeight),
          );
          renderer.render(scene, camera);
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      };
      renderer.render(scene, camera);
      setReady(true);
      loop();

      dispose = () => {
        cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        intersection.disconnect();
        window.removeEventListener('pointermove', onPointer);
        document.removeEventListener('visibilitychange', onVisibility);
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        canvas.remove();
      };
    });

    return () => {
      stopped = true;
      cancelIdle();
      dispose?.();
    };
  }, []);

  return (
    <div
      ref={host}
      aria-hidden
      className={`absolute inset-0 transition-opacity duration-[1600ms] ease-out ${
        ready ? 'opacity-100' : 'opacity-0'
      }`}
    />
  );
}
