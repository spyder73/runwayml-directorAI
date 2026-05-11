import Link from 'next/link';

type RegisterSearchParams = Promise<{
  error?: string;
}>;

function statusMessage(params: Awaited<RegisterSearchParams>) {
  if (params.error === 'exists') return 'An account with that email already exists.';
  if (params.error === 'password') return 'Use at least 8 characters for your password.';
  if (params.error === 'invalid-email') return 'Enter a valid email address.';
  if (params.error === 'server') return 'Registration is temporarily unavailable.';
  return null;
}

export default async function RegisterPage({ searchParams }: { searchParams: RegisterSearchParams }) {
  const params = await searchParams;
  const message = statusMessage(params);

  return (
    <main className="min-h-screen bg-[#0A0A0F] text-white flex items-center justify-center px-6">
      <section className="w-full max-w-sm space-y-8">
        <div className="space-y-3 text-center">
          <h1 className="text-4xl font-serif font-light tracking-wide">yourlifestory</h1>
          <p className="font-mono text-xs uppercase tracking-[0.32em] text-white/45">Create account</p>
        </div>

        {message && (
          <p className="border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
            {message}
          </p>
        )}

        <form action="/api/auth/register" method="post" className="space-y-4">
          <label className="block space-y-2">
            <span className="font-mono text-xs uppercase tracking-widest text-white/45">Email</span>
            <input
              required
              type="email"
              name="email"
              autoComplete="email"
              className="w-full border border-white/15 bg-white/5 px-4 py-3 text-white outline-none transition-colors focus:border-white/40"
            />
          </label>

          <label className="block space-y-2">
            <span className="font-mono text-xs uppercase tracking-widest text-white/45">Password</span>
            <input
              required
              minLength={8}
              type="password"
              name="password"
              autoComplete="new-password"
              className="w-full border border-white/15 bg-white/5 px-4 py-3 text-white outline-none transition-colors focus:border-white/40"
            />
          </label>

          <button
            type="submit"
            className="w-full border border-white/20 bg-white px-4 py-3 font-mono text-xs uppercase tracking-widest text-black transition-colors hover:bg-white/85"
          >
            Register
          </button>
        </form>

        <p className="text-center text-sm text-white/45">
          Already registered? <Link href="/login" className="text-white/80 hover:text-white">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
