# Lifestory.ai

Lifestory.ai is a magical, single-page web application designed for the Runway API Hackathon. It transforms personal memories into a cinematic documentary using the full suite of Runway's APIs (Images, TTS, and Video).

## Features
- **Magical Canvas:** A dark, starry UI where users describe their life story.
- **AI Analyst:** Uses an LLM (via OpenRouter) to structure the story into chronological scenes with visual prompts and narration.
- **Upload Checkpoint:** Allows users to upload personal photos to visually ground the AI.
- **Runway Generation:** Leverages RunwayML APIs for creating reference images, animating them into video, and generating TTS voiceovers.
- **Remotion Player:** Dynamically previews the assembled video with subtitles.
- **Director's MCP:** A natural-language chat interface that acts as a director, orchestrating timeline updates (regenerating specific scenes or audio) via AI agents.

## Local Development Setup

To run this project locally for testing:

1. **Install dependencies:**
   ```bash
   cd runwayml-directorAI
   npm install
   ```

2. **Set up Environment Variables:**
   Create a `.env.local` file in the `runwayml-directorAI` directory with the following keys:
   ```env
   CREDENTIAL_ENCRYPTION_KEY=base64-encoded-32-byte-key
   ```
   Live OpenRouter and Runway keys are user-owned now. Add them from the in-app settings modal after registering and logging in.
   Runtime uploads, generated assets, and final renders are stored privately under `data/media` and served through authenticated `/api/media/:id` URLs. Generated reference frames are uploaded to Runway through temporary SDK uploads before video generation.
   Generate the credential encryption key with `openssl rand -base64 32`.

3. **Run the Development Server:**
   ```bash
   npm run dev
   ```

4. **View the App:**
   Open [http://localhost:3000](http://localhost:3000) in your browser.

## Docker Deployment (VPS)

To deploy on a VPS using Docker:

1. Create a `.env` file with `CREDENTIAL_ENCRYPTION_KEY` and any optional reviewer seed values.
2. Run the following command:
   ```bash
   docker-compose up -d --build
   ```
   This will build the standalone Next.js image, set up the SQLite data volumes, and expose the app on port 3000.
   Persist `data/` between deploys; it now contains both SQLite and private media files.
3. If Nginx or another buffering reverse proxy sits in front of the app, disable buffering for `/api/pipeline/events` so Server-Sent Events stream immediately. The route also sends `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`.

## Production Reviewer Account

Production can seed a confirmed reviewer account at startup when these env vars are set:

```env
REVIEWER_EMAIL=reviewer@example.com
REVIEWER_PASSWORD=replace-with-real-password
REVIEWER_OPENROUTER_API_KEY=
REVIEWER_RUNWAYML_API_SECRET=
CREDENTIAL_ENCRYPTION_KEY=base64-encoded-32-byte-key
```

Set the real reviewer email, password, and optional BYOK keys shortly before deployment. The app encrypts reviewer API keys before saving them and never logs reviewer secrets.

## Tech Stack
- Next.js (App Router)
- React & Tailwind CSS
- SQLite (`better-sqlite3`)
- Framer Motion
- `@runwayml/sdk`
- Vercel AI SDK (`ai`, `@ai-sdk/openai`)
- `@remotion/player`

## Phase 2: Runway Characters

After the single-memory demo path is stable, the next product step is a Runway Character interviewer: a speaking AI director that conducts the interview verbally and keeps the user out of text input for most of the flow. This is intentionally deferred until the core real-media generation pipeline is reliable.
