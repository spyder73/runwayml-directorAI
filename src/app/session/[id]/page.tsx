'use client';

import { useEffect, useState, use, useRef } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import RemotionPreview from '@/components/RemotionPreview';
import { Camera, Send, Film } from 'lucide-react';
import type { ChatHistoryRow, SceneRow, SessionRow } from '@/lib/types';

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const sessionId = resolvedParams.id;
  const [session, setSession] = useState<SessionRow | null>(null);
  const [scenes, setScenes] = useState<SceneRow[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatHistoryRow[]>([]);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const eventSource = new EventSource(`/api/pipeline/events?sessionId=${sessionId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.session) setSession(data.session);
        if (data.scenes) setScenes(data.scenes);
        if (data.chat_history) setChatHistory(data.chat_history);
      } catch (err) {
        console.error('Error parsing SSE data', err);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [sessionId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const handleSendMessage = async (e?: React.FormEvent, customMsg?: string) => {
    if (e) e.preventDefault();
    const msg = customMsg || message;
    if (!msg.trim()) return;

    // Optimistic UI update
    setChatHistory(prev => [
      ...prev,
      {
        id: `temp-${Date.now()}`,
        session_id: sessionId,
        role: 'user',
        content: msg,
        options: null,
        created_at: new Date().toISOString(),
      }
    ]);
    setMessage('');
    setIsSending(true);

    try {
      await fetch('/api/pipeline/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: msg }),
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsSending(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append('sessionId', sessionId);
    
    for (let i = 0; i < e.target.files.length; i++) {
      formData.append('files', e.target.files[i]);
    }

    try {
      await fetch('/api/pipeline/upload', {
        method: 'POST',
        body: formData,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!session) {
    return (
      <main className="min-h-screen bg-[#0A0A0F] text-white flex items-center justify-center font-mono">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-8 h-8 border-t-2 border-amber-200/50 rounded-full animate-spin"></div>
          <p className="animate-pulse tracking-widest text-white/50 uppercase text-xs">Entering the Studio...</p>
        </div>
      </main>
    );
  }

  const isChatPhase = ['INTERVIEW_ONBOARDING', 'INTERVIEW_PSYCH_PROFILE', 'INTERVIEW_DYNAMIC', 'PRE_PRODUCTION', 'AWAITING_SELFIE'].includes(session.status);

  return (
    <main className="min-h-screen bg-[#0A0A0F] text-white flex flex-col font-serif relative">
      {/* Cinematic Vignette */}
      <div className="fixed inset-0 pointer-events-none shadow-[inset_0_0_150px_rgba(0,0,0,0.9)] z-0"></div>
      
      {/* Top Header */}
      <header className="fixed top-0 left-0 right-0 p-6 flex justify-between items-center z-10 bg-gradient-to-b from-[#0A0A0F] to-transparent">
        <div className="flex items-center gap-3 text-white/40">
          <Film size={18} />
          <span className="font-mono text-xs uppercase tracking-[0.3em]">Lifestory</span>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-white/30 border border-white/10 px-3 py-1 rounded-full">
          {session.status.replace(/_/g, ' ')}
        </div>
      </header>

      <div className="flex-1 overflow-hidden relative z-1 flex flex-col pt-24 pb-32">
        {isChatPhase ? (
          <div className="flex-1 overflow-y-auto px-4 md:px-20 max-w-4xl mx-auto w-full flex flex-col gap-8 pb-10">
            {chatHistory.map((msg, idx) => (
              <motion.div
                key={msg.id || idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' ? (
                  <div className="flex gap-4 max-w-[85%]">
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0 border border-white/20">
                      <span className="font-serif italic text-amber-200 text-sm">D</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      <p className="text-white/80 text-xl leading-relaxed tracking-wide whitespace-pre-wrap">
                        {msg.content.split('\n').map((line, i) => {
                          const imageMatch = line.match(/\[(Mockup|Image):\s([^\]]+)\]/);
                          if (imageMatch) {
                            return (
                              <div key={i} className="mt-4 relative w-full max-w-sm aspect-video rounded-xl overflow-hidden border border-white/10">
                                <Image src={imageMatch[2]} alt={imageMatch[1]} fill className="object-cover" unoptimized />
                              </div>
                            );
                          }
                          return <span key={i} className="block mb-2">{line}</span>;
                        })}
                      </p>
                      
                      {/* Options Buttons */}
                      {msg.options && (
                        <div className="flex flex-wrap gap-2 mt-4">
                          {JSON.parse(msg.options).map((opt: string, optIdx: number) => (
                            <button
                              key={optIdx}
                              onClick={() => handleSendMessage(undefined, opt)}
                              className="px-4 py-2 bg-amber-900/30 hover:bg-amber-900/60 border border-amber-500/30 rounded-full text-amber-200 text-sm transition-colors text-left"
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-white/10 text-white px-6 py-4 rounded-2xl rounded-tr-sm max-w-[75%] border border-white/5">
                    <p className="text-lg whitespace-pre-wrap">
                       {msg.content.split('\n').map((line, i) => {
                          const imageMatch = line.match(/\[(Mockup|Image):\s([^\]]+)\]/);
                          if (imageMatch) {
                            return (
                              <div key={i} className="mt-2 relative w-64 aspect-video rounded-lg overflow-hidden border border-white/20">
                                <Image src={imageMatch[2]} alt={imageMatch[1]} fill className="object-cover" unoptimized />
                              </div>
                            );
                          }
                          return <span key={i} className="block">{line}</span>;
                        })}
                    </p>
                  </div>
                )}
              </motion.div>
            ))}
            
            {(isSending || isUploading) && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0 border border-white/20">
                  <span className="font-serif italic text-amber-200 text-sm">D</span>
                </div>
                <div className="flex items-center gap-1 text-white/30">
                   <div className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce"></div>
                   <div className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '0.2s'}}></div>
                   <div className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '0.4s'}}></div>
                </div>
              </motion.div>
            )}
            <div ref={chatEndRef} />
          </div>
        ) : (
          /* Production Phase */
          <div className="w-full max-w-5xl mx-auto px-6 mt-10">
            <h2 className="text-center font-serif text-3xl mb-12 tracking-widest text-amber-100">
               {session.status === 'GENERATING_FINAL_ASSETS' ? 'Synthesizing Memories...' : 'The Final Cut'}
            </h2>
            
             {session.status === 'COMPLETED' ? (
              <RemotionPreview scenes={scenes} />
            ) : (
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                 {scenes.length > 0 ? scenes.map((scene) => (
                   <div key={scene.id} className="bg-white/5 border border-white/10 p-4 rounded-lg flex flex-col gap-4">
                     <div className={`bg-black/50 border border-white/5 flex items-center justify-center relative overflow-hidden group ${session.aspect_ratio === '9:16' ? 'aspect-[9/16]' : 'aspect-video'}`}>
                       {scene.video_url && session.status === 'COMPLETED' ? (
                          <video src={scene.video_url} autoPlay loop muted playsInline className="w-full h-full object-cover" />
                       ) : scene.reference_image_url ? (
                          <Image
                            src={scene.reference_image_url}
                            alt="Scene ref"
                            fill
                            unoptimized
                            sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                            className="object-cover"
                          />
                       ) : (
                         <div className="flex flex-col items-center gap-2">
                           <div className="w-4 h-4 border-t border-amber-200/50 rounded-full animate-spin"></div>
                           <p className="text-[10px] text-white/30 font-mono tracking-widest uppercase">
                             Generating Image...
                           </p>
                         </div>
                       )}
                       
                       {/* Overlay loading state if image exists but video is still generating */}
                       {scene.reference_image_url && !scene.video_url && session.status === 'GENERATING_FINAL_ASSETS' && (
                         <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 backdrop-blur-sm">
                            <div className="w-6 h-6 border-t-2 border-amber-200/80 rounded-full animate-spin"></div>
                            <p className="text-[10px] text-amber-100/70 font-mono tracking-widest uppercase">
                              Rendering Video...
                            </p>
                         </div>
                       )}
                     </div>
                     <p className="text-xs font-mono text-white/50 line-clamp-3">{scene.narrator_text}</p>
                   </div>
                 )) : (
                   /* Skeleton loading for scenes before they are generated */
                   Array.from({ length: 3 }).map((_, idx) => (
                     <div key={idx} className="bg-white/5 border border-white/10 p-4 rounded-lg flex flex-col gap-4 animate-pulse">
                        <div className={`bg-white/5 rounded ${session.aspect_ratio === '9:16' ? 'aspect-[9/16]' : 'aspect-video'}`}></div>
                        <div className="h-3 bg-white/10 rounded w-3/4"></div>
                        <div className="h-3 bg-white/10 rounded w-1/2"></div>
                     </div>
                   ))
                 )}
               </div>
            )}
          </div>
        )}
      </div>

      {isChatPhase && (
        <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#0A0A0F] via-[#0A0A0F] to-transparent flex justify-center z-10">
          <form onSubmit={handleSendMessage} className="w-full max-w-3xl relative group">
            <input 
               type="file" 
               accept="image/*" 
               multiple 
               className="hidden" 
               ref={fileInputRef} 
               onChange={handleFileChange} 
            />
            <div className="absolute inset-y-0 left-4 flex items-center z-20">
               {(session.status === 'AWAITING_SELFIE' || session.status === 'PRE_PRODUCTION') && (
                  <button 
                     type="button" 
                     onClick={() => fileInputRef.current?.click()}
                     className="p-2 text-white/40 hover:text-white transition-colors bg-white/5 rounded-full"
                  >
                     <Camera size={20} />
                  </button>
               )}
            </div>
            <input
              autoFocus
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                session.status === 'AWAITING_SELFIE' 
                  ? "Upload a photo..." 
                  : session.status === 'PRE_PRODUCTION'
                    ? "Type a response or attach a photo..."
                    : "Type your response..."
              }
              className={`w-full bg-[#1A1A24]/80 border border-white/10 rounded-full py-4 ${
                 session.status === 'AWAITING_SELFIE' || session.status === 'PRE_PRODUCTION' ? 'pl-16' : 'pl-6'
              } pr-16 text-lg focus:outline-none focus:border-amber-200/30 transition-all font-serif placeholder:text-white/20 shadow-lg`}
              disabled={isSending || isUploading}
            />
            <button 
              type="submit"
              disabled={isSending || isUploading || !message.trim()}
              className="absolute inset-y-2 right-2 px-4 bg-white text-black rounded-full flex items-center justify-center disabled:opacity-30 disabled:bg-white/20 disabled:text-white transition-all hover:bg-amber-200"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
