'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { FinalRenderBackend, RunwayConcurrencyMode, RunwayVideoModel } from '@/lib/types';

type SettingsSummary = {
  openrouterKeySaved: boolean;
  runwayKeySaved: boolean;
  runwayConcurrencyMode: RunwayConcurrencyMode;
  runwayVideoModel: RunwayVideoModel;
  finalRenderBackend: FinalRenderBackend;
  modalRenderingAvailable: boolean;
};

type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const DEFAULT_SETTINGS: SettingsSummary = {
  openrouterKeySaved: false,
  runwayKeySaved: false,
  runwayConcurrencyMode: 'serial',
  runwayVideoModel: 'gen4_turbo',
  finalRenderBackend: 'local',
  modalRenderingAvailable: false,
};

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [summary, setSummary] = useState<SettingsSummary>(DEFAULT_SETTINGS);
  const [openrouterApiKey, setOpenrouterApiKey] = useState('');
  const [runwayApiKey, setRunwayApiKey] = useState('');
  const [runwayConcurrencyMode, setRunwayConcurrencyMode] = useState<RunwayConcurrencyMode>('serial');
  const [runwayVideoModel, setRunwayVideoModel] = useState<RunwayVideoModel>('gen4_turbo');
  const [finalRenderBackend, setFinalRenderBackend] = useState<FinalRenderBackend>('local');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    fetch('/api/settings')
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load settings.');
        return response.json() as Promise<SettingsSummary>;
      })
      .then((nextSummary) => {
        if (cancelled) return;
        setSummary(nextSummary);
        setRunwayConcurrencyMode(nextSummary.runwayConcurrencyMode);
        setRunwayVideoModel(nextSummary.runwayVideoModel);
        setFinalRenderBackend(nextSummary.modalRenderingAvailable ? nextSummary.finalRenderBackend : 'local');
        setStatus('idle');
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Unable to load settings.');
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleClose = () => {
    setStatus('idle');
    setError(null);
    onClose();
  };

  if (!open) return null;

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus('saving');
    setError(null);

    const payload: {
      openrouterApiKey?: string;
      runwayApiKey?: string;
      runwayConcurrencyMode: RunwayConcurrencyMode;
      runwayVideoModel: RunwayVideoModel;
      finalRenderBackend: FinalRenderBackend;
    } = { runwayConcurrencyMode, runwayVideoModel, finalRenderBackend };

    if (openrouterApiKey.trim()) payload.openrouterApiKey = openrouterApiKey.trim();
    if (runwayApiKey.trim()) payload.runwayApiKey = runwayApiKey.trim();

    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || 'Unable to save settings.');
      }

      const nextSummary = await response.json() as SettingsSummary;
      setSummary(nextSummary);
      setRunwayConcurrencyMode(nextSummary.runwayConcurrencyMode);
      setRunwayVideoModel(nextSummary.runwayVideoModel);
      setFinalRenderBackend(nextSummary.modalRenderingAvailable ? nextSummary.finalRenderBackend : 'local');
      setOpenrouterApiKey('');
      setRunwayApiKey('');
      setStatus('saved');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save settings.');
      setStatus('error');
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-end bg-black/60 p-4 pt-20 backdrop-blur-sm md:p-6 md:pt-24" role="presentation" onClick={handleClose}>
      <form
        onSubmit={handleSave}
        role="dialog"
        aria-modal="true"
        aria-label="Generation settings"
        className="w-full max-w-md rounded-lg border border-white/10 bg-[#111116]/95 p-5 font-serif text-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl">Generation settings</h2>
            <p className="mt-2 text-sm leading-6 text-white/55">
              Generation requires user-supplied keys. Saved keys stay encrypted and are never shown again.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close settings"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-white/45">
              <span>OpenRouter</span>
              <span>{summary.openrouterKeySaved ? 'Saved' : 'Not saved'}</span>
            </span>
            <input
              type="password"
              value={openrouterApiKey}
              onChange={(event) => setOpenrouterApiKey(event.target.value)}
              autoComplete="off"
              placeholder="Paste a new OpenRouter key"
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-3 font-mono text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-amber-200/50"
            />
          </label>

          <label className="block">
            <span className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-white/45">
              <span>Runway</span>
              <span>{summary.runwayKeySaved ? 'Saved' : 'Not saved'}</span>
            </span>
            <input
              type="password"
              value={runwayApiKey}
              onChange={(event) => setRunwayApiKey(event.target.value)}
              autoComplete="off"
              placeholder="Paste a new Runway key"
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-3 font-mono text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-amber-200/50"
            />
          </label>

          <div>
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/45">Runway mode</span>
            <p className="mt-2 text-sm leading-6 text-white/50">
              Sequential generates images and videos step by step, which helps when Runway throttles too many parallel requests. Parallel starts eligible jobs together and can be faster when your Runway account has capacity.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-black/30 p-1">
              {(['serial', 'parallel'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setRunwayConcurrencyMode(mode)}
                  className={`rounded-md px-3 py-2 text-sm capitalize transition-colors ${
                    runwayConcurrencyMode === mode
                      ? 'bg-white text-black'
                      : 'text-white/55 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {mode === 'serial' ? 'Sequential' : 'Parallel'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/45">Runway video model</span>
            <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-black/30 p-1">
              {(['gen4_turbo', 'veo3.1_fast'] as const).map((model) => (
                <button
                  key={model}
                  type="button"
                  onClick={() => setRunwayVideoModel(model)}
                  className={`rounded-md px-3 py-2 font-mono text-xs transition-colors ${
                    runwayVideoModel === model
                      ? 'bg-white text-black'
                      : 'text-white/55 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {model}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-black/30 p-3">
            <span>
              <span className="block font-mono text-[11px] uppercase tracking-[0.18em] text-white/45">Modal render</span>
              <span className="mt-1 block text-sm leading-5 text-white/50">
                {summary.modalRenderingAvailable
                  ? 'Server enabled. Final renders can run on Modal when this is on.'
                  : 'Server disabled. Set FINAL_RENDER_BACKEND=modal before enabling.'}
              </span>
            </span>
            <input
              type="checkbox"
              checked={finalRenderBackend === 'modal'}
              disabled={!summary.modalRenderingAvailable}
              onChange={(event) => setFinalRenderBackend(event.target.checked ? 'modal' : 'local')}
              className="h-5 w-5 shrink-0 accent-white disabled:cursor-not-allowed disabled:opacity-40"
            />
          </label>
        </div>

        {error && <p className="mt-4 text-sm text-red-200">{error}</p>}
        {status === 'saved' && <p className="mt-4 text-sm text-emerald-200">Settings saved.</p>}

        <button
          type="submit"
          disabled={status === 'saving'}
          className="mt-6 w-full rounded-lg bg-white px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-black transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/40"
        >
          {status === 'saving' ? 'Saving' : 'Save'}
        </button>
      </form>
    </div>
  );
}
