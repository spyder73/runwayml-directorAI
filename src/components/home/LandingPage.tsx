import Link from 'next/link';
import { ArrowRight, Film, LockKeyhole, Sparkles, WandSparkles } from 'lucide-react';
import AmbientFractalBackground from '@/components/AmbientFractalBackground';

type LandingPageProps = {
  appUrl: string;
};

const steps = [
  {
    icon: Sparkles,
    title: 'Tell your life story',
    body: 'Begin with the people, places, chapters, and turning points that shaped you. The director asks for the details that make each scene feel lived in.',
  },
  {
    icon: WandSparkles,
    title: 'Shape the treatment',
    body: 'Your answers become a cinematic outline with scenes, narration, visual references, and a clear review step.',
  },
  {
    icon: Film,
    title: 'Render the film',
    body: 'Generate images, motion, narration, and a final MP4 you can download when the cut feels right.',
  },
];

export default function LandingPage({ appUrl }: LandingPageProps) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#09090E] text-white">
      <AmbientFractalBackground intensity="landing" />

      <nav className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="font-serif text-2xl font-light tracking-wide text-white/90">
          Lifestory
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href={`${appUrl}/login`}
            className="px-3 py-2 text-sm text-white/62 transition-colors hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href={`${appUrl}/register`}
            className="inline-flex items-center gap-2 border border-white/18 bg-white px-4 py-2 font-mono text-xs uppercase tracking-widest text-black transition-colors hover:bg-white/84"
          >
            Start <ArrowRight size={14} />
          </Link>
        </div>
      </nav>

      <section className="relative z-10 mx-auto flex min-h-[78svh] w-full max-w-6xl flex-col justify-center px-5 pb-16 pt-12 sm:px-8 lg:min-h-[80svh]">
        <div className="max-w-4xl">
          <p className="mb-6 font-mono text-xs uppercase tracking-[0.32em] text-amber-100/58">
            Private cinematic memoir studio
          </p>
          <h1 className="max-w-4xl font-serif text-5xl font-light leading-[0.96] tracking-normal text-white/94 sm:text-7xl lg:text-8xl">
            Lifestory
          </h1>
          <p className="mt-7 max-w-2xl text-xl leading-8 text-white/70 sm:text-2xl sm:leading-9">
            Cinema from the life you&apos;ve already lived. Turn memories, people, places, and old photos into a short documentary film.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link
              href={`${appUrl}/register`}
              className="inline-flex items-center justify-center gap-3 border border-white bg-white px-6 py-4 font-mono text-xs uppercase tracking-widest text-black transition-colors hover:bg-white/84"
            >
              Create your film <ArrowRight size={16} />
            </Link>
            <Link
              href={`${appUrl}/login`}
              className="inline-flex items-center justify-center gap-3 border border-white/16 bg-white/6 px-6 py-4 font-mono text-xs uppercase tracking-widest text-white/72 transition-colors hover:border-white/32 hover:text-white"
            >
              Open the app
            </Link>
          </div>
        </div>
      </section>

      <section className="relative z-10 border-t border-white/10 bg-[#0B0B11]/88 px-5 py-14 backdrop-blur-sm sm:px-8">
        <div className="mx-auto grid w-full max-w-6xl gap-6 md:grid-cols-3">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <article key={step.title} className="border border-white/10 bg-white/[0.035] p-6">
                <Icon className="mb-6 text-amber-100/76" size={24} />
                <h2 className="font-serif text-2xl font-light text-white/90">{step.title}</h2>
                <p className="mt-4 text-sm leading-6 text-white/58">{step.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="relative z-10 bg-[#101016] px-5 py-16 sm:px-8">
        <div className="mx-auto grid w-full max-w-6xl gap-10 md:grid-cols-[0.9fr_1.1fr] md:items-center">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-white/40">How it feels</p>
            <h2 className="mt-4 font-serif text-4xl font-light leading-tight text-white/90 sm:text-5xl">
              Your memories become scenes, not prompts.
            </h2>
          </div>
          <div className="grid gap-3">
            <div className="border border-white/10 bg-white/[0.035] p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sky-100/48">Scene 03</p>
              <p className="mt-3 text-lg leading-7 text-white/76">A summer kitchen, a parent&apos;s laugh, the blue radio on the counter.</p>
            </div>
            <div className="border border-white/10 bg-white/[0.035] p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-amber-100/48">Narration</p>
              <p className="mt-3 text-lg leading-7 text-white/76">Those details become voiceover, then a shot plan, then a film you can keep.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 border-t border-white/10 bg-[#08080C] px-5 py-16 sm:px-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <LockKeyhole className="mb-6 text-emerald-100/70" size={26} />
            <h2 className="font-serif text-4xl font-light text-white/90">Private by design.</h2>
            <p className="mt-5 text-base leading-7 text-white/62">
              Your account owns its media, uploads are served through authenticated routes, and your generation keys stay encrypted.
            </p>
          </div>
          <Link
            href={`${appUrl}/register`}
            className="inline-flex items-center justify-center gap-3 border border-white bg-white px-6 py-4 font-mono text-xs uppercase tracking-widest text-black transition-colors hover:bg-white/84"
          >
            Begin <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </main>
  );
}
