import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

test('host routing sends root and www domains to the public landing page', () => {
  const previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = 'https://app.yourlifestory.io';

  try {
    const { appPublicUrl, isStudioHost } = jiti('../src/lib/host-routing.ts');

    assert.equal(appPublicUrl(), 'https://app.yourlifestory.io');
    assert.equal(isStudioHost('app.yourlifestory.io'), true);
    assert.equal(isStudioHost('app.yourlifestory.io:443'), true);
    assert.equal(isStudioHost('yourlifestory.io'), false);
    assert.equal(isStudioHost('www.yourlifestory.io'), false);
    assert.equal(isStudioHost('localhost:3000'), true);
  } finally {
    if (previousAppUrl === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = previousAppUrl;
    }
  }
});

test('home route chooses between landing and studio from request host', () => {
  const source = fs.readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');

  assert.match(source, /headers\(\)/);
  assert.match(source, /x-forwarded-host/);
  assert.match(source, /isStudioHost/);
  assert.match(source, /<StudioHome \/>/);
  assert.match(source, /<LandingPage appUrl=\{appPublicUrl\(\)\} \/>/);
});

test('public landing page links visitors into the app subdomain', () => {
  const source = fs.readFileSync(new URL('../src/components/home/LandingPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /Meet Nico Hale/);
  assert.match(source, /Hey, I'm Nico Hale, your content director/);
  assert.match(source, /AI content director/);
  assert.match(source, /A short film from a life only you can tell/);
  assert.match(source, /Tell it the way you remember it/);
  assert.match(source, /href=\{`\$\{appUrl\}\/register`\}/);
  assert.match(source, /href=\{`\$\{appUrl\}\/login`\}/);
  assert.match(source, /It starts where real stories always start: a detail/);
  assert.match(source, /Not a prompt box\. A director's room/);
  assert.match(source, /Give your memories a screen/);
  assert.match(source, /\/landing\/hero/);
  assert.match(source, /\/landing\/memory-detail/);
  assert.match(source, /\/landing\/director-desk/);
  assert.match(source, /\/landing\/final-screening/);
  assert.match(source, /\/landing\/director-studio/);
  assert.doesNotMatch(source, /Your account owns its media/);
  assert.doesNotMatch(source, /authenticated routes/);
  assert.doesNotMatch(source, /generation keys stay encrypted/);
  assert.doesNotMatch(source, /Start with one memory or map a whole life/);
  assert.doesNotMatch(source, /one memory/i);
});

test('root metadata positions Lifestory as a cinematic memoir studio', () => {
  const source = fs.readFileSync(new URL('../src/app/layout.tsx', import.meta.url), 'utf8');

  assert.match(source, /cinematic memoir studio/i);
  assert.doesNotMatch(source, /A cinematic documentary of your life/);
});

test('proxy leaves the public landing host open and keeps app routes on the app subdomain', () => {
  const previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = 'https://app.yourlifestory.io';

  try {
    const { proxy } = jiti('../src/proxy.ts');
    const { NextRequest } = jiti('next/server');

    const landingResponse = proxy(new NextRequest('https://yourlifestory.io/', {
      headers: { host: 'yourlifestory.io' },
    }));
    assert.equal(landingResponse.status, 200);

    const appHomeResponse = proxy(new NextRequest('https://app.yourlifestory.io/', {
      headers: { host: 'app.yourlifestory.io' },
    }));
    assert.equal(appHomeResponse.status, 307);
    assert.equal(appHomeResponse.headers.get('location'), 'https://app.yourlifestory.io/login?next=%2F');

    const rootRegisterResponse = proxy(new NextRequest('https://yourlifestory.io/register', {
      headers: { host: 'yourlifestory.io' },
    }));
    assert.equal(rootRegisterResponse.status, 307);
    assert.equal(rootRegisterResponse.headers.get('location'), 'https://app.yourlifestory.io/register');
  } finally {
    if (previousAppUrl === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = previousAppUrl;
    }
  }
});
