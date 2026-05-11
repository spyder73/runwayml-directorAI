'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Film, Play, Settings, Smartphone, Sparkles } from 'lucide-react';
import AmbientFractalBackground from '@/components/AmbientFractalBackground';
import SettingsModal from '@/components/session/SettingsModal';

const aspectOptions = [
  { value: '16:9' as const, label: 'Cinematic', ratio: '16:9', icon: Film },
  { value: '9:16' as const, label: 'Vertical', ratio: '9:16', icon: Smartphone },
];

export default function StudioHome() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [readiness, setReadiness] = useState<{ ok: boolean; userMessage: string } | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const router = useRouter();

  const redirectToLogin = () => {
    router.push(`/login?next=${encodeURIComponent('/')}`);
  };

  useEffect(() => {
    let cancelled = false;

    fetch('/api/pipeline/readiness')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && typeof data.userMessage === 'string') {
          setReadiness({ ok: Boolean(data.ok), userMessage: data.userMessage });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReadiness({ ok: false, userMessage: 'Studio is ready. Live generation needs setup.' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleStart = async () => {
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/pipeline/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aspectRatio }),
      });

      if (res.status === 401 || res.status === 403) {
        redirectToLogin();
        return;
      }

      const data = await res.json();
      if (res.ok && data.sessionId) {
        router.push(`/session/${data.sessionId}`);
      } else {
        console.error('Failed to start session', data);
        setIsSubmitting(false);
      }
    } catch (err) {
      console.error(err);
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#07070C] px-4 py-10 text-white sm:px-6">
      <AmbientFractalBackground intensity="landing" />

      <div className="pointer-events-none fixed inset-0 z-[1]" aria-hidden="true">
        <div className="lifestory-aurora absolute inset-0" />
        <div className="lifestory-stage-rays absolute inset-[-12%]" />
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/[0.06] to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/80 to-transparent" />
      </div>

      <button
        type="button"
        onClick={() => setIsSettingsOpen(true)}
        className="fixed right-5 top-5 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/35 text-white/60 shadow-[0_0_24px_rgba(255,255,255,0.08)] backdrop-blur-md transition-colors hover:border-white/25 hover:bg-white/10 hover:text-white sm:right-6 sm:top-6"
        aria-label="Open settings"
        title="Generation settings"
      >
        <Settings size={18} />
      </button>

      <div className="relative z-10 flex w-full max-w-4xl flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 28, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          className="mb-9 text-center sm:mb-11"
        >
          <div className="mb-5 inline-flex items-center gap-2 border-b border-amber-100/24 px-3 pb-2 font-mono text-[11px] uppercase text-amber-50/58">
            <Sparkles size={13} className="text-amber-100/72" />
            Live memoir cinema
          </div>
          <h1 className="bg-[linear-gradient(110deg,#fffaf0_8%,#f6e2b7_40%,#e5f6f7_66%,#fff_88%)] bg-clip-text font-serif text-6xl font-light leading-none text-transparent drop-shadow-[0_0_20px_rgba(246,226,183,0.13)] sm:text-7xl md:text-8xl">
            Lifestory
          </h1>
          <div className="mx-auto mt-5 h-px w-48 bg-gradient-to-r from-transparent via-amber-100/46 to-transparent" />
          <p className="mt-5 font-mono text-xs uppercase text-white/42">
            Cinematic AI Documentary
          </p>
        </motion.div>

        <AnimatePresence mode="wait">
          {!isSubmitting ? (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20, filter: 'blur(10px)' }}
              transition={{ duration: 0.8 }}
              className="relative flex w-full flex-col items-center gap-7"
            >
              <div className="flex w-full max-w-lg flex-col gap-2 rounded-full border border-white/10 bg-black/32 p-1.5 backdrop-blur-xl sm:flex-row">
                {aspectOptions.map((option) => {
                  const Icon = option.icon;
                  const isSelected = aspectRatio === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setAspectRatio(option.value)}
                      className={`relative flex min-h-12 flex-1 items-center justify-center gap-3 rounded-full border px-5 py-3 font-mono text-xs uppercase transition-all ${
                        isSelected
                          ? 'border-amber-100/30 bg-white/[0.11] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]'
                          : 'border-transparent bg-transparent text-white/42 hover:bg-white/[0.06] hover:text-white/72'
                      }`}
                    >
                      {isSelected && <span className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-amber-100/80 to-transparent" />}
                      <Icon size={16} />
                      <span>{option.label}</span>
                      <span className={isSelected ? 'text-amber-100/70' : 'text-white/34'}>{option.ratio}</span>
                    </button>
                  );
                })}
              </div>

              <div className="relative mx-auto mt-2 w-full max-w-lg">
                <div className="lifestory-portal-ring absolute inset-[-14px] opacity-70" aria-hidden="true" />
                <motion.button
                  onClick={() => handleStart()}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  className="group relative flex w-full overflow-hidden rounded-lg border border-amber-100/28 bg-[linear-gradient(145deg,rgba(239,219,176,0.12),rgba(8,8,14,0.88)_48%,rgba(168,218,220,0.08))] px-6 py-8 shadow-[0_22px_70px_rgba(0,0,0,0.48),0_0_42px_rgba(239,219,176,0.08)] transition-all duration-500 hover:border-amber-100/42 hover:shadow-[0_24px_74px_rgba(0,0,0,0.54),0_0_54px_rgba(239,219,176,0.12)] sm:px-8 sm:py-9"
                >
                  <span className="lifestory-button-sheen absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                  <span className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/46 to-transparent" />
                  <span className="absolute bottom-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-cyan-100/24 to-transparent" />

                  <span className="relative z-10 flex w-full flex-col items-center gap-5 text-center">
                    <span className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full border border-amber-100/22 bg-amber-100/[0.08] shadow-[0_0_32px_rgba(239,219,176,0.14)] transition-transform duration-500 group-hover:scale-105">
                      <span className="lifestory-icon-ring absolute inset-[-8px] rounded-full border border-white/10" />
                      <span className="absolute inset-3 rounded-full bg-amber-100/10 blur-md" />
                      <Film size={30} className="relative text-amber-100/88 drop-shadow-[0_0_10px_rgba(239,219,176,0.35)]" />
                    </span>

                    <span>
                      <span className="mb-2 block font-serif text-2xl font-light text-amber-50 sm:text-3xl">Describe Your Life Story</span>
                      <span className="block font-mono text-xs uppercase text-amber-100/46">Takes 5-10 minutes</span>
                    </span>

                    <span className="inline-flex items-center gap-2 border border-white/12 bg-white/[0.055] px-4 py-2 font-mono text-xs uppercase text-white/62 transition-colors group-hover:border-white/22 group-hover:text-white/84">
                      <Play size={14} fill="currentColor" />
                      Begin the interview
                    </span>
                  </span>
                </motion.button>
              </div>

              {readiness && (
                <p className={`font-mono text-[10px] uppercase ${readiness.ok ? 'text-emerald-100/52' : 'text-amber-100/52'}`}>
                  {readiness.userMessage}
                </p>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="loading"
              initial={{ opacity: 0, filter: 'blur(10px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              className="flex flex-col items-center space-y-6 text-center"
            >
              <div className="relative flex h-24 w-24 items-center justify-center">
                <div className="absolute inset-0 rounded-full border border-amber-100/18 shadow-[0_0_55px_rgba(251,191,36,0.18)]" />
                <div className="absolute inset-2 animate-spin rounded-full border-t border-cyan-100/42" />
                <div className="absolute inset-5 animate-spin rounded-full border-r border-amber-200/42 [animation-direction:reverse] [animation-duration:1.6s]" />
                <Sparkles size={24} className="text-amber-100 drop-shadow-[0_0_18px_rgba(251,191,36,0.8)]" />
              </div>
              <p className="animate-pulse font-mono text-sm uppercase text-white/58">
                Entering the Studio...
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <SettingsModal open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </main>
  );
}
