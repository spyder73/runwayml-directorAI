'use client';

import { useEffect, useState, use, useRef } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import RemotionPreview from '@/components/RemotionPreview';
import { Camera, Send, Film, X, UploadCloud, Play, Download } from 'lucide-react';
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
  
  // Fullscreen Modal State
  const [modalImage, setModalImage] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

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

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append('sessionId', sessionId);
    
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    uploadFiles(e.target.files);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
      e.dataTransfer.clearData();
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleApproveMemories = async () => {
    try {
      await fetch('/api/pipeline/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleRenderFinal = async () => {
    try {
      await fetch('/api/pipeline/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const renderMessageContent = (content: string) => {
    if (content === 'trying to generate an image of your memory..') {
      return (
        <div className="flex items-center gap-3 text-white/50 italic text-sm">
           <div className="w-4 h-4 border-t border-amber-200/50 rounded-full animate-spin"></div>
           trying to generate an image of your memory..
        </div>
      );
    }

    const elements: React.ReactNode[] = [];
    const lines = content.split('\n');
    
    lines.forEach((line, i) => {
      const imageMatch = line.match(/\[(Mockup|Image):\s([^\]]+)\]/);
      if (imageMatch) {
        elements.push(
          <div key={`img-${i}`} className="mt-4 mb-4 relative w-full max-w-sm aspect-video rounded-xl overflow-hidden border border-white/10 cursor-pointer group" onClick={() => setModalImage(imageMatch[2])}>
            <Image src={imageMatch[2]} alt={imageMatch[1]} fill className="object-cover transition-transform duration-500 group-hover:scale-105" unoptimized />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
               <span className="bg-black/50 text-white px-3 py-1 rounded-full text-xs font-mono backdrop-blur-sm">Click to expand</span>
            </div>
          </div>
        );
      } else if (line.trim()) {
        elements.push(<span key={`text-${i}`} className="block mb-2">{line}</span>);
      }
    });

    return elements;
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
      <header className="fixed top-0 left-0 right-0 p-6 flex justify-between items-center z-10 bg-gradient-to-b from-[#0A0A0F] to-transparent pointer-events-none">
        <div className="flex items-center gap-3 text-white/40">
          <Film size={18} />
          <span className="font-mono text-xs uppercase tracking-[0.3em]">Lifestory</span>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-amber-200/50 border border-amber-200/20 bg-amber-900/10 px-3 py-1 rounded-full backdrop-blur-md">
          {session.status.replace(/_/g, ' ')}
        </div>
      </header>

      <div className="flex-1 overflow-hidden relative z-1 flex flex-col pt-24 pb-32">
        {isChatPhase ? (
          <div className="flex-1 overflow-y-auto px-4 md:px-20 max-w-4xl mx-auto w-full flex flex-col gap-8 pb-32">
            {chatHistory.map((msg, idx) => (
              <motion.div
                key={msg.id || idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' ? (
                  <div className="flex gap-4 max-w-[85%]">
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0 border border-white/20 mt-1">
                      <span className="font-serif italic text-amber-200 text-sm">D</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      <div className="text-white/80 text-xl leading-relaxed tracking-wide whitespace-pre-wrap">
                        {renderMessageContent(msg.content)}
                      </div>
                      
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
                    <div className="text-lg whitespace-pre-wrap">
                       {renderMessageContent(msg.content)}
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
            
            {(isSending || isUploading) && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0 border border-white/20">
                  <span className="font-serif italic text-amber-200 text-sm">D</span>
                </div>
                <div className="flex items-center gap-1 text-white/30 h-8">
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
          <div className="w-full max-w-5xl mx-auto px-6 mt-10 pb-20 overflow-y-auto h-full">
            <h2 className="text-center font-serif text-3xl mb-4 tracking-widest text-amber-100">
               {session.status === 'GENERATING_IMAGES' ? 'Synthesizing Memories...' : 
                session.status === 'AWAITING_APPROVAL' ? 'Review Your Memories' :
                session.status === 'GENERATING_FINAL_ASSETS' ? 'Action! Rolling Cameras...' :
                session.status === 'PREVIEW_READY' ? "The Director's Cut" :
                session.status === 'RENDERING' ? 'Rendering Final Masterpiece...' :
                'The Final Cut'}
            </h2>
            
            {session.status === 'AWAITING_APPROVAL' && (
              <div className="flex justify-center mb-12">
                 <button 
                   onClick={handleApproveMemories}
                   className="px-8 py-3 bg-amber-600 hover:bg-amber-500 text-black font-bold uppercase tracking-widest rounded-full transition-all shadow-[0_0_30px_rgba(217,119,6,0.4)]"
                 >
                    Approve Memories & Generate Video
                 </button>
              </div>
            )}

            {(session.status === 'PREVIEW_READY' || session.status === 'RENDERING' || session.status === 'COMPLETED') ? (
              <div className="flex flex-col items-center gap-8">
                 <RemotionPreview scenes={scenes} />
                 
                 {session.status === 'PREVIEW_READY' && (
                   <button 
                     onClick={handleRenderFinal}
                     className="px-8 py-4 bg-white hover:bg-amber-100 text-black font-bold uppercase tracking-widest rounded-full transition-all shadow-[0_0_30px_rgba(255,255,255,0.4)] flex items-center gap-3"
                   >
                     <Download size={20} /> Render High Quality MP4
                   </button>
                 )}

                 {session.status === 'RENDERING' && (
                   <div className="flex flex-col items-center gap-4 text-amber-200/70 font-mono text-sm animate-pulse">
                     <div className="w-12 h-12 border-t-2 border-amber-200 rounded-full animate-spin"></div>
                     Rendering on Cloud GPUs...
                   </div>
                 )}

                 {session.status === 'COMPLETED' && (
                   <button className="px-8 py-4 bg-green-500/20 border border-green-500/50 hover:bg-green-500/30 text-green-100 font-bold uppercase tracking-widest rounded-full transition-all flex items-center gap-3">
                     <Download size={20} /> Download MP4
                   </button>
                 )}
              </div>
            ) : (
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                 {scenes.length > 0 ? scenes.map((scene) => (
                   <div key={scene.id} className="bg-white/5 border border-white/10 p-4 rounded-lg flex flex-col gap-4">
                     <div className={`bg-black/50 border border-white/5 flex items-center justify-center relative overflow-hidden group ${session.aspect_ratio === '9:16' ? 'aspect-[9/16]' : 'aspect-video'}`}>
                       {scene.reference_image_url ? (
                          <div className="relative w-full h-full cursor-pointer" onClick={() => setModalImage(scene.reference_image_url!)}>
                            <Image
                              src={scene.reference_image_url}
                              alt="Scene ref"
                              fill
                              unoptimized
                              sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                              className="object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                               <span className="bg-black/50 text-white px-3 py-1 rounded-full text-xs font-mono backdrop-blur-sm">Expand</span>
                            </div>
                          </div>
                       ) : (
                         <div className="flex flex-col items-center gap-2">
                           <div className="w-4 h-4 border-t border-amber-200/50 rounded-full animate-spin"></div>
                           <p className="text-[10px] text-white/30 font-mono tracking-widest uppercase">
                             Drafting Scene...
                           </p>
                         </div>
                       )}
                       
                       {/* Overlay loading state if image exists but video is still generating */}
                       {scene.reference_image_url && !scene.video_url && session.status === 'GENERATING_FINAL_ASSETS' && (
                         <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-3 backdrop-blur-sm">
                            <div className="w-8 h-8 border-t-2 border-amber-200 rounded-full animate-spin"></div>
                            <p className="text-[10px] text-amber-100/70 font-mono tracking-widest uppercase">
                              Filming & Recording Audio...
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
        <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#0A0A0F] via-[#0A0A0F] to-transparent flex flex-col items-center z-10">
          {(session.status === 'AWAITING_SELFIE' || session.status === 'PRE_PRODUCTION') && (
            <div 
               className="w-full max-w-3xl mb-4 border-2 border-dashed border-white/20 rounded-xl bg-black/40 backdrop-blur-md p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-white/5 hover:border-amber-200/40 transition-all text-white/50 hover:text-white"
               onClick={() => fileInputRef.current?.click()}
               onDrop={handleDrop}
               onDragOver={handleDragOver}
            >
               <UploadCloud size={32} className="mb-2" />
               <span className="font-serif">Click to browse or Drag & Drop a photo here</span>
               <span className="font-mono text-xs uppercase tracking-widest opacity-50">JPEG, PNG accepted</span>
            </div>
          )}
          
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
               <button 
                  type="button" 
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 text-white/40 hover:text-white transition-colors bg-white/5 rounded-full"
               >
                  <Camera size={20} />
               </button>
            </div>
            <input
              autoFocus
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                session.status === 'AWAITING_SELFIE' 
                  ? "Upload a photo or drop it above..." 
                  : session.status === 'PRE_PRODUCTION'
                    ? "Type a response or attach a photo..."
                    : "Type your response..."
              }
              className={`w-full bg-[#1A1A24]/80 border border-white/10 rounded-full py-4 pl-16 pr-16 text-lg focus:outline-none focus:border-amber-200/30 transition-all font-serif placeholder:text-white/20 shadow-lg`}
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

      {/* Fullscreen Image Modal */}
      <AnimatePresence>
        {modalImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-xl flex items-center justify-center p-4"
            onClick={() => setModalImage(null)}
          >
            <button className="absolute top-6 right-6 p-2 bg-white/10 rounded-full text-white hover:bg-white/20 transition-colors" onClick={() => setModalImage(null)}>
               <X size={24} />
            </button>
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="relative w-full max-w-6xl aspect-video rounded-2xl overflow-hidden shadow-[0_0_100px_rgba(255,255,255,0.1)] border border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <Image src={modalImage} alt="Fullscreen view" fill className="object-contain" unoptimized />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
