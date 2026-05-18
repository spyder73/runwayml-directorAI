import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

function validScene(overrides = {}) {
  return {
    id: 'scene-1',
    title: 'A Title',
    summary: 'A concise summary.',
    narratorText: 'A short line of narration.',
    imagePrompt: 'A cinematic image prompt.',
    videoPrompt: 'A cinematic video prompt.',
    duration: 6,
    emotionalPurpose: 'A clear emotional purpose.',
    protagonistVisible: true,
    ...overrides,
  };
}

test('scene outline tool input recovers summaries omitted by the model', () => {
  const { parseProposeSceneOutlineToolInput } = jiti('../src/lib/scene-outline-tool-input.ts');

  const result = parseProposeSceneOutlineToolInput({
    scenes: [
      validScene({
        title: 'The Interstellar Catalyst',
        summary: undefined,
        narratorText: "'Interstellar' pushed the door open.",
      }),
    ],
    chatMessage: 'Review this outline.',
  });

  assert.equal(result.success, true);
  assert.equal(result.normalized, true);
  assert.equal(result.data.scenes[0].title, 'The Interstellar Catalyst');
  assert.equal(result.data.scenes[0].summary, "'Interstellar' pushed the door open.");
  assert.match(result.issues.join('\n'), /scenes\.0\.summary/);
});

test('scene outline tool input recovers titles omitted by the model', () => {
  const { parseProposeSceneOutlineToolInput } = jiti('../src/lib/scene-outline-tool-input.ts');

  const result = parseProposeSceneOutlineToolInput({
    scenes: [
      validScene({
        title: undefined,
        summary: 'Dorian standing in an urban night scene in Krakow.',
      }),
    ],
  });

  assert.equal(result.success, true);
  assert.equal(result.normalized, true);
  assert.equal(result.data.scenes[0].title, 'Dorian standing in an urban night scene in Krakow.');
  assert.equal(result.data.scenes[0].summary, 'Dorian standing in an urban night scene in Krakow.');
  assert.match(result.issues.join('\n'), /scenes\.0\.title/);
});

test('scene outline tool input still rejects unrecoverable malformed scenes', () => {
  const { parseProposeSceneOutlineToolInput } = jiti('../src/lib/scene-outline-tool-input.ts');

  const result = parseProposeSceneOutlineToolInput({
    scenes: [
      {
        title: 'No prompts or duration',
        summary: 'This is not enough for production.',
      },
    ],
  });

  assert.equal(result.success, false);
  assert.match(result.issues.join('\n'), /imagePrompt/);
  assert.match(result.issues.join('\n'), /videoPrompt/);
});

test('scene outline text parser accepts fenced JSON from provider-compatible generation', () => {
  const { parseProposeSceneOutlineText } = jiti('../src/lib/scene-outline-tool-input.ts');

  const result = parseProposeSceneOutlineText(`
    Here is the outline:
    \`\`\`json
    {
      "scenes": [
        {
          "title": "Interstellar Catalyst",
          "summary": "Watching Interstellar turns curiosity into a physics path.",
          "narratorText": "A black hole became an invitation.",
          "imagePrompt": "Dorian watching cosmic light from a cinema screen.",
          "videoPrompt": "The camera slowly pushes toward Dorian as cosmic light moves across his face.",
          "duration": 6
        }
      ],
      "directorReply": "I drafted the scene outline below."
    }
    \`\`\`
  `);

  assert.equal(result.success, true);
  assert.equal(result.data.scenes[0].title, 'Interstellar Catalyst');
  assert.equal(result.data.scenes[0].summary, 'Watching Interstellar turns curiosity into a physics path.');
});

test('scene outline schema describes title and summary as distinct fields', () => {
  const { proposeSceneOutlineSchema } = jiti('../src/lib/ai/tools.ts');
  const sceneSchema = proposeSceneOutlineSchema.shape.scenes.element;

  assert.match(sceneSchema.shape.title.description, /2-6 words/i);
  assert.match(sceneSchema.shape.title.description, /card label/i);
  assert.match(sceneSchema.shape.summary.description, /one sentence/i);
  assert.match(sceneSchema.shape.summary.description, /why it matters/i);
  assert.notEqual(sceneSchema.shape.title.description, sceneSchema.shape.summary.description);
});

test('pipeline logs scene outline drafting checkpoints instead of direct parse crashes', () => {
  const pipelineSource = fs.readFileSync(new URL('../src/lib/pipeline.ts', import.meta.url), 'utf8');
  const storyBucketSource = fs.readFileSync(new URL('../src/lib/story-bucket.ts', import.meta.url), 'utf8');

  assert.match(pipelineSource, /parseProposeSceneOutlineToolInput/);
  assert.match(pipelineSource, /parseProposeSceneOutlineText/);
  assert.match(pipelineSource, /event:\s*'scene_outline_tool_received'/);
  assert.match(pipelineSource, /event:\s*'scene_outline_tool_normalized'/);
  assert.match(pipelineSource, /event:\s*'scene_outline_persisted'/);
  assert.match(pipelineSource, /event:\s*'scene_outline_fallback_draft'/);
  assert.match(pipelineSource, /sceneOutlineLogScenes/);
  assert.match(pipelineSource, /shouldDraftOutlineAfterTurn/);
  assert.match(pipelineSource, /finalReply\s*=\s*outlineReply/);
  assert.doesNotMatch(pipelineSource, /generateObject/);
  assert.doesNotMatch(pipelineSource, /proposeSceneOutlineSchema\.parse\(call\.input\)/);

  assert.match(storyBucketSource, /event:\s*'production_scenes_created'/);
  assert.match(storyBucketSource, /narratorText:\s*scene\.narrator_text/);
});
