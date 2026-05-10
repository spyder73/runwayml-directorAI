import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { AspectRatio } from './types';
import {
  applyProfileBucketUpdate,
  createReferenceAsset,
  proposeFilmTreatment,
  proposeSceneOutline,
} from './story-bucket';

type SqliteDatabase = Database.Database;

export type DemoSeedResult = {
  sessionId: string;
};

export function createDemoMemorySeed(database: SqliteDatabase, params: { aspectRatio?: AspectRatio } = {}): DemoSeedResult {
  const sessionId = uuidv4();
  const aspectRatio = params.aspectRatio || '16:9';

  database.prepare(`
    INSERT INTO sessions (id, mode, status, story_text, aspect_ratio, user_name, user_age)
    VALUES (?, 'single_memory', 'INTERVIEW_DYNAMIC', ?, ?, ?, ?)
  `).run(
    sessionId,
    'Maya remembers the night she left home and waited alone on a train platform with one suitcase.',
    aspectRatio,
    'Maya',
    '34',
  );

  applyProfileBucketUpdate(database, sessionId, {
    profile: {
      protagonistName: 'Maya',
      age: '34',
      lifePhase: 'newly independent in a city that still feels unfamiliar',
      emotionalTone: 'quiet courage with a little homesickness',
      visualDescription: 'Dark coat, tired eyes, one blue suitcase, trying to look braver than she feels.',
      summary: 'Maya is leaving an old life behind and discovering that courage can be very quiet.',
      themes: ['leaving home', 'reinvention', 'quiet courage'],
    },
    memoryCandidates: [
      {
        title: 'The platform light',
        description: 'Maya waits for the last train with one suitcase and a folded address in her hand.',
        emotionalPurpose: 'the first breath of independence after fear',
        visualSummary: 'wet platform, yellow station lights, blue suitcase, folded paper',
        status: 'accepted',
      },
    ],
  });

  createReferenceAsset(database, sessionId, {
    targetType: 'protagonist',
    targetLabel: 'Maya',
    visionDescription: 'Dark coat, tired eyes, blue suitcase, cautious but determined posture.',
    usagePermissions: 'description_only',
    source: 'description',
  });

  proposeFilmTreatment(database, sessionId, {
    title: 'The Platform Light',
    emotionalThesis: 'Leaving home can feel less like escape than quietly choosing yourself.',
    narrativeArc: 'fearful departure to lonely waiting to the first sign of self-trust',
    visualMotif: 'yellow station light reflecting on wet ground',
    narratorStyle: 'warm, spare documentary narration',
    endingFeeling: 'uncertain but brave',
    avoid: ['generic travel montage', 'triumphant music-video energy'],
  });

  proposeSceneOutline(database, sessionId, {
    scenes: [
      {
        title: 'The last platform',
        summary: 'Maya stands under the station lights with one suitcase.',
        narratorText: 'She left with one suitcase, a folded address, and no proof that courage would be enough.',
        imagePrompt: 'Cinematic empty train platform at night, wet pavement, yellow lights, blue suitcase, a woman in a dark coat seen from behind.',
        videoPrompt: 'The camera slowly pushes down the wet platform toward the blue suitcase as station lights flicker.',
        duration: 6,
        emotionalPurpose: 'the departure',
        protagonistVisible: false,
      },
      {
        title: 'The address',
        summary: 'A folded paper trembles in her hand.',
        narratorText: 'The address in her hand was small, but it was the first place that belonged only to her.',
        imagePrompt: 'Close cinematic detail of a folded address in a hand, rain drops on paper, station bench in soft focus.',
        videoPrompt: 'The hand tightens around the folded paper while the camera drifts closer and rain moves across the frame.',
        duration: 7,
        emotionalPurpose: 'choosing herself',
        protagonistVisible: false,
      },
      {
        title: 'The passing train',
        summary: 'A train passes without stopping, throwing light across the platform.',
        narratorText: 'For a moment, every passing window looked like a life she might have stayed inside.',
        imagePrompt: 'Wide cinematic station shot, train windows streaking by, warm light crossing wet pavement and a waiting suitcase.',
        videoPrompt: 'A train glides past and washes the platform in moving light as the camera pans with the windows.',
        duration: 7,
        emotionalPurpose: 'the life left behind',
        protagonistVisible: false,
      },
      {
        title: 'The train arrives',
        summary: 'Headlights appear at the end of the track.',
        narratorText: 'When the next train arrived, she did not feel ready. She stepped forward anyway.',
        imagePrompt: 'Cinematic train headlights approaching through mist, blue suitcase in foreground, yellow platform light behind it.',
        videoPrompt: 'Headlights rise through mist as the camera tracks beside the suitcase and the platform begins to glow.',
        duration: 6,
        emotionalPurpose: 'brave uncertainty',
        protagonistVisible: false,
      },
    ],
  });

  return { sessionId };
}
