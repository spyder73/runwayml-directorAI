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
   OPENROUTER_API_KEY=your_openrouter_api_key
   RUNWAYML_API_SECRET=your_runwayml_api_secret
   ```

3. **Run the Development Server:**
   ```bash
   npm run dev
   ```

4. **View the App:**
   Open [http://localhost:3000](http://localhost:3000) in your browser.

## Docker Deployment (VPS)

To deploy on a VPS using Docker:

1. Create a `.env` file with the necessary API keys.
2. Run the following command:
   ```bash
   docker-compose up -d --build
   ```
   This will build the standalone Next.js image, set up the SQLite data volumes, and expose the app on port 3000.

## Tech Stack
- Next.js (App Router)
- React & Tailwind CSS
- SQLite (`better-sqlite3`)
- Framer Motion
- `@runwayml/sdk`
- Vercel AI SDK (`ai`, `@ai-sdk/openai`)
- `@remotion/player`
