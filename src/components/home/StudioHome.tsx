'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Film, Settings, Smartphone } from 'lucide-react';
import AmbientFractalBackground from '@/components/AmbientFractalBackground';
import SettingsModal from '@/components/session/SettingsModal';

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
    <main className="min-h-screen bg-[#0A0A0F] text-white overflow-hidden relative flex items-center justify-center">
      <AmbientFractalBackground intensity="landing" />

      <button
        type="button"
        onClick={() => setIsSettingsOpen(true)}
        className="fixed right-6 top-6 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        aria-label="Open settings"
        title="Generation settings"
      >
        <Settings size={18} />
      </button>

      <div className="z-10 w-full max-w-3xl px-6 flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-16"
        >
          <h1 className="text-5xl md:text-7xl font-light tracking-wider mb-4 font-serif text-white/90 drop-shadow-lg">
            Lifestory
          </h1>
          <p className="text-white/40 uppercase tracking-[0.4em] text-xs font-mono">
            Cinematic AI Documentary
          </p>
        </motion.div>

        <AnimatePresence mode="wait">
          {!isSubmitting ? (
            <motion.div
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -20, filter: 'blur(10px)' }}
              transition={{ duration: 0.8 }}
              className="w-full flex flex-col gap-10 items-center relative group"
            >
              <div className="flex justify-center gap-6">
                <button
                  type="button"
                  onClick={() => setAspectRatio('16:9')}
                  className={`flex items-center gap-3 px-6 py-3 rounded-full transition-colors border font-mono text-xs uppercase tracking-widest ${
                    aspectRatio === '16:9'
                      ? 'bg-white/10 border-white/30 text-white'
                      : 'bg-transparent border-white/5 text-white/40 hover:text-white/70'
                  }`}
                >
                  <Film size={16} /> Cinematic (16:9)
                </button>
                <button
                  type="button"
                  onClick={() => setAspectRatio('9:16')}
                  className={`flex items-center gap-3 px-6 py-3 rounded-full transition-colors border font-mono text-xs uppercase tracking-widest ${
                    aspectRatio === '9:16'
                      ? 'bg-white/10 border-white/30 text-white'
                      : 'bg-transparent border-white/5 text-white/40 hover:text-white/70'
                  }`}
                >
                  <Smartphone size={16} /> Vertical (9:16)
                </button>
              </div>

              <div className="mt-8 w-full max-w-md mx-auto">
                <motion.button
                  onClick={() => handleStart()}
                  whileHover={{ scale: 1.02, boxShadow: '0 0 50px rgba(251, 191, 36, 0.15)' }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full px-8 py-10 bg-gradient-to-br from-amber-900/20 to-transparent border border-amber-500/30 hover:border-amber-400/50 rounded-3xl flex flex-col items-center gap-4 transition-all duration-300 group"
                >
                  <div className="w-16 h-16 rounded-full bg-amber-500/20 flex items-center justify-center group-hover:bg-amber-500/30 transition-colors">
                    <Film size={28} className="text-amber-300" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-xl font-serif text-amber-100 mb-2">Describe Your Life Story</h3>
                    <p className="text-xs text-amber-200/50 font-mono uppercase tracking-wider">Takes 5-10 minutes</p>
                  </div>
                </motion.button>
              </div>

              {readiness && (
                <p className={`font-mono text-[10px] uppercase tracking-[0.28em] ${readiness.ok ? 'text-emerald-100/45' : 'text-amber-100/45'}`}>
                  {readiness.userMessage}
                </p>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="loading"
              initial={{ opacity: 0, filter: 'blur(10px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              className="text-center space-y-6 flex flex-col items-center"
            >
              <div className="w-16 h-16 relative flex items-center justify-center">
                <div className="absolute inset-0 border-t border-white/30 rounded-full animate-spin"></div>
                <div className="absolute inset-2 border-r border-amber-200/30 rounded-full animate-spin [animation-duration:1.5s] [animation-direction:reverse]"></div>
                <div className="w-2 h-2 bg-white rounded-full shadow-[0_0_15px_#fff] animate-pulse"></div>
              </div>
              <p className="text-sm text-white/50 uppercase tracking-[0.3em] font-mono animate-pulse">
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
