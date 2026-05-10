import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

test('demo readiness reports missing live requirements without exposing secret values', () => {
  const { createDemoReadinessReport } = jiti('../src/lib/demo-readiness.ts');

  const report = createDemoReadinessReport({
    env: {
      OPENROUTER_API_KEY: 'director-secret-value',
      RUNWAYML_API_SECRET: '',
    },
    ffmpegAvailable: false,
    storageWritable: true,
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.find((check) => check.id === 'director')?.ok, true);
  assert.equal(report.checks.find((check) => check.id === 'generation')?.ok, false);
  assert.equal(report.checks.find((check) => check.id === 'render')?.ok, false);
  assert.doesNotMatch(JSON.stringify(report), /director-secret-value/);
});

test('demo readiness passes when live generation and local render are available', () => {
  const { createDemoReadinessReport } = jiti('../src/lib/demo-readiness.ts');

  const report = createDemoReadinessReport({
    env: {
      OPENROUTER_API_KEY: 'set',
      RUNWAYML_API_SECRET: 'set',
    },
    ffmpegAvailable: true,
    storageWritable: true,
  });

  assert.equal(report.ok, true);
  assert.equal(report.userMessage, 'Live studio is ready.');
});
