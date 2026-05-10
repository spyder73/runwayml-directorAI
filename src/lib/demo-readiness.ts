import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

type DemoReadinessInput = {
  env?: Record<string, string | undefined>;
  ffmpegAvailable?: boolean;
  storageWritable?: boolean;
};

export type DemoReadinessCheck = {
  id: 'director' | 'generation' | 'render' | 'storage';
  label: string;
  ok: boolean;
  required: boolean;
  message: string;
};

export type DemoReadinessReport = {
  ok: boolean;
  userMessage: string;
  checks: DemoReadinessCheck[];
};

function hasSecret(value: string | undefined) {
  return Boolean(value?.trim());
}

export function createDemoReadinessReport(input: DemoReadinessInput = {}): DemoReadinessReport {
  const env = input.env || process.env;
  const checks: DemoReadinessCheck[] = [
    {
      id: 'director',
      label: 'Director conversation',
      ok: hasSecret(env.OPENROUTER_API_KEY),
      required: true,
      message: hasSecret(env.OPENROUTER_API_KEY)
        ? 'The director can hold the interview.'
        : 'Add the director setup before a live interview.',
    },
    {
      id: 'generation',
      label: 'Live generation',
      ok: hasSecret(env.RUNWAYML_API_SECRET),
      required: true,
      message: hasSecret(env.RUNWAYML_API_SECRET)
        ? 'Live image, narration, and motion passes can run.'
        : 'Add the generation setup before producing media.',
    },
    {
      id: 'render',
      label: 'Final film assembly',
      ok: input.ffmpegAvailable !== false,
      required: true,
      message: input.ffmpegAvailable !== false
        ? 'Final film assembly is available.'
        : 'Install ffmpeg or set FFMPEG_PATH before final downloads.',
    },
    {
      id: 'storage',
      label: 'Generated media storage',
      ok: input.storageWritable !== false,
      required: true,
      message: input.storageWritable !== false
        ? 'Generated media can be saved locally.'
        : 'Make public/generated writable before production.',
    },
  ];
  const ok = checks.every((check) => check.ok || !check.required);

  return {
    ok,
    userMessage: ok ? 'Live studio is ready.' : 'Rehearsal is ready. Live generation needs setup.',
    checks,
  };
}

function runCommand(command: string, args: string[]) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 5000);

    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

export async function checkGeneratedStorageWritable() {
  const generatedDir = path.join(process.cwd(), 'public', 'generated');
  try {
    await fs.mkdir(generatedDir, { recursive: true });
    await fs.access(generatedDir);
    return true;
  } catch {
    return false;
  }
}

export async function getDemoReadinessReport(env: Record<string, string | undefined> = process.env) {
  const ffmpegAvailable = await runCommand(env.FFMPEG_PATH || 'ffmpeg', ['-version']);
  const storageWritable = await checkGeneratedStorageWritable();

  return createDemoReadinessReport({
    env,
    ffmpegAvailable,
    storageWritable,
  });
}
