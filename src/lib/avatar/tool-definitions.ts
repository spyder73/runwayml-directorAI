import { pageActionTools } from '@runwayml/avatars-react/api';
import type { RealtimeSessionCreateParams } from '@runwayml/sdk/resources/realtime-sessions';

type AvatarBackendTool = RealtimeSessionCreateParams.BackendRpc & {
  parameters: NonNullable<RealtimeSessionCreateParams.BackendRpc['parameters']>;
  timeoutSeconds: 8;
};

type AvatarClientTool = RealtimeSessionCreateParams.ClientEvent & {
  parameters: NonNullable<RealtimeSessionCreateParams.ClientEvent['parameters']>;
};

const jsonPayloadParameter = {
  name: 'payloadJson',
  type: 'string',
  required: true,
  description: 'A compact JSON string containing the structured payload for this action.',
} as const;

function backendTool(
  name: string,
  description: string,
  parameters: AvatarBackendTool['parameters'] = [jsonPayloadParameter],
): AvatarBackendTool {
  return {
    type: 'backend_rpc',
    name,
    description,
    parameters,
    timeoutSeconds: 8,
  };
}

function clientEventTool(
  name: string,
  description: string,
  parameters: AvatarClientTool['parameters'],
): AvatarClientTool {
  return {
    type: 'client_event',
    name,
    description,
    parameters,
  };
}

export const avatarClientTools = [
  clientEventTool('set_avatar_layout', 'Move the avatar call layout for the current workflow moment.', [
    {
      name: 'layout',
      type: 'string',
      enum: ['stage', 'docked', 'upload', 'review', 'email'],
      required: true,
      description: 'The layout mode the frontend should use.',
    },
    {
      name: 'reason',
      type: 'string',
      description: 'Short natural reason for the layout move.',
    },
  ]),
  clientEventTool('show_upload_dropzone', 'Reveal the upload dropzone below the avatar call.', [
    {
      name: 'targetLabel',
      type: 'string',
      description: 'The person, place, object, or scene reference the upload is for.',
    },
  ]),
  clientEventTool('highlight_review_panel', 'Highlight the active treatment, outline, or production review panel.', [
    {
      name: 'panel',
      type: 'string',
      enum: ['treatment', 'outline', 'frames', 'production'],
      required: true,
      description: 'The panel to prioritize.',
    },
  ]),
  clientEventTool('focus_email_prompt', 'Focus the render notification email prompt after production handoff.', [
    {
      name: 'reason',
      type: 'string',
      description: 'Short natural reason for focusing the email prompt.',
    },
  ]),
];

export const avatarBackendTools = [
  backendTool(
    'update_profile_bucket',
    'Save profile facts, timeline events, people, places, themes, and candidate scenes from a spoken answer. Include directorReply with the next short spoken follow-up when useful.',
  ),
  backendTool('request_reference_upload', 'Create an optional image upload checkpoint for a concrete person, place, object, or scene reference.', [
    {
      name: 'targetType',
      type: 'string',
      required: true,
      description: 'Reference target type such as protagonist, person, place, object, or scene_reference.',
    },
    {
      name: 'targetLabel',
      type: 'string',
      required: true,
      description: 'Human label for the reference.',
    },
    {
      name: 'promptText',
      type: 'string',
      required: true,
      description: 'User-facing upload request text.',
    },
    {
      name: 'reason',
      type: 'string',
      required: true,
      description: 'Why this reference helps the film.',
    },
    {
      name: 'fallbackPrompt',
      type: 'string',
      description: 'What to ask if the user skips the upload.',
    },
    {
      name: 'referenceScope',
      type: 'string',
      enum: ['general', 'scene'],
      description: 'Whether the reference is general or tied to a specific scene.',
    },
    {
      name: 'sceneTitle',
      type: 'string',
      description: 'Scene title if this is scene-specific.',
    },
    {
      name: 'entityId',
      type: 'string',
      description: 'Known entity id when linking the request to a saved person/place/object.',
    },
  ]),
  backendTool('add_reference_subject', 'Attach an uploaded or described reference to a named person, place, or object. Pass payloadJson. The reply must keep the conversation moving with one follow-up.'),
  backendTool('save_reference_description', 'Save visual details when the user describes a reference instead of uploading. Pass payloadJson with one next follow-up question.'),
  backendTool('record_memory_sketch', 'Record a lightweight memory sketch candidate without waiting on image generation. Pass payloadJson.'),
  backendTool('save_sketch_feedback', 'Record whether the user accepted, rejected, or revised a memory sketch. Pass payloadJson.'),
  backendTool('propose_film_treatment', 'Save the reviewable film treatment before scene outline. Pass payloadJson.'),
  backendTool('propose_scene_outline', 'Save the reviewable scene outline. Pass payloadJson.'),
  backendTool('revise_scene_outline', 'Revise one scene outline item from the user feedback. Pass payloadJson.'),
  backendTool('lock_scene_outline', 'Lock the approved outline and start automatic production through final render. Use only after clear spoken user approval.', [
    {
      name: 'confirmation',
      type: 'string',
      description: 'Short approval phrase from the user.',
    },
  ]),
] satisfies AvatarBackendTool[];

export const avatarSessionTools = [
  ...pageActionTools,
  ...avatarClientTools,
  ...avatarBackendTools,
];
