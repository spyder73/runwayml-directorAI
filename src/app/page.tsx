'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Film, Smartphone } from 'lucide-react';

export default function Home() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const router = useRouter();

  const handleStart = async (mode: 'single_memory' | 'life_story') => {
    setIsSubmitting(true);
    
    try {
      const res = await fetch('/api/pipeline/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aspectRatio, mode }),
      });
      
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
      {/* Magic Starry Background with Nebula effect */}
      <div className="absolute inset-0 z-0 opacity-60 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-purple-900/20 rounded-full blur-[120px] mix-blend-screen"></div>
        <div className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] bg-amber-700/10 rounded-full blur-[150px] mix-blend-screen"></div>
        <div className="stars"></div>
        <div className="stars2"></div>
        <div className="stars3"></div>
      </div>

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
              exit={{ opacity: 0, y: -20, filter: "blur(10px)" }}
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

              <div className="flex flex-col md:flex-row justify-center gap-6 mt-8 w-full max-w-2xl mx-auto">
                <motion.button
                  onClick={() => handleStart('single_memory')}
                  whileHover={{ scale: 1.02, boxShadow: "0 0 50px rgba(56, 189, 248, 0.2)" }}
                  whileTap={{ scale: 0.98 }}
                  className="flex-1 px-8 py-10 bg-gradient-to-br from-blue-900/20 to-transparent border border-blue-500/30 hover:border-blue-400/50 rounded-3xl flex flex-col items-center gap-4 transition-all duration-300 group"
                >
                  <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center group-hover:bg-blue-500/30 transition-colors">
                    <Film size={28} className="text-blue-300" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-xl font-serif text-blue-100 mb-2">Generate a Video of a Memory</h3>
                    <p className="text-xs text-blue-200/50 font-mono uppercase tracking-wider">Fast & Focused</p>
                  </div>
                </motion.button>

                <motion.button
                  onClick={() => handleStart('life_story')}
                  whileHover={{ scale: 1.02, boxShadow: "0 0 50px rgba(251, 191, 36, 0.15)" }}
                  whileTap={{ scale: 0.98 }}
                  className="flex-1 px-8 py-10 bg-gradient-to-br from-amber-900/20 to-transparent border border-amber-500/30 hover:border-amber-400/50 rounded-3xl flex flex-col items-center gap-4 transition-all duration-300 group"
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
            </motion.div>
          ) : (
            <motion.div
              key="loading"
              initial={{ opacity: 0, filter: "blur(10px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
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

      <style dangerouslySetInnerHTML={{__html: `
        .stars, .stars2, .stars3 {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: transparent url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDBweCIgaGVpZ2h0PSI0MDBweCI+PGNpcmNsZSBjeD0iNTAiIGN5PSI1MCIgcj0iMC41IiBmaWxsPSIjZmZmIi8+PGNpcmNsZSBjeD0iMjAwIiBjeT0iMjAwIiByPSIwLjUiIGZpbGw9IiNmZmYiLz48Y2lyY2xlIGN4PSIzNTAiIGN5PSI1MCIgcj0iMC41IiBmaWxsPSIjZmZmIi8+PGNpcmNsZSBjeD0iMTUwIiBjeT0iMzUwIiByPSIwLjUiIGZpbGw9IiNmZmYiLz48L3N2Zz4=') repeat top center;
          z-index: 0;
        }
        .stars { animation: moveUp 100s linear infinite; }
        .stars2 { animation: moveUp 200s linear infinite; opacity: 0.5; background-size: 200px 200px; }
        .stars3 { animation: moveUp 300s linear infinite; opacity: 0.2; background-size: 600px 600px; }
        @keyframes moveUp {
          from { background-position: 0 0; }
          to { background-position: 0 -10000px; }
        }
      `}} />
    </main>
  );
}
