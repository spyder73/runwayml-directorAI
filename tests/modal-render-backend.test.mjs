import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

function withEnv(overrides, run) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }

  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('final render backend stays local unless Modal is explicitly enabled', () => {
  const { resolveFinalRenderBackend } = jiti('../src/lib/final-render.ts');

  withEnv({ FINAL_RENDER_BACKEND: undefined }, () => {
    assert.equal(resolveFinalRenderBackend(process.env, 'modal'), 'local');
  });
  withEnv({ FINAL_RENDER_BACKEND: 'local' }, () => {
    assert.equal(resolveFinalRenderBackend(process.env, 'modal'), 'local');
  });
  withEnv({ FINAL_RENDER_BACKEND: 'gpu' }, () => {
    assert.equal(resolveFinalRenderBackend(process.env, 'modal'), 'local');
  });
  withEnv({ FINAL_RENDER_BACKEND: ' modal ' }, () => {
    assert.equal(resolveFinalRenderBackend(process.env, 'local'), 'local');
    assert.equal(resolveFinalRenderBackend(process.env, 'modal'), 'modal');
  });
});

test('Modal render request stages local media files into a mounted Volume manifest', () => {
  const { buildFinalRenderPlan } = jiti('../src/lib/final-render.ts');
  const { buildModalRenderRequest } = jiti('../src/lib/modal-render.ts');

  const plan = buildFinalRenderPlan({
    sessionId: 'session-1',
    aspectRatio: '9:16',
    scenes: [
      {
        id: 'scene-1',
        scene_index: 0,
        narrator_text: 'First line.',
        video_url: JSON.stringify(['/generated/video/session-1/shot-1.mp4']),
        shot_plan_json: JSON.stringify([{ duration: 3 }]),
        audio_url: '/generated/audio/session-1/scene-1.mp3',
        duration: 3,
      },
    ],
  });

  const request = buildModalRenderRequest(plan, {
    appName: 'lifestory-remotion-renderer',
    functionName: 'render_final',
    volumeName: 'lifestory-render-jobs',
    volumeMountPath: '/render-data',
    jobId: 'job-1',
    renderOptions: {
      crf: 20,
      x264Preset: 'veryfast',
      timeoutInMilliseconds: 900000,
      concurrency: '50%',
    },
  });

  assert.equal(request.appName, 'lifestory-remotion-renderer');
  assert.equal(request.functionName, 'render_final');
  assert.equal(request.volumeName, 'lifestory-render-jobs');
  assert.equal(request.outputLocalPath, plan.outputFilePath);
  assert.equal(request.inputFiles.length, 2);
  assert.equal(request.inputFiles[0].localPath, path.join(process.cwd(), 'public/generated/video/session-1/shot-1.mp4'));
  assert.equal(request.inputFiles[0].volumePath, '/jobs/job-1/inputs/input-000.mp4');
  assert.equal(request.inputFiles[1].volumePath, '/jobs/job-1/inputs/input-001.mp3');
  assert.equal(request.manifest.inputProps.scenes[0].clips[0].url, 'file:///render-data/jobs/job-1/inputs/input-000.mp4');
  assert.equal(request.manifest.inputProps.scenes[0].audio_url, 'file:///render-data/jobs/job-1/inputs/input-001.mp3');
  assert.equal(request.manifest.outputVolumePath, '/jobs/job-1/output/final.mp4');
  assert.equal(request.manifest.outputMountedPath, '/render-data/jobs/job-1/output/final.mp4');
  assert.equal(request.manifest.renderOptions.crf, 20);
});

test('render_final media tasks advertise Modal only when the backend is enabled', () => {
  const { finalRenderTaskProvider } = jiti('../src/lib/media-tasks.ts');

  assert.equal(finalRenderTaskProvider({}, 'modal'), 'local');
  assert.equal(finalRenderTaskProvider({ FINAL_RENDER_BACKEND: 'local' }, 'modal'), 'local');
  assert.equal(finalRenderTaskProvider({ FINAL_RENDER_BACKEND: 'anything-else' }, 'modal'), 'local');
  assert.equal(finalRenderTaskProvider({ FINAL_RENDER_BACKEND: 'modal' }, 'local'), 'local');
  assert.equal(finalRenderTaskProvider({ FINAL_RENDER_BACKEND: 'modal' }, 'modal'), 'modal');
});
