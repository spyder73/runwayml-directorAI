type ReferenceAssetLike = {
  id: string;
  local_url: string | null;
  runway_uri: string | null;
  stable_tag: string;
  usage_permissions: string;
  target_type: string;
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

const TAG_PATTERN = /^[a-z][a-z0-9_]{2,15}$/;

function canUseAsset(asset: ReferenceAssetLike) {
  return asset.usage_permissions === 'allowed' && TAG_PATTERN.test(asset.stable_tag) && Boolean(asset.runway_uri || asset.local_url);
}

function promptIncludesTag(promptText: string, tag: string) {
  return new RegExp(`(^|\\s)@${tag}(?=\\s|[.,;:!?)]|$)`).test(promptText);
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
}): PreparedSceneReferences {
  const byId = new Map(params.assets.map((asset) => [asset.id, asset]));
  const requestedAssets = params.sceneReferenceAssetIds
    .map((id) => byId.get(id))
    .filter((asset): asset is ReferenceAssetLike => Boolean(asset));

  const protagonistAssets = params.protagonistVisible
    ? params.assets.filter((asset) => asset.target_type === 'protagonist')
    : [];

  const selectedAssets: ReferenceAssetLike[] = [];
  const seen = new Set<string>();

  for (const asset of [...protagonistAssets, ...requestedAssets]) {
    if (seen.has(asset.id) || !canUseAsset(asset)) continue;
    selectedAssets.push(asset);
    seen.add(asset.id);
    if (selectedAssets.length === 16) break;
  }

  const missingTags = selectedAssets
    .map((asset) => asset.stable_tag)
    .filter((tag) => !promptIncludesTag(params.promptText, tag));

  const promptText = missingTags.length
    ? `${params.promptText.trim()}\n\nReference cues: ${missingTags.map((tag) => `@${tag}`).join(' ')}.`
    : params.promptText;

  return {
    promptText,
    selectedAssets,
    referenceImages: selectedAssets.map((asset) => ({
      uri: asset.runway_uri || asset.local_url || '',
      tag: asset.stable_tag,
    })),
  };
}
