import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Clapperboard,
  Film,
  Infinity,
  MessageCircle,
  Play,
} from 'lucide-react';
import AmbientFractalBackground from '@/components/AmbientFractalBackground';

type LandingPageProps = {
  appUrl: string;
};

const proofPoints = [
  'Tell it anything: childhood, migration, grief, love, survival, reinvention.',
  'Nico interviews you like a film director, then builds a treatment you can approve.',
  'RunwayML generates cinematic scenes. Modal powers the heavy rendering work behind the cut.',
];

const steps = [
  {
    icon: MessageCircle,
    title: 'Tell the life, not a prompt',
    body: 'Talk naturally about the people, places, turning points, and fragments that made you. The studio pulls the movie out of the details.',
  },
  {
    icon: Clapperboard,
    title: 'Shape the film before it renders',
    body: 'Review the narration, scene outline, and visual direction before the system moves into production.',
  },
  {
    icon: Film,
    title: 'Receive a narrated cinematic movie',
    body: 'Your approved story becomes scenes, voice, music, pacing, and a final MP4 built around a life nobody else could have lived.',
  },
];

const memoryImages = [
  {
    src: '/landing/memory-detail.png',
    alt: 'A blue radio and family photos on a sunlit kitchen counter',
    eyebrow: 'Personal detail',
    title: 'The movie starts where your memory still has texture.',
    body: 'A kitchen light. A street corner. A voice you can still hear. yourlifestory is built to catch the details that make a film feel personal instead of generated.',
  },
  {
    src: '/landing/director-desk.png',
    alt: 'A film editing desk with photographs arranged beside a notebook',
    eyebrow: 'Guided production',
    title: 'You do not need to know how to make films.',
    body: 'Nico asks the questions, organizes the material, writes the treatment, plans the scenes, and keeps you in control before the final movie is made.',
  },
];

export default function LandingPage({ appUrl }: LandingPageProps) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#08080C] text-white">
      <AmbientFractalBackground intensity="landing" />

      <nav className="relative z-20 mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link href="/" className="font-serif text-2xl font-light tracking-wide text-white/92">
          yourlifestory
        </Link>
        <div className="order-3 flex w-full justify-start sm:order-none sm:w-auto sm:justify-center">
          <div className="inline-flex items-center gap-2 border border-white/12 bg-white/[0.045] px-3 py-2 font-mono text-[0.64rem] uppercase tracking-[0.22em] text-white/68 backdrop-blur-md">
            <span>Powered by</span>
            <span className="text-runway">RunwayML</span>
            <span className="text-white/28">+</span>
            <span className="text-[#9ED8C9]">Modal</span>
          </div>
        </div>
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

      <section className="relative z-10 mx-auto min-h-[76svh] w-full max-w-6xl px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
        <div className="absolute inset-x-0 top-0 -z-10 h-full overflow-hidden border-y border-white/10">
          <Image
            src="/landing/hero.png"
            alt="A cinematic family memory scene in warm projector light"
            fill
            priority
            sizes="100vw"
            className="object-cover object-center"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,8,12,0.97)_0%,rgba(8,8,12,0.74)_42%,rgba(8,8,12,0.2)_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,8,12,0.12)_0%,rgba(8,8,12,0.1)_58%,rgba(8,8,12,0.96)_100%)]" />
          <div className="lifestory-stage-rays absolute inset-0" />
        </div>

        <div className="flex min-h-[62svh] max-w-4xl flex-col justify-center">
          <p className="mb-6 inline-flex w-fit items-center gap-2 border border-[#F4D58D]/24 bg-black/24 px-3 py-2 font-mono text-xs uppercase tracking-[0.28em] text-[#F4D58D]/82 backdrop-blur-sm">
            <Infinity size={14} /> No boundaries
          </p>
          <h1 className="lifestory-soft-reveal max-w-5xl font-serif text-6xl font-light leading-[0.92] tracking-normal text-white sm:text-7xl lg:text-8xl">
            Your life story can become a narrated cinematic movie.
          </h1>
          <p className="mt-7 max-w-2xl text-xl leading-8 text-white/78 sm:text-2xl sm:leading-9">
            Everyone has a film inside their life. Tell yourlifestory what happened, who mattered,
            what changed you, and what still feels unfinished. The studio turns it into a guided
            treatment, cinematic scenes, narration, and a finished movie made from your truth.
          </p>
          <div className="mt-9 grid max-w-3xl gap-3 sm:grid-cols-3">
            {proofPoints.map((point) => (
              <div key={point} className="border border-white/10 bg-black/24 p-4 backdrop-blur-sm">
                <BadgeCheck className="mb-3 text-[#9ED8C9]" size={18} />
                <p className="text-sm leading-6 text-white/68">{point}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link
              href={`${appUrl}/register`}
              className="relative inline-flex min-h-14 items-center justify-center gap-3 overflow-hidden border border-[#F4D58D] bg-[#F4D58D] px-6 py-4 font-mono text-xs uppercase tracking-widest text-black transition-colors hover:border-white hover:bg-white"
            >
              <span className="lifestory-button-sheen absolute inset-0" />
              <span className="relative inline-flex items-center gap-3">
                Make your movie <ArrowRight size={16} />
              </span>
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

      <section className="relative z-10 bg-[#0E1013] px-5 py-16 sm:px-8">
        <div className="mx-auto grid w-full max-w-6xl gap-10 md:grid-cols-[minmax(20rem,38rem)_1fr] md:items-center">
          <div className="mx-auto w-full max-w-[min(88vw,38rem)] border border-[#4A3420]/80 bg-black p-1 shadow-[0_28px_90px_rgba(0,0,0,0.46)]">
            <div className="relative aspect-video overflow-hidden bg-black">
              <video
                src="/landing/videos/Welcome.mp4"
                width={1080}
                height={1920}
                className="absolute left-0 top-1/2 w-full -translate-y-1/2 bg-black"
                autoPlay
                muted
                loop
                playsInline
                controls
                preload="metadata"
                aria-label="Welcome introduction to yourlifestory"
              />
            </div>
          </div>
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#F4D58D]/62">
              Meet your director
            </p>
            <h2 className="mt-4 font-serif text-4xl font-light leading-tight text-white/92 sm:text-5xl">
              Nico helps you turn a lifetime into scenes people can feel.
            </h2>
            <p className="mt-5 text-lg leading-8 text-white/64">
              The welcome video shows the tone of the studio: personal, cinematic, and direct.
              When you enter, Nico interviews you, finds the emotional thread, and helps build the
              film around what actually matters.
            </p>
            <Link
              href={`${appUrl}/register`}
              className="mt-8 inline-flex min-h-14 items-center justify-center gap-3 border border-[#F4D58D] bg-[#F4D58D] px-6 py-4 font-mono text-xs uppercase tracking-widest text-black transition-colors hover:border-white hover:bg-white"
            >
              Enter the studio <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <section className="relative z-10 bg-[#11100D] px-5 py-14 sm:px-8">
        <div className="mx-auto grid w-full max-w-6xl gap-10 md:grid-cols-[0.9fr_1.1fr] md:items-center">
          <div className="relative aspect-[4/5] overflow-hidden border border-white/10 md:aspect-[3/4]">
            <Image
              src="/landing/director-studio.png"
              alt="Nico Hale seated in a warm cinematic studio"
              fill
              sizes="(max-width: 768px) 100vw, 38vw"
              className="object-cover object-[50%_30%]"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_48%,rgba(8,8,12,0.64)_100%)]" />
            <div className="lifestory-portal-ring absolute inset-5" />
          </div>
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#9ED8C9]/62">
              Cinematic life-story studio
            </p>
            <h2 className="mt-4 max-w-2xl font-serif text-4xl font-light leading-tight text-white/92 sm:text-5xl">
              Not a slideshow. Not a generic AI montage. A movie built around your life.
            </h2>
            <p className="mt-6 text-lg leading-8 text-white/62">
              This is for the story you have carried for years, the person you want remembered, or
              the chapter you need to see from the outside. There is no narrow template to fit into.
              If it belongs to your life, it can belong in the film.
            </p>
            <p className="mt-5 font-mono text-xs uppercase tracking-[0.24em] text-[#F4D58D]/58">
              A narrated cinematic movie from a life only you can tell
            </p>
          </div>
        </div>
      </section>

      <section className="relative z-10 bg-[#0B0B11] px-5 py-16 sm:px-8">
        <div className="mx-auto grid w-full max-w-6xl gap-12">
          {memoryImages.map((memory, index) => (
            <article key={memory.title} className="grid gap-8 md:grid-cols-2 md:items-center">
              <div className={index % 2 === 1 ? 'md:order-2' : ''}>
                <div className="relative aspect-[3/2] overflow-hidden border border-white/10">
                  <Image
                    src={memory.src}
                    alt={memory.alt}
                    fill
                    sizes="(max-width: 768px) 100vw, 50vw"
                    className="object-cover transition-transform duration-700 hover:scale-[1.03]"
                  />
                </div>
              </div>
              <div className="max-w-xl">
                <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#F4D58D]/58">
                  {memory.eyebrow}
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

      <section className="relative z-10 border-b border-white/5 bg-[#0A0A0E] px-5 py-20 sm:px-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center">
          <p className="mb-4 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.28em] text-[#D98B70]/70">
            <Play size={14} /> Finished-film example
          </p>
          <h2 className="mb-10 text-center font-serif text-4xl font-light leading-tight text-white/92 sm:text-5xl">
            See how a personal story can feel on screen.
          </h2>
          <div className="w-full border border-white/10 bg-black/50 p-1 shadow-2xl">
            <div className="relative aspect-video overflow-hidden bg-black">
              <video
                src="/landing/videos/example.mp4"
                width={1920}
                height={1080}
                className="absolute inset-0 h-full w-full object-cover"
                autoPlay
                muted
                loop
                playsInline
                controls
                preload="metadata"
                aria-label="Example of a finished short film"
              />
            </div>
          </div>
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
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#D98B70]/70">
              The keepsake
            </p>
            <h2 className="mt-4 font-serif text-5xl font-light leading-tight text-white/94 sm:text-6xl">
              Make the movie your family wishes already existed.
            </h2>
            <p className="mt-6 text-lg leading-8 text-white/62">
              Start with the truth. Add the names, places, choices, losses, jokes, regrets, and
              impossible little details. yourlifestory turns them into a cinematic artifact that can
              be kept, shared, and watched together.
            </p>
            <Link
              href={`${appUrl}/register`}
              className="mt-9 inline-flex min-h-14 items-center justify-center gap-3 border border-[#F4D58D] bg-[#F4D58D] px-6 py-4 font-mono text-xs uppercase tracking-widest text-black transition-colors hover:border-white hover:bg-white"
            >
              Create your movie <ArrowRight size={16} />
            </Link>
          </div>
          <div className="relative aspect-[16/10] overflow-hidden border border-white/10">
            <Image
              src="/landing/final-screening.png"
              alt="A family watching a personal film projection together"
              fill
              sizes="(max-width: 768px) 100vw, 45vw"
              className="object-cover"
            />
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/10 bg-[#08080C] px-5 py-10 sm:px-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/40">
            yourlifestory.io - narrated cinematic movies from real lives
          </p>
          <a
            href="https://instagram.com/yourlifestory.io"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-white/40 transition-colors hover:text-white/80"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
              <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
            </svg>
            <span className="font-mono text-xs tracking-wider">@yourlifestory.io</span>
          </a>
        </div>
      </footer>
    </main>
  );
}
