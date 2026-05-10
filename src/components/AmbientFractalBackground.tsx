'use client';

import { type CSSProperties, useEffect, useMemo, useState } from 'react';

type AmbientFractalBackgroundProps = {
  intensity: 'landing' | 'session';
};

type Fragment = {
  id: string;
  x: number;
  y: number;
  rotation: number;
  size: number;
  duration: number;
  delay: number;
  opacity: number;
};

type BackgroundStyle = CSSProperties & {
  '--escape-dust-opacity': string;
  '--parallax-x': string;
  '--parallax-y': string;
};

function seededRandom(seed: number) {
  let value = seed % 2147483647;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function makeFragments(count: number, seed: number, prefix: string): Fragment[] {
  const random = seededRandom(seed);

  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    x: Math.round(random() * 1000) / 10,
    y: Math.round(random() * 1000) / 10,
    rotation: Math.round((random() * 90 - 45) * 10) / 10,
    size: Math.round((random() * 52 + 24) * 10) / 10,
    duration: Math.round((random() * 12 + 18) * 10) / 10,
    delay: -Math.round(random() * 220) / 10,
    opacity: Math.round((random() * 0.12 + 0.12) * 100) / 100,
  }));
}

export default function AmbientFractalBackground({ intensity }: AmbientFractalBackgroundProps) {
  const isLanding = intensity === 'landing';
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const [reducedMotion, setReducedMotion] = useState(false);
  const shards = useMemo(() => makeFragments(isLanding ? 34 : 22, isLanding ? 731 : 431, 'shard'), [isLanding]);
  const cells = useMemo(() => makeFragments(isLanding ? 16 : 9, isLanding ? 1201 : 811, 'cell'), [isLanding]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => setReducedMotion(mediaQuery.matches);

    updateMotionPreference();
    mediaQuery.addEventListener('change', updateMotionPreference);

    return () => mediaQuery.removeEventListener('change', updateMotionPreference);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;

    let frameId = 0;
    const onPointerMove = (event: PointerEvent) => {
      if (frameId) return;

      frameId = window.requestAnimationFrame(() => {
        const x = ((event.clientX / window.innerWidth) - 0.5) * (isLanding ? 8 : 5);
        const y = ((event.clientY / window.innerHeight) - 0.5) * (isLanding ? 8 : 5);
        setParallax({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
        frameId = 0;
      });
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, [isLanding, reducedMotion]);

  const style: BackgroundStyle = {
    '--escape-dust-opacity': isLanding ? '0.92' : '0.62',
    '--parallax-x': `${parallax.x}px`,
    '--parallax-y': `${parallax.y}px`,
  };

  return (
    <div className="escape-dust-background pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true" style={style}>
      <div className="escape-dust-mist" />
      <div className="escape-dust-field">
        <div className="escape-dust-points" />
        <div className="escape-dust-grain" />
        <div className="escape-dust-filaments" />
        {shards.map((shard) => (
          <span
            key={shard.id}
            className="escape-dust-shard"
            style={{
              left: `${shard.x}%`,
              top: `${shard.y}%`,
              width: `${shard.size}px`,
              '--fragment-rotation': `${shard.rotation}deg`,
              '--fragment-duration': `${shard.duration}s`,
              '--fragment-delay': `${shard.delay}s`,
              '--fragment-opacity': `${shard.opacity}`,
            } as CSSProperties}
          />
        ))}
        {cells.map((cell) => (
          <span
            key={cell.id}
            className="escape-dust-micro-cell"
            style={{
              left: `${cell.x}%`,
              top: `${cell.y}%`,
              width: `${cell.size * 0.45}px`,
              height: `${cell.size * 0.45}px`,
              '--fragment-rotation': `${cell.rotation}deg`,
              '--fragment-duration': `${cell.duration + 4}s`,
              '--fragment-delay': `${cell.delay}s`,
              '--fragment-opacity': `${cell.opacity * 0.65}`,
            } as CSSProperties}
          />
        ))}
      </div>
      <div className="escape-dust-vignette" />

      <style dangerouslySetInnerHTML={{ __html: `
        .escape-dust-background {
          opacity: var(--escape-dust-opacity);
          background:
            radial-gradient(circle at 22% 24%, rgba(147, 197, 253, 0.055), transparent 30%),
            radial-gradient(circle at 78% 72%, rgba(251, 191, 36, 0.045), transparent 34%),
            linear-gradient(145deg, #07070c, #101018 60%, #08080d);
        }

        .escape-dust-field {
          position: absolute;
          inset: -18%;
          transform: translate3d(var(--parallax-x), var(--parallax-y), 0);
          transform-origin: 46% 54%;
          animation: escape-dust-quiet-zoom 42s ease-in-out infinite alternate;
        }

        .escape-dust-mist {
          position: absolute;
          inset: -16%;
          opacity: 0.11;
          background:
            radial-gradient(ellipse at 28% 52%, rgba(147, 197, 253, 0.16), transparent 32%),
            radial-gradient(ellipse at 58% 42%, rgba(216, 180, 254, 0.11), transparent 36%),
            radial-gradient(ellipse at 76% 70%, rgba(251, 191, 36, 0.09), transparent 30%);
          filter: blur(16px);
          animation: escape-dust-mist-wander 38s ease-in-out infinite alternate;
        }

        .escape-dust-points {
          position: absolute;
          inset: 0;
          opacity: 0.2;
          background-image:
            radial-gradient(circle, rgba(255, 255, 255, 0.45) 0.75px, transparent 1px),
            radial-gradient(circle, rgba(147, 197, 253, 0.3) 0.65px, transparent 1px),
            radial-gradient(circle, rgba(251, 191, 36, 0.24) 0.55px, transparent 1px);
          background-position: 0 0, 17px 23px, 31px 11px;
          background-size: 41px 41px, 67px 67px, 97px 97px;
          animation: escape-dust-flow 36s linear infinite;
        }

        .escape-dust-grain {
          position: absolute;
          inset: -20%;
          opacity: 0.18;
          mix-blend-mode: screen;
          background:
            repeating-conic-gradient(from 18deg at 38% 54%, transparent 0 8deg, rgba(255, 255, 255, 0.07) 9deg, transparent 10deg 22deg),
            repeating-radial-gradient(ellipse at 39% 53%, transparent 0 24px, rgba(147, 197, 253, 0.075) 25px, transparent 27px),
            repeating-radial-gradient(circle at 62% 45%, transparent 0 15px, rgba(251, 191, 36, 0.055) 16px, transparent 18px);
          animation: escape-dust-grain-breathe 34s ease-in-out infinite alternate;
          mask-image:
            radial-gradient(ellipse at 42% 52%, black 0 42%, transparent 72%),
            linear-gradient(90deg, transparent, black 18%, black 82%, transparent);
        }

        .escape-dust-filaments {
          position: absolute;
          inset: -24%;
          opacity: 0.13;
          background:
            linear-gradient(24deg, transparent 0 46%, rgba(255, 255, 255, 0.18) 47%, transparent 48% 100%),
            linear-gradient(-18deg, transparent 0 50%, rgba(147, 197, 253, 0.14) 51%, transparent 52% 100%),
            linear-gradient(72deg, transparent 0 54%, rgba(251, 191, 36, 0.1) 55%, transparent 56% 100%);
          background-size: 86px 86px, 118px 118px, 152px 152px;
          animation: escape-dust-filament-slide 44s ease-in-out infinite alternate;
        }

        .escape-dust-shard {
          position: absolute;
          height: 1px;
          opacity: 0;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, var(--fragment-opacity)), transparent);
          transform: rotate(var(--fragment-rotation)) translate3d(-12px, 10px, 0) scaleX(0.18);
          transform-origin: center;
          animation: escape-dust-shard-cycle var(--fragment-duration) ease-in-out infinite;
          animation-delay: var(--fragment-delay);
        }

        .escape-dust-shard::after {
          content: "";
          position: absolute;
          left: 50%;
          top: -2px;
          width: 4px;
          height: 4px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.16);
          box-shadow: 0 0 18px rgba(147, 197, 253, 0.08);
        }

        .escape-dust-micro-cell {
          position: absolute;
          opacity: 0;
          border: 1px solid rgba(255, 255, 255, var(--fragment-opacity));
          clip-path: polygon(50% 0, 92% 25%, 92% 75%, 50% 100%, 8% 75%, 8% 25%);
          transform: rotate(var(--fragment-rotation)) scale(0.4);
          animation: escape-dust-cell-cycle var(--fragment-duration) ease-in-out infinite;
          animation-delay: var(--fragment-delay);
        }

        .escape-dust-vignette {
          position: absolute;
          inset: 0;
          box-shadow: inset 0 0 150px rgba(0, 0, 0, 0.9);
        }

        @keyframes escape-dust-quiet-zoom {
          from { transform: translate3d(var(--parallax-x), var(--parallax-y), 0) scale(1); }
          to { transform: translate3d(calc(var(--parallax-x) - 1.2%), calc(var(--parallax-y) + 0.8%), 0) scale(1.08); }
        }

        @keyframes escape-dust-flow {
          from { background-position: 0 0, 17px 23px, 31px 11px; }
          to { background-position: 130px -180px, -72px 95px, 91px -64px; }
        }

        @keyframes escape-dust-grain-breathe {
          from { opacity: 0.09; transform: scale(1) rotate(-1deg); }
          to { opacity: 0.2; transform: scale(1.1) rotate(1.4deg); }
        }

        @keyframes escape-dust-filament-slide {
          from { background-position: 0 0, 30px 20px, -20px 40px; transform: rotate(-1deg); }
          to { background-position: 92px -70px, -46px 94px, 80px -44px; transform: rotate(1deg); }
        }

        @keyframes escape-dust-shard-cycle {
          0%, 100% { opacity: 0; transform: rotate(var(--fragment-rotation)) translate3d(-12px, 10px, 0) scaleX(0.18); filter: blur(4px); }
          24% { opacity: 0.16; filter: blur(0); }
          58% { opacity: 0.28; transform: rotate(calc(var(--fragment-rotation) + 8deg)) translate3d(16px, -12px, 0) scaleX(1); }
          82% { opacity: 0.08; }
        }

        @keyframes escape-dust-cell-cycle {
          0%, 100% { opacity: 0; transform: rotate(var(--fragment-rotation)) scale(0.35); filter: blur(5px); }
          30% { opacity: 0.12; filter: blur(0); }
          62% { opacity: 0.22; transform: rotate(calc(var(--fragment-rotation) + 36deg)) scale(1); }
          84% { opacity: 0.06; }
        }

        @keyframes escape-dust-mist-wander {
          from { transform: translate3d(-2%, 1%, 0) scale(1); }
          to { transform: translate3d(2%, -1%, 0) scale(1.08); }
        }

        @media (prefers-reduced-motion: reduce) {
          .escape-dust-field,
          .escape-dust-mist,
          .escape-dust-points,
          .escape-dust-grain,
          .escape-dust-filaments,
          .escape-dust-shard,
          .escape-dust-micro-cell {
            animation: none;
          }

          .escape-dust-field {
            transform: none;
          }

          .escape-dust-shard,
          .escape-dust-micro-cell {
            opacity: 0.12;
          }
        }
      ` }} />
    </div>
  );
}
