# Render Progress Design

## Goal

Show final render progress in the session frontend while keeping the value reconnectable. If the user refreshes or reopens the session during final export, the UI should show the latest known render progress instead of falling back to an empty spinner.

## Current State

The session page already receives updates through `/api/pipeline/events`. During final export, the backend sets the session status to `RENDERING`, and `ProductionProgress` shows a spinner with "Preparing the final cut...".

Remotion already emits useful progress data from `renderMedia`: rendered frames, encoded frames, fractional progress, and stitch stage. That data is currently only written to the server log in `src/lib/final-render.ts`.

## Chosen Approach

Persist the latest render progress on the `render_final` media task and broadcast the same value over the existing session SSE stream.

This gives the frontend live updates while the tab is open, and it gives reconnecting clients a stable latest value from SQLite. The scope stays focused on final render progress rather than building a full task dashboard.

## Data Model

Extend `media_tasks` with render progress fields:

- `progress` as a numeric value from `0` to `1`
- `progress_message` as a short display label
- `progress_detail_json` for renderer-specific details such as rendered frames, encoded frames, total frames, and stitch stage

Existing databases should be upgraded defensively by adding missing columns during `initializeMediaTaskTables()`.

## Backend Flow

`renderFinalFilm()` will accept an optional progress callback and pass it to the internal Remotion render helper.

When Remotion starts, the callback reports total frame count and an initial progress value. During `onProgress`, the callback reports the latest values. Updates should be lightly throttled or bucketed to avoid excessive database writes and SSE chatter.

Both backend entry points that can perform a final render must use this callback:

- `executeRenderTask()` in `src/lib/pipeline_media.ts`
- `startFinalRenderJob()` in `src/lib/render-job.ts`

Each callback invocation will:

1. Update the `render_final` media task progress fields.
2. Broadcast a session SSE payload containing the latest `render_progress`.

On success, progress should be set to `1` before the session becomes `COMPLETED`. On failure, the existing failed-session behavior remains, with the last progress value still available for diagnostics.

## SSE Payload

Add `render_progress` to `SessionUpdatePayload`.

The initial `/api/pipeline/events` response should include `render_progress` when a render task exists, so refresh and reconnect show the latest progress immediately.

Progress payload shape:

- `progress`: number from `0` to `1`
- `message`: short UI label
- `renderedFrames`: number
- `encodedFrames`: number
- `totalFrames`: number or `null`
- `stitchStage`: string or `null`
- `updatedAt`: timestamp string when available

## Frontend UI

`src/app/session/[id]/page.tsx` will store `render_progress` from SSE and pass it into `ProductionProgress`.

In the `RENDERING` state, `ProductionProgress` will replace the spinner-only block with a determinate progress treatment when data is available:

- a percent label
- a slim progress bar
- rendered/encoded frame counts when available
- a short stage label such as "Rendering frames" or "Encoding final video"

If no progress has arrived yet, the current spinner fallback remains.

Progress should clear naturally once the session reaches `COMPLETED` or starts a new final render.

## Error Handling

If progress persistence fails, the render should not fail solely because of the progress update. The callback should avoid throwing into Remotion render execution.

If the frontend receives malformed progress details, it should ignore them and continue showing the existing spinner or the last valid progress state.

## Tests

Add focused tests for:

- media task table initialization adding progress columns
- progress persistence and parsing helpers
- `renderFinalFilm()` invoking the progress callback from Remotion start/progress events
- SSE initial/update payloads including `render_progress`
- `ProductionProgress` rendering a determinate final render progress state

Run the existing test, lint, and build checks after implementation.
