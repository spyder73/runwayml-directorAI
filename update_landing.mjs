import fs from 'fs';

let content = fs.readFileSync('src/components/home/LandingPage.tsx', 'utf8');

const heroSectionRegex = /(<section className="relative z-10 mx-auto min-h-\[68svh\].*?<\/section>)/s;
const exampleVideoRegex = /(\s*<section className="relative z-10 bg-\[#0A0A0E\].*?<\/section>)/s;
const welcomeVideoRegex = /(\s*<section className="relative z-10 bg-\[#0E1013\].*?<\/section>)/s;
const directorStudioRegex = /(\s*<section className="relative z-10 bg-\[#11100D\].*?<\/section>)/s;
const memoryImagesRegex = /(\s*<section className="relative z-10 bg-\[#0B0B11\].*?<\/section>)/s;

let exampleMatch = content.match(exampleVideoRegex);
let welcomeMatch = content.match(welcomeVideoRegex);

if (exampleMatch && welcomeMatch) {
  // Remove example and welcome from current positions
  content = content.replace(exampleVideoRegex, '');
  content = content.replace(welcomeVideoRegex, '');

  const originalWelcomeSection = `\n      <section className="relative z-10 bg-[#0E1013] px-5 py-16 sm:px-8">
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
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#F4D58D]/62">Watch first</p>
            <h2 className="mt-4 font-serif text-4xl font-light leading-tight text-white/92 sm:text-5xl">
              Nico will show you where to begin.
            </h2>
            <p className="mt-5 text-lg leading-8 text-white/64">
              Start with the welcome, then create your account and step into the studio when you are ready.
            </p>
            <Link
              href={\`\${appUrl}/register\`}
              className="mt-8 inline-flex min-h-14 items-center justify-center gap-3 border border-[#F4D58D] bg-[#F4D58D] px-6 py-4 font-mono text-xs uppercase tracking-widest text-black transition-colors hover:bg-white hover:border-white"
            >
              Register now <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>`;

  const newExampleVideoSection = `\n      <section className="relative z-10 bg-[#0A0A0E] px-5 py-20 sm:px-8 border-b border-white/5">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center">
          <h2 className="mb-10 text-center font-serif text-4xl font-light leading-tight text-white/92 sm:text-5xl">
            yourlifestory.io - Your Life as a Movie.
          </h2>
          <div className="w-full border border-white/10 bg-black/50 p-1 shadow-2xl">
            <div className="relative aspect-video overflow-hidden bg-black">
              <video
                src="/landing/videos/example.mp4"
                width={1920}
                height={1080}
                className="absolute inset-0 w-full h-full object-cover"
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
      </section>`;

  // Insert Welcome right after Hero
  content = content.replace(heroSectionRegex, `$1${originalWelcomeSection}`);

  // Insert Example right after Memory Images (which contains "Not a prompt box")
  content = content.replace(memoryImagesRegex, `$1${newExampleVideoSection}`);

  fs.writeFileSync('src/components/home/LandingPage.tsx', content);
  console.log('Update complete.');
} else {
  console.log('Could not find sections.');
}
