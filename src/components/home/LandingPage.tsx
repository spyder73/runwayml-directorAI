import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Film, Sparkles, WandSparkles } from 'lucide-react';
import AmbientFractalBackground from '@/components/AmbientFractalBackground';

type LandingPageProps = {
  appUrl: string;
};

const steps = [
  {
    icon: Sparkles,
    title: 'Tell the story',
    body: 'Start with the people, places, turning points, and small details that still feel alive when you say them out loud.',
  },
  {
    icon: WandSparkles,
    title: 'Shape the treatment',
    body: 'A warm director voice turns your answers into a film shape you can read, revise, and approve before anything gets made.',
  },
  {
    icon: Film,
    title: 'Watch the cut take form',
    body: 'Your scenes, narration, references, and final MP4 come together as a short film made to be kept close and shared well.',
  },
];

const memoryImages = [
  {
    src: '/landing/memory-detail.png',
    alt: 'A blue radio and family photos on a sunlit kitchen counter',
    title: 'It starts where real stories always start: a detail.',
    body: 'The blue radio. The summer kitchen. The way someone laughed before telling the same story again. Lifestory listens for the pieces that make a life feel unmistakably yours.',
  },
  {
    src: '/landing/director-desk.png',
    alt: 'Hands arranging old photographs beside a film editing desk',
    title: "Not a prompt box. A director's room.",
    body: 'You are not asked to engineer a perfect prompt. You talk through the memories, choose what feels true, and approve the film treatment before the story moves into scenes.',
  },
];

export default function LandingPage({ appUrl }: LandingPageProps) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#08080C] text-white">
      <AmbientFractalBackground intensity="landing" />

      <nav className="relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="font-serif text-2xl font-light tracking-wide text-white/92">
          Lifestory
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href={`${appUrl}/login`}
            className="px-3 py-2 text-sm text-white/68 transition-colors hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href={`${appUrl}/register`}
            className="inline-flex min-h-10 items-center gap-2 border border-white/18 bg-white px-4 py-2 font-mono text-xs uppercase tracking-widest text-black transition-colors hover:bg-[#F4D58D]"
          >
            Start <ArrowRight size={14} />
          </Link>
        </div>
      </nav>

      <section className="relative z-10 mx-auto min-h-[68svh] w-full max-w-6xl px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
        <div className="absolute inset-x-0 top-0 -z-10 h-full overflow-hidden border-y border-white/10">
          <Image
            src="/landing/hero.png"
            alt="A family gathered around old photos in warm projector light"
            fill
            priority
            sizes="100vw"
            className="object-cover object-center"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,8,12,0.96)_0%,rgba(8,8,12,0.72)_42%,rgba(8,8,12,0.18)_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,8,12,0.18)_0%,rgba(8,8,12,0.08)_58%,rgba(8,8,12,0.9)_100%)]" />
        </div>

        <div className="flex min-h-[58svh] max-w-3xl flex-col justify-center">
          <p className="mb-6 font-mono text-xs uppercase tracking-[0.28em] text-[#F4D58D]/78">
            A short film from a life only you can tell
          </p>
          <h1 className="max-w-4xl font-serif text-6xl font-light leading-[0.92] tracking-normal text-white sm:text-7xl lg:text-8xl">
            Lifestory
          </h1>
          <p className="mt-7 max-w-2xl text-xl leading-8 text-white/78 sm:text-2xl sm:leading-9">
            Tell it the way you remember it: the kitchen light, the street you grew up on,
            the laugh everyone still quotes. Lifestory turns those details into a cinematic
            memoir you can watch, share, and keep.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link
              href={`${appUrl}/register`}
              className="inline-flex min-h-14 items-center justify-center gap-3 border border-white bg-white px-6 py-4 font-mono text-xs uppercase tracking-widest text-black transition-colors hover:bg-[#F4D58D]"
            >
              Start your film <ArrowRight size={16} />
            </Link>
            <Link
              href={`${appUrl}/login`}
              className="inline-flex min-h-14 items-center justify-center gap-3 border border-white/22 bg-black/22 px-6 py-4 font-mono text-xs uppercase tracking-widest text-white/78 backdrop-blur-sm transition-colors hover:border-white/44 hover:text-white"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <section className="relative z-10 bg-[#11100D] px-5 py-14 sm:px-8">
        <div className="mx-auto grid w-full max-w-6xl gap-8 md:grid-cols-[0.88fr_1.12fr] md:items-end">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#9ED8C9]/62">The invitation</p>
            <h2 className="mt-4 max-w-2xl font-serif text-4xl font-light leading-tight text-white/92 sm:text-5xl">
              Your life already has the scenes. The film is waiting for a way in.
            </h2>
          </div>
          <p className="max-w-2xl text-lg leading-8 text-white/62">
            Lifestory is for the stories that feel too good to leave in a camera roll:
            a childhood street, a parent&apos;s kitchen, a first apartment, a goodbye, a comeback,
            the little rituals that somehow explain everything.
          </p>
        </div>
      </section>

      <section className="relative z-10 bg-[#0B0B11] px-5 py-16 sm:px-8">
        <div className="mx-auto grid w-full max-w-6xl gap-12">
          {memoryImages.map((memory, index) => (
            <article
              key={memory.title}
              className="grid gap-8 md:grid-cols-2 md:items-center"
            >
              <div className={index % 2 === 1 ? 'md:order-2' : ''}>
                <div className="relative aspect-[3/2] overflow-hidden border border-white/10">
                  <Image
                    src={memory.src}
                    alt={memory.alt}
                    fill
                    sizes="(max-width: 768px) 100vw, 50vw"
                    className="object-cover"
                  />
                </div>
              </div>
              <div className="max-w-xl">
                <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#F4D58D]/58">
                  {index === 0 ? 'Memory becomes cinema' : 'Guided, not generic'}
                </p>
                <h2 className="mt-4 font-serif text-4xl font-light leading-tight text-white/92 sm:text-5xl">
                  {memory.title}
                </h2>
                <p className="mt-5 text-lg leading-8 text-white/64">{memory.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="relative z-10 border-y border-white/10 bg-[#15100D] px-5 py-14 sm:px-8">
        <div className="mx-auto grid w-full max-w-6xl gap-6 md:grid-cols-3">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <article key={step.title} className="border border-white/10 bg-white/[0.035] p-6">
                <Icon className="mb-6 text-[#F4D58D]/78" size={24} />
                <h2 className="font-serif text-2xl font-light text-white/92">{step.title}</h2>
                <p className="mt-4 text-sm leading-6 text-white/58">{step.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="relative z-10 bg-[#08080C] px-5 py-16 sm:px-8">
        <div className="mx-auto grid w-full max-w-6xl gap-10 md:grid-cols-[1.05fr_0.95fr] md:items-center">
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#D98B70]/70">The keepsake</p>
            <h2 className="mt-4 font-serif text-5xl font-light leading-tight text-white/94 sm:text-6xl">
              Give your memories a screen.
            </h2>
            <p className="mt-6 text-lg leading-8 text-white/62">
              Make the short film you wish already existed. Start with a few real details,
              then let Lifestory help you shape them into something your people can gather around.
            </p>
            <Link
              href={`${appUrl}/register`}
              className="mt-9 inline-flex min-h-14 items-center justify-center gap-3 border border-white bg-white px-6 py-4 font-mono text-xs uppercase tracking-widest text-black transition-colors hover:bg-[#F4D58D]"
            >
              Create your film <ArrowRight size={16} />
            </Link>
          </div>
          <div className="relative aspect-[16/10] overflow-hidden border border-white/10">
            <Image
              src="/landing/final-screening.png"
              alt="A family watching a personal film projected in a cozy living room"
              fill
              sizes="(max-width: 768px) 100vw, 45vw"
              className="object-cover"
            />
          </div>
        </div>
      </section>
    </main>
  );
}
