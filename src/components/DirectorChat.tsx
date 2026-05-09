'use client';
import { useState } from 'react';

export default function DirectorChat({ sessionId }: { sessionId: string }) {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'director', text: string }[]>([
    { role: 'director', text: 'I am the Director. How would you like to adjust the final cut?' }
  ]);
  const [isSending, setIsSending] = useState(false);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    const userMessage = message;
    setMessage('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsSending(true);

    try {
      const res = await fetch('/api/pipeline/director', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: userMessage }),
      });
      const data = await res.json();
      
      setMessages(prev => [...prev, { role: 'director', text: data.response }]);
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'director', text: 'Error connecting to the Director.' }]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto mt-16 bg-white/5 border border-white/10 rounded-xl overflow-hidden flex flex-col h-96">
      <div className="bg-black/40 border-b border-white/10 p-3 flex justify-between items-center">
        <h3 className="font-mono text-xs uppercase tracking-widest text-amber-200">Director Notes</h3>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] p-3 rounded-lg text-sm font-mono leading-relaxed ${
              msg.role === 'user' 
                ? 'bg-white/10 text-white' 
                : 'bg-amber-900/20 text-amber-100/90 border border-amber-900/30'
            }`}>
              {msg.text}
            </div>
          </div>
        ))}
        {isSending && (
          <div className="flex justify-start">
            <div className="max-w-[80%] p-3 rounded-lg text-sm font-mono bg-amber-900/20 text-amber-100/50 border border-amber-900/30 animate-pulse">
              Director is thinking...
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSend} className="p-3 border-t border-white/10 bg-black/40 flex gap-2">
        <input 
          type="text" 
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="E.g. Make Scene 2 black and white..."
          className="flex-1 bg-transparent border border-white/10 rounded-lg px-4 py-2 text-sm font-mono focus:outline-none focus:border-amber-200/50 transition-colors"
          disabled={isSending}
        />
        <button 
          type="submit" 
          disabled={isSending || !message.trim()}
          className="px-6 py-2 bg-white/10 hover:bg-amber-200 hover:text-black transition-colors rounded-lg font-mono text-xs tracking-widest uppercase disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
