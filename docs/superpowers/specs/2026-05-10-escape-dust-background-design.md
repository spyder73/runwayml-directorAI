# Escape Dust Background Design

## Context

The app currently has two separate ambient backgrounds:

- `src/app/page.tsx` uses nebula-like blurred color circles plus a simple starfield.
- `src/app/session/[id]/page.tsx` uses small floating particle dots behind the studio UI.

The new direction should apply to both surfaces so the app feels visually unified. The selected direction is **Escape Dust**: a subtle, continuously changing, Mandelbrot-inspired field made from many small pieces rather than large obvious shapes.

## Goals

- Replace large decorative blobs, target-like circles, and random-looking symbols with a dispersed fractal texture.
- Make the background continuously alive through slow zooming, drifting, fading, and re-forming fragments.
- Keep opacity low enough that chat, buttons, production panels, and media review remain readable.
- Add very low mouse reactivity: a tiny parallax nudge of the whole field, not cursor-following particles.
- Share the implementation across the landing page and session page.
- Respect reduced-motion preferences by calming or disabling the continuous animation.

## Visual Design

The background should read as a faint mathematical atmosphere:

- Fine dust points spread across the viewport in multiple scales.
- Short luminous contour shards that fade in, drift, and dissolve.
- Tiny geometric micro-cells, used sparingly, to give the field a fractal/recursive character.
- Faint filament layers that imply Mandelbrot escape contours without drawing big full circles.
- A very slow breathing zoom, roughly 6-10% over a long cycle, so the field feels alive but not like a tunnel.

The effect should avoid:

- Large isolated circles or lobes.
- Decorative orb backgrounds.
- Highly reactive cursor trails.
- High-contrast shapes behind text.
- Random-looking symbol placement.

## Interaction

Mouse movement should be treated as ambient input only. The component should track pointer position and convert it into a capped transform offset, approximately 4-8px on each axis. The transform should be smoothed so motion feels like subtle depth/parallax.

If the user has `prefers-reduced-motion: reduce`, the component should render a mostly static version with low-opacity texture and no continuous zoom.

## Architecture

Add a reusable client component at `src/components/AmbientFractalBackground.tsx`.

The component should:

- Render fixed, pointer-events-none layers.
- Generate a stable fragment set once per mount so React does not reshuffle positions during normal renders.
- Accept a lightweight `intensity` prop with `landing` and `session` values so the landing page can be slightly richer and the session page can stay quieter.
- Use CSS animations for continuous movement where possible.
- Use React pointer tracking only for the small parallax transform.

Update:

- `src/app/page.tsx` to replace the current nebula/starfield block with the shared component.
- `src/app/session/[id]/page.tsx` to replace the current particle array/background block with the shared component.

## Testing And Verification

Add focused source tests that assert the shared component is present and both pages render it with the intended intensity values.

Manual verification should include:

- Landing page renders with the Escape Dust background.
- Session page renders with the same visual language at lower intensity.
- Text and controls remain readable.
- Mouse movement causes only subtle parallax.
- Reduced-motion mode does not run the full continuous animation.
- No unrelated backend or pipeline behavior changes.
