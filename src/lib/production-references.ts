type ReferenceAssetLike = {
  id: string;
  local_url: string | null;
  runway_uri: string | null;
  stable_tag: string;
  usage_permissions: string;
  target_type: string;
  owner_entity_id?: string | null;
  vision_description?: string | null;
};

type PreparedReferenceImage = {
  uri: string;
  tag: string;
};

export type PreparedSceneReferences = {
  promptText: string;
  selectedAssets: ReferenceAssetLike[];
  referenceImages: PreparedReferenceImage[];
};

type ReferenceEntityLike = {
  id: string;
  display_name: string;
  reference_asset_id?: string | null;
};

const TAG_PATTERN = /^[a-z][a-z0-9_]{2,15}$/;
const TAG_CAPTURE_PATTERN = /@([a-zA-Z][a-zA-Z0-9_]*)/g;
const PERSON_REFERENCE_TYPES = new Set(['protagonist', 'person', 'family', 'friend']);
const GENERIC_PERSON_TAGS = new Set(['self', 'person', 'protagonist', 'reference']);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function canUseAsset(asset: ReferenceAssetLike) {
  return asset.usage_permissions === 'allowed' && TAG_PATTERN.test(asset.stable_tag) && Boolean(asset.runway_uri || asset.local_url);
}

function normalizeReferenceTag(value: string | undefined | null) {
  const normalized = (value || '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  let tag = normalized || 'reference';
  if (!/^[a-z]/.test(tag)) tag = `ref_${tag}`;
  tag = tag.slice(0, 16).replace(/_+$/g, '');
  if (tag.length < 3) tag = `${tag}_ref`.slice(0, 3);
  return tag;
}

export function extractPromptReferenceTags(promptText: string) {
  const seen = new Set<string>();
  for (const match of promptText.matchAll(TAG_CAPTURE_PATTERN)) {
    const tag = match[1]?.trim();
    if (tag) seen.add(tag);
  }
  return [...seen];
}

function promptIncludesTag(promptText: string, tag: string) {
  return new RegExp(`(^|\\s)@${tag}(?=\\s|[.,;:!?)]|$)`).test(promptText);
}

function promptMentionsEntity(promptText: string, displayName: string) {
  const trimmed = displayName.trim();
  if (!trimmed) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(trimmed)}(?=$|[^a-z0-9])`, 'i').test(promptText);
}

function plainReferenceLabel(tag: string) {
  const words = tag
    .replace(/^@/, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return 'Reference';
  return words.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function replaceFirstPlainMentionWithTag(promptText: string, displayName: string, tag: string) {
  const trimmed = displayName.trim();
  if (!trimmed || promptIncludesTag(promptText, tag)) return promptText;

  const mentionPattern = new RegExp(`(^|[^@a-z0-9])(${escapeRegExp(trimmed)})(?=$|[^a-z0-9])`, 'i');
  return promptText.replace(mentionPattern, (_match, prefix: string) => `${prefix}@${tag}`);
}

function findUsableOwnedAsset(assets: ReferenceAssetLike[], entityId: string, excludedAssetId?: string) {
  return assets.find((asset) => asset.id !== excludedAssetId && asset.owner_entity_id === entityId && canUseAsset(asset));
}

function preferUsableAsset(asset: ReferenceAssetLike, assets: ReferenceAssetLike[]) {
  if (canUseAsset(asset)) return asset;
  if (asset.owner_entity_id) {
    const ownedAsset = findUsableOwnedAsset(assets, asset.owner_entity_id, asset.id);
    if (ownedAsset) return ownedAsset;
  }
  return asset;
}

export function resolveReferenceAssetToken(
  token: string,
  assets: ReferenceAssetLike[],
  entities: ReferenceEntityLike[] = [],
) {
  const trimmed = token.trim().replace(/^@/, '');
  if (!trimmed) return undefined;

  const assetById = assets.find((asset) => asset.id === trimmed);
  if (assetById) return preferUsableAsset(assetById, assets);

  const normalizedToken = normalizeReferenceTag(trimmed);
  const assetByTag = assets.find((asset) => asset.stable_tag === normalizedToken);
  if (assetByTag) return preferUsableAsset(assetByTag, assets);

  const entity = entities.find((candidate) => (
    candidate.id === trimmed || normalizeReferenceTag(candidate.display_name) === normalizedToken
  ));
  if (!entity) return undefined;

  const entityAsset = entity.reference_asset_id
    ? assets.find((asset) => asset.id === entity.reference_asset_id)
    : undefined;
  if (entityAsset) {
    const preferredAsset = preferUsableAsset(entityAsset, assets);
    if (canUseAsset(preferredAsset)) return preferredAsset;
  }

  const ownedAsset = findUsableOwnedAsset(assets, entity.id);
  return ownedAsset || entityAsset;
}

export function resolvePromptMentionedReferenceAssets(
  promptText: string,
  assets: ReferenceAssetLike[],
  entities: ReferenceEntityLike[] = [],
) {
  return entities
    .filter((entity) => promptMentionsEntity(promptText, entity.display_name))
    .map((entity) => resolveReferenceAssetToken(entity.id, assets, entities))
    .filter((asset): asset is ReferenceAssetLike => Boolean(asset));
}

export function rewritePromptReferenceTags(promptText: string, replacements: Map<string, string>) {
  if (!replacements.size) return promptText;
  return promptText.replace(TAG_CAPTURE_PATTERN, (match, tag: string) => {
    const replacement = replacements.get(normalizeReferenceTag(tag));
    return replacement ? `@${replacement}` : match;
  });
}

function stripPromptReferenceTags(promptText: string, tags: Set<string>) {
  if (!tags.size) return promptText;
  return promptText.replace(TAG_CAPTURE_PATTERN, (match, tag: string) => (
    tags.has(normalizeReferenceTag(tag)) ? plainReferenceLabel(tag) : match
  ));
}

function entityNamesForAsset(asset: ReferenceAssetLike, entities: ReferenceEntityLike[]) {
  const names = entities
    .filter((entity) => entity.reference_asset_id === asset.id || entity.id === asset.owner_entity_id)
    .map((entity) => entity.display_name)
    .filter((name) => name.trim().length > 0);

  if (
    PERSON_REFERENCE_TYPES.has(asset.target_type)
    && !GENERIC_PERSON_TAGS.has(asset.stable_tag)
    && !names.some((name) => normalizeReferenceTag(name) === asset.stable_tag)
  ) {
    names.push(plainReferenceLabel(asset.stable_tag));
  }

  return names;
}

function bindSelectedAssetTagsInline(
  promptText: string,
  selectedAssets: ReferenceAssetLike[],
  entities: ReferenceEntityLike[],
) {
  let rewritten = promptText;

  for (const asset of selectedAssets) {
    if (promptIncludesTag(rewritten, asset.stable_tag)) continue;
    for (const name of entityNamesForAsset(asset, entities)) {
      const next = replaceFirstPlainMentionWithTag(rewritten, name, asset.stable_tag);
      if (next !== rewritten) {
        rewritten = next;
        break;
      }
    }
  }

  return rewritten;
}

export function parseReferenceAssetIds(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
  } catch {
    return [];
  }
}

export function prepareSceneReferences(params: {
  promptText: string;
  sceneReferenceAssetIds: string[];
  protagonistVisible: boolean;
  assets: ReferenceAssetLike[];
  entities?: ReferenceEntityLike[];
  canonicalProtagonistReferenceAssetId?: string | null;
}): PreparedSceneReferences {
  const byId = new Map(params.assets.map((asset) => [asset.id, asset]));
  const requestedAssets = params.sceneReferenceAssetIds
    .map((id) => byId.get(id) || resolveReferenceAssetToken(id, params.assets, params.entities))
    .filter((asset): asset is ReferenceAssetLike => Boolean(asset));

  const canonicalProtagonistAsset = params.canonicalProtagonistReferenceAssetId
    ? params.assets.find((asset) => asset.id === params.canonicalProtagonistReferenceAssetId && canUseAsset(asset))
    : undefined;
  const fallbackProtagonistAsset = params.assets.find((asset) => asset.target_type === 'protagonist' && canUseAsset(asset));
  const protagonistAssets = params.protagonistVisible
    ? [canonicalProtagonistAsset || fallbackProtagonistAsset].filter((asset): asset is ReferenceAssetLike => Boolean(asset))
    : [];

  const promptTagReplacements = new Map<string, string>();
  const strippedPromptTags = new Set<string>();
  const promptReferencedAssets = extractPromptReferenceTags(params.promptText)
    .map((tag) => {
      const normalizedTag = normalizeReferenceTag(tag);
      const asset = resolveReferenceAssetToken(tag, params.assets, params.entities);
      if (!asset) {
        strippedPromptTags.add(normalizedTag);
        return undefined;
      }
      if (normalizedTag !== asset.stable_tag) {
        promptTagReplacements.set(normalizedTag, asset.stable_tag);
      }
      if (!canUseAsset(asset)) {
        strippedPromptTags.add(normalizedTag);
      }
      return asset;
    })
    .filter((asset): asset is ReferenceAssetLike => Boolean(asset));
  const mentionedEntityAssets = resolvePromptMentionedReferenceAssets(params.promptText, params.assets, params.entities);

  const rewrittenPromptText = stripPromptReferenceTags(
    rewritePromptReferenceTags(params.promptText, promptTagReplacements),
    strippedPromptTags,
  );

  const selectedAssets: ReferenceAssetLike[] = [];
  const seen = new Set<string>();

  for (const asset of [...protagonistAssets, ...requestedAssets, ...promptReferencedAssets, ...mentionedEntityAssets]) {
    if (seen.has(asset.id) || !canUseAsset(asset)) continue;
    selectedAssets.push(asset);
    seen.add(asset.id);
    if (selectedAssets.length === 16) break;
  }

  const promptTextWithInlineTags = bindSelectedAssetTagsInline(
    rewrittenPromptText,
    selectedAssets,
    params.entities || [],
  );

  const missingTags = selectedAssets
    .map((asset) => asset.stable_tag)
    .filter((tag) => !promptIncludesTag(promptTextWithInlineTags, tag));

  const promptText = missingTags.length
    ? `${promptTextWithInlineTags.trim()}\n\nReference cues: ${missingTags.map((tag) => `@${tag}`).join(' ')}.`
    : promptTextWithInlineTags;

  return {
    promptText,
    selectedAssets,
    referenceImages: selectedAssets.map((asset) => ({
      uri: asset.runway_uri || asset.local_url || '',
      tag: asset.stable_tag,
    })),
  };
}
