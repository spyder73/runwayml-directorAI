'use client';

import Image from 'next/image';
import { Play, X } from 'lucide-react';
import { useEffect, useState } from 'react';

type LandingVideoExample = {
  title: string;
  duration: string;
  src: string;
  poster: string;
};

const examples: LandingVideoExample[] = [
  {
    title: 'Example film 1',
    duration: '1:03',
    src: '/landing/videos/example.mp4',
    poster: '/landing/videos/example-poster.jpg',
  },
  {
    title: 'Example film 2',
    duration: '0:47',
    src: '/landing/videos/example_2.mp4',
    poster: '/landing/videos/example_2-poster.jpg',
  },
];

export default function LandingVideoExamples() {
  const [selectedExample, setSelectedExample] = useState<LandingVideoExample | null>(null);

  useEffect(() => {
    if (!selectedExample) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedExample(null);
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [selectedExample]);

  return (
    <>
      {/* Poster cards keep the large MP4 files out of the initial landing-page load. */}
      <div className="grid w-full gap-5 md:grid-cols-2">
        {examples.map((example) => (
          <button
            key={example.src}
            type="button"
            onClick={() => setSelectedExample(example)}
            className="group border border-white/10 bg-black/50 p-1 text-left shadow-2xl transition-colors hover:border-[#F4D58D]/45"
            aria-label={`Watch ${example.title}`}
          >
            <span className="relative block aspect-video overflow-hidden bg-black">
              <Image
                src={example.poster}
                alt=""
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover transition-transform duration-700 group-hover:scale-[1.025]"
              />
              <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.02)_0%,rgba(0,0,0,0.64)_100%)]" />
              <span className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/35 bg-black/46 text-white shadow-[0_12px_42px_rgba(0,0,0,0.5)] backdrop-blur-sm transition-colors group-hover:border-[#F4D58D]/70 group-hover:text-[#F4D58D]">
                <Play size={22} fill="currentColor" />
              </span>
              <span className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-4">
                <span className="font-mono text-xs uppercase tracking-[0.22em] text-white/78">{example.title}</span>
                <span className="font-mono text-xs text-white/58">{example.duration}</span>
              </span>
            </span>
          </button>
        ))}
      </div>

      {selectedExample ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/86 px-4 py-8 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="landing-video-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedExample(null);
          }}
        >
          <div className="w-full max-w-6xl">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 id="landing-video-title" className="font-mono text-xs uppercase tracking-[0.24em] text-white/70">
                {selectedExample.title}
              </h3>
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/18 bg-white/8 text-white/72 transition-colors hover:border-white/40 hover:text-white"
                onClick={() => setSelectedExample(null)}
                aria-label="Close video"
              >
                <X size={18} />
              </button>
            </div>
            <div className="overflow-hidden border border-white/12 bg-black shadow-[0_28px_90px_rgba(0,0,0,0.62)]">
              <video
                key={selectedExample.src}
                src={selectedExample.src}
                poster={selectedExample.poster}
                width={1920}
                height={1080}
                className="aspect-video w-full bg-black object-contain"
                controls
                playsInline
                preload="metadata"
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
