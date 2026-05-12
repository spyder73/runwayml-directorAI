# Lifestory.ai

Lifestory.ai is a Next.js application that turns a guided life-story interview into a short cinematic documentary. Users can register, add their own OpenRouter and Runway keys in the settings modal, answer a text or Runway Character interview, upload reference images, review scene plans, generate media, and render a final Remotion video.

## What Is In This Repo

```txt
src/app/                       Next.js App Router pages and API routes
src/app/api/auth/              register, login, logout, email verification
src/app/api/settings/          encrypted user-owned API key settings
src/app/api/pipeline/          interview, outline, media generation, SSE, render
src/app/api/avatar/session/    Runway Character realtime session creation
src/app/api/media/[id]/        authenticated private media delivery
src/components/home/           landing page and studio entry UI
src/components/session/        interview, settings modal, review, progress UI
src/components/DirectorChat.tsx natural-language edit/director interface
src/lib/                       auth, DB, pipeline, Runway, media, render helpers
src/lib/ai/prompts/            prompt modules for interview and scene planning
src/remotion/                  Remotion composition and subtitle components
python/modal_bridge/           local HTTP bridge used by Modal render backend
python/modal_renderer/         Modal-deployed Remotion render worker
deploy/                        VPS, reverse proxy, backup, and acceptance docs
tests/                         node:test coverage for app behavior and deploy flow
data/                          local SQLite DB and private media at runtime
```

`data/` is runtime state, not source code. In production it must be persisted across deploys because it contains SQLite data and private uploaded/generated media.

## Main Flow

1. A user registers and verifies their email.
2. The user opens the session settings modal and saves their OpenRouter and Runway API keys.
3. The app stores those credentials encrypted with `CREDENTIAL_ENCRYPTION_KEY`.
4. The user completes the story intake through the text interview or Runway Character voice interview.
5. `/api/pipeline/*` routes produce the story profile, outline, treatment, references, generated clips, voiceover, and render state.
6. `/api/pipeline/events` streams progress updates with Server-Sent Events.
7. Generated and uploaded media is stored under `MEDIA_STORAGE_DIR` and served only through authenticated `/api/media/:id` URLs.
8. Final render runs locally through Remotion by default, or through Modal when `FINAL_RENDER_BACKEND=modal`.

## Settings Modal And BYOK

The settings modal lives at:

```txt
src/components/session/SettingsModal.tsx
src/app/api/settings/route.ts
src/lib/user-settings.ts
src/lib/crypto/credentials.ts
src/lib/providers/user-credentials.ts
```

Users bring their own API keys:

- `OPENROUTER_API_KEY` is entered in the app, not stored in `.env`.
- `RUNWAYML_API_SECRET` is entered in the app, not stored in `.env`.
- Saved keys are encrypted before being written to SQLite.
- `CREDENTIAL_ENCRYPTION_KEY` is required wherever encrypted credentials are used.

Generate the encryption key with:

```bash
openssl rand -base64 32
```

If `CREDENTIAL_ENCRYPTION_KEY` changes after users have saved settings, existing encrypted credentials will no longer decrypt. Keep it stable and private.

## Local Development

Install dependencies:

```bash
npm install
```

Create `.env.local`:

```env
CREDENTIAL_ENCRYPTION_KEY=base64-encoded-32-byte-key

# Optional, for Runway Character voice calls
RUNWAY_CHARACTER_AVATAR_ID=
RUNWAY_CHARACTER_SESSION_READY_TIMEOUT_MS=60000

# Optional local overrides
MEDIA_STORAGE_DIR=data/media
RUNWAY_VIDEO_MODEL=gen4_turbo
REMOTION_RENDER_QUALITY=fast
FINAL_RENDER_BACKEND=local
```

Start the app:

```bash
npm run dev
```

Open:

```txt
http://localhost:3000
```

Then register, log in, open the settings modal, and add the OpenRouter and Runway keys for the account you are testing.

## Useful Commands

```bash
npm run dev       # Next.js dev server
npm run build     # production build
npm start         # run built app
npm test          # node:test suite
npm run lint      # ESLint
```

This repo uses Next.js 16 with webpack scripts:

```json
"dev": "next dev --webpack",
"build": "next build --webpack"
```

## Important Environment Variables

See `.env.example` and `.env.production.example` for the full list.

Required for production:

```env
NODE_ENV=production
APP_URL=https://your-domain.example
SESSION_SECRET=base64-encoded-32-byte-secret
CREDENTIAL_ENCRYPTION_KEY=base64-encoded-32-byte-key
MEDIA_STORAGE_DIR=/app/data/media
```

Required for email verification:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM="Lifestory <no-reply@your-domain.example>"
```

Optional reviewer seed account:

```env
REVIEWER_EMAIL=reviewer@example.com
REVIEWER_PASSWORD=replace-with-real-password
REVIEWER_OPENROUTER_API_KEY=
REVIEWER_RUNWAYML_API_SECRET=
```

Optional Runway Character settings:

```env
RUNWAY_CHARACTER_AVATAR_ID=
RUNWAY_CHARACTER_SESSION_READY_TIMEOUT_MS=60000
AVATAR_DEBUG_LOGS=0
```

Optional Remotion settings:

```env
REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium
REMOTION_RENDER_QUALITY=fast
REMOTION_CONCURRENCY=50%
REMOTION_TIMEOUT_MS=900000
REMOTION_X264_PRESET=veryfast
REMOTION_BUNDLE_CACHE=true
```

## Runway Character Interview

The voice interview path is implemented by:

```txt
src/components/session/AvatarDirectorCall.tsx
src/app/api/avatar/session/route.ts
src/lib/avatar/
```

Set `RUNWAY_CHARACTER_AVATAR_ID` to the Runway Character avatar you want to use. The route uses the logged-in user's saved Runway key from the settings modal.

For production cold starts, keep:

```env
RUNWAY_CHARACTER_SESSION_READY_TIMEOUT_MS=60000
```

Use `AVATAR_DEBUG_LOGS=1` only while debugging because avatar event logs are intentionally verbose.

To inspect recent avatar session events in SQLite:

```bash
sqlite3 data/lifestory.db "select created_at,event_type,runway_session_id,payload_json,error_message from avatar_call_events where event_type like 'runway_%' or event_type = 'session_error' order by created_at desc limit 20;"
```

## Final Rendering

Local Remotion rendering is the default:

```env
FINAL_RENDER_BACKEND=local
```

The render path uses:

```txt
src/lib/final-render.ts
src/lib/final-render-backend.ts
src/lib/render-job.ts
src/remotion/
```

Set render quality with:

```env
REMOTION_RENDER_QUALITY=fast      # 960x540 / 540x960
REMOTION_RENDER_QUALITY=standard  # 1280x720 / 720x1280
REMOTION_RENDER_QUALITY=ultra     # 1920x1080 / 1080x1920
```

Start with `fast` on small VPS machines, then benchmark before raising quality.

## Modal Render Backend

Modal rendering is optional. It keeps the app's data and media local, but offloads the final Remotion render to a Modal function.

Enable it only after the Modal app has been deployed:

```env
FINAL_RENDER_BACKEND=modal
MODAL_TOKEN_ID=ak-your-token-id
MODAL_TOKEN_SECRET=as-your-token-secret
MODAL_ENVIRONMENT=main
MODAL_RENDER_APP_NAME=lifestory-remotion-renderer
MODAL_RENDER_FUNCTION_NAME=render_final
MODAL_RENDER_VOLUME=lifestory-render-jobs
MODAL_RENDER_BRIDGE_PORT=8765
MODAL_RENDER_CPU=8
MODAL_RENDER_MEMORY_MB=16384
MODAL_RENDER_TIMEOUT_SEC=1800
```

Deploy the renderer from the repo root:

```bash
python3 -m venv .venv-modal
source .venv-modal/bin/activate
pip install "modal>=1.1,<2"
modal setup
modal deploy python/modal_renderer/app.py
```

In Docker production, `scripts/start-production.sh` starts the Next.js app and, when `FINAL_RENDER_BACKEND=modal`, a loopback-only Python bridge. The bridge uploads render inputs to a Modal Volume, calls the deployed `render_final` function, downloads the compressed MP4 into `MEDIA_STORAGE_DIR`, and the app continues serving the final file through `/api/media/:id`.

More detail is in `modal_setup.md`.

## Docker VPS Deployment

The production deployment is Docker-first and expects a reverse proxy such as Caddy, Nginx, or Traefik in front of the app.

On the VPS:

```bash
sudo mkdir -p /opt/lifestory
sudo chown "$USER":"$USER" /opt/lifestory
cd /opt/lifestory
git clone https://github.com/spyder73/runwayml-directorAI.git .
git checkout production
cp .env.production.example .env.production
```

Generate secrets:

```bash
openssl rand -base64 32
openssl rand -base64 32
```

Use one value for `SESSION_SECRET` and the other for `CREDENTIAL_ENCRYPTION_KEY`, then edit `.env.production` for:

- `APP_URL`
- SMTP settings
- optional reviewer account fields
- optional Runway Character avatar
- optional Remotion or Modal render settings

Prepare persistent runtime data:

```bash
mkdir -p data
chmod 700 data
```

Start with the shared proxy network:

```bash
docker network inspect proxy || docker network create proxy
docker compose -p lifestory --env-file .env.production up -d --build
docker compose -p lifestory ps
docker compose -p lifestory logs -f web
```

If your reverse proxy cannot join the Docker `proxy` network, use the localhost override:

```bash
docker compose -p lifestory -f docker-compose.yml -f docker-compose.localhost.yml --env-file .env.production up -d --build
docker compose -p lifestory -f docker-compose.yml -f docker-compose.localhost.yml ps
docker compose -p lifestory -f docker-compose.yml -f docker-compose.localhost.yml logs -f web
```

Route the reverse proxy to:

```txt
lifestory-web:3000
```

or, with the localhost override:

```txt
127.0.0.1:3001
```

Do not bind the app container directly to public `80` or `443`.

For Server-Sent Events, disable proxy buffering for:

```txt
/api/pipeline/events
```

The route also sends `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`, but Nginx-style proxies still need buffering disabled explicitly.

Deployment references:

```txt
deploy/VPS_SETUP.md
deploy/VPS_PRODUCTION_RUNBOOK.md
deploy/REVERSE_PROXY.md
deploy/caddy/Caddyfile.example
deploy/nginx/lifestory.conf.example
deploy/BACKUP_RECOVERY.md
```

## Backup Notes

Back up at least:

```txt
data/lifestory.db
data/media/
.env.production
```

The helper script is:

```txt
deploy/backup-lifestory.sh
```

Keep `.env.production` private. It contains production secrets and must never be committed.

## Tech Stack

- Next.js App Router
- React
- Tailwind CSS
- SQLite with `better-sqlite3`
- Vercel AI SDK and OpenRouter provider
- Runway SDK and Runway Avatars packages
- Remotion Player and Renderer
- Modal Python SDK for optional cloud final renders
- Docker Compose for VPS deployment
