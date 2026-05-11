import Link from 'next/link';

type LoginSearchParams = Promise<{
  registered?: string;
  verified?: string;
  error?: string;
}>;

function statusMessage(params: Awaited<LoginSearchParams>) {
  if (params.registered === '1') return 'Check your email to confirm your account before logging in.';
  if (params.verified === 'invalid') return 'That verification link is invalid or expired.';
  if (params.error === 'confirm-email') return 'Please confirm your email before logging in.';
  if (params.error === 'invalid') return 'Invalid email or password.';
  return null;
}

function shouldShowResendConfirmation(params: Awaited<LoginSearchParams>) {
  return params.registered === '1' || params.verified === 'invalid' || params.error === 'confirm-email';
}

export default async function LoginPage({ searchParams }: { searchParams: LoginSearchParams }) {
  const params = await searchParams;
  const message = statusMessage(params);
  const showResendConfirmation = shouldShowResendConfirmation(params);

  return (
    <main className="min-h-screen bg-[#0A0A0F] text-white flex items-center justify-center px-6">
      <section className="w-full max-w-sm space-y-8">
        <div className="space-y-3 text-center">
          <h1 className="text-4xl font-serif font-light tracking-wide">yourlifestory</h1>
          <p className="font-mono text-xs uppercase tracking-[0.32em] text-white/45">Sign in</p>
        </div>

        {message && (
          <p className="border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
            {message}
          </p>
        )}

        <form action="/api/auth/login" method="post" className="space-y-4">
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
              autoComplete="current-password"
              className="w-full border border-white/15 bg-white/5 px-4 py-3 text-white outline-none transition-colors focus:border-white/40"
            />
          </label>

          <button
            type="submit"
            className="w-full border border-white/20 bg-white px-4 py-3 font-mono text-xs uppercase tracking-widest text-black transition-colors hover:bg-white/85"
          >
            Sign in
          </button>
        </form>

        {showResendConfirmation && (
          <form action="/api/auth/resend-verification" method="post" className="space-y-3 border-t border-white/10 pt-6">
            <label className="block space-y-2">
              <span className="font-mono text-xs uppercase tracking-widest text-white/45">Resend confirmation</span>
              <input
                required
                type="email"
                name="email"
                autoComplete="email"
                className="w-full border border-white/15 bg-white/5 px-4 py-3 text-white outline-none transition-colors focus:border-white/40"
              />
            </label>
            <button
              type="submit"
              className="w-full border border-white/15 px-4 py-3 font-mono text-xs uppercase tracking-widest text-white/70 transition-colors hover:border-white/35 hover:text-white"
            >
              Send link
            </button>
          </form>
        )}

        <p className="text-center text-sm text-white/45">
          New here? <Link href="/register" className="text-white/80 hover:text-white">Create an account</Link>
        </p>
      </section>
    </main>
  );
}
