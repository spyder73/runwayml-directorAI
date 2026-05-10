import Link from 'next/link';
import { redirect } from 'next/navigation';

type VerifySearchParams = Promise<{
  token?: string;
}>;

export default async function VerifyEmailPage({ searchParams }: { searchParams: VerifySearchParams }) {
  const params = await searchParams;

  if (params.token) {
    redirect(`/api/auth/verify-email?token=${encodeURIComponent(params.token)}`);
  }

  return (
    <main className="min-h-screen bg-[#0A0A0F] text-white flex items-center justify-center px-6">
      <section className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-4xl font-serif font-light tracking-wide">Lifestory</h1>
        <p className="text-white/60">This verification link is missing its token.</p>
        <Link href="/login" className="inline-block border border-white/20 px-4 py-3 font-mono text-xs uppercase tracking-widest text-white/70 hover:text-white">
          Back to sign in
        </Link>
      </section>
    </main>
  );
}
