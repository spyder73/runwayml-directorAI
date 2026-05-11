import Link from 'next/link';
import { Download, Film, Loader2 } from 'lucide-react';
import db from '@/lib/db';
import type { SessionRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function RenderFinishedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  const isReady = session?.status === 'COMPLETED' && Boolean(session.final_video_url);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#08080C] px-5 py-12 text-white">
      <section className="w-full max-w-xl rounded-lg border border-white/12 bg-white/[0.045] p-6 text-center shadow-[0_26px_90px_rgba(0,0,0,0.42)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-amber-100/20 bg-amber-100/10 text-amber-100">
          {isReady ? <Film size={22} /> : <Loader2 size={22} className="animate-spin" />}
        </div>
        <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.3em] text-amber-100/45">
          Render finished
        </p>
        <h1 className="mt-3 font-serif text-4xl text-amber-50">
          {isReady ? 'Your film is ready' : 'Your film is still rendering'}
        </h1>
        <p className="mx-auto mt-4 max-w-md font-sans text-sm leading-6 text-white/58">
          {isReady
            ? 'The final cut is ready to download. Keep this page around if you want to come back to it later.'
            : 'Nico has the studio working on it. This page will be ready once the final render is complete.'}
        </p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {isReady ? (
            <a
              href={session.final_video_url || '#'}
              download
              className="inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-white px-6 py-3 font-mono text-xs font-bold uppercase tracking-widest text-black transition-colors hover:bg-amber-100"
            >
              <Download size={16} />
              Download film
            </a>
          ) : null}
          <Link
            href={`/session/${id}`}
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/14 px-6 py-3 font-mono text-xs uppercase tracking-widest text-white/70 transition-colors hover:border-white/28 hover:text-white"
          >
            View progress
          </Link>
        </div>
      </section>
    </main>
  );
}
