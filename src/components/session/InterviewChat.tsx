'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';
import { splitVisibleMessageContent } from '@/lib/chat-display';
import type { ChatHistoryRow } from '@/lib/types';

type InterviewChatProps = {
  chatHistory: ChatHistoryRow[];
  isThinking: boolean;
  onOption: (message: string) => void;
  onOpenImage: (url: string) => void;
};

function MessageContent({ content, onOpenImage }: { content: string; onOpenImage: (url: string) => void }) {
  const elements: React.ReactNode[] = [];

  splitVisibleMessageContent(content).forEach((part, index) => {
    if (part.type === 'image') {
      elements.push(
        <button
          key={`img-${index}`}
          type="button"
          onClick={() => onOpenImage(part.url)}
          className="my-6 block w-[min(72vw,36rem)] max-w-full overflow-hidden rounded-xl border border-white/10 bg-black/40 text-left shadow-[0_10px_40px_rgba(0,0,0,0.5)]"
        >
          <span className="relative block aspect-[4/3] w-full bg-black/60">
            <Image src={part.url} alt="Uploaded reference" fill className="object-contain" unoptimized />
          </span>
        </button>,
      );
      return;
    }

    elements.push(<span key={`text-${index}`} className="block mb-4 last:mb-0">{part.text}</span>);
  });

  return elements;
}

export default function InterviewChat({ chatHistory, isThinking, onOption, onOpenImage }: InterviewChatProps) {
  return (
    <>
      {chatHistory.map((msg, idx) => (
        <motion.div
          key={msg.id || idx}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          {msg.role === 'assistant' ? (
            <div className="flex max-w-[85%] gap-6">
              <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-amber-500/20 to-purple-500/20 shadow-[0_0_15px_rgba(251,191,36,0.1)]">
                <span className="font-serif text-base italic text-amber-100/90">D</span>
              </div>
              <div className="flex flex-col gap-3 pt-1">
                <div className="whitespace-pre-wrap font-serif text-xl font-light leading-[1.8] tracking-wide text-white/85 drop-shadow-sm md:text-2xl">
                  <MessageContent content={msg.content} onOpenImage={onOpenImage} />
                </div>

                {msg.options && (
                  <div className="mt-6 flex flex-wrap gap-3">
                    {JSON.parse(msg.options).map((opt: string, optIdx: number) => (
                      <button
                        key={optIdx}
                        type="button"
                        onClick={() => onOption(opt)}
                        className="rounded-full border border-white/10 bg-black/40 px-5 py-2.5 text-left font-sans text-sm tracking-wide text-white/80 shadow-lg backdrop-blur-md transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white"
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="relative mt-4 max-w-[75%]">
              <div className="text-right">
                <span className="mb-2 inline-block px-2 font-mono text-xs uppercase tracking-[0.2em] text-white/40">You</span>
                <div className="flex flex-col items-end text-right font-serif text-xl font-light leading-relaxed tracking-wide text-white/90">
                  <MessageContent content={msg.content} onOpenImage={onOpenImage} />
                </div>
              </div>
            </div>
          )}
        </motion.div>
      ))}

      {isThinking && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 flex gap-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-amber-500/20 to-purple-500/20 shadow-[0_0_15px_rgba(251,191,36,0.1)]">
            <span className="font-serif text-base italic text-amber-100/90">D</span>
          </div>
          <div className="flex h-10 items-center gap-1.5 text-white/30">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/40" />
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/40 [animation-delay:0.2s]" />
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/40 [animation-delay:0.4s]" />
          </div>
        </motion.div>
      )}
    </>
  );
}
