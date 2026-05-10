export function classifyShots(assetBank) {
  const shots = (assetBank.assets ?? [])
    .filter((asset) => asset.path || asset.url)
    .map((asset) => ({
      ...asset,
      shot_type: asset.shot_type ?? classifyAsset(asset),
      coverage_role: classifyCoverageRole(asset),
      priority: classifyPriority(asset)
    }))
    .sort((left, right) => {
      if (left.priority !== right.priority) return right.priority - left.priority;
      return (left.sequence_index ?? 999) - (right.sequence_index ?? 999);
    });

  return {
    created_at: new Date().toISOString(),
    counts: summarizeCounts(shots),
    shots
  };
}

function classifyAsset(asset) {
  if (asset.kind === 'talking_head') return 'talking_head';
  if (asset.kind === 'drone') return 'drone';
  if (asset.kind === 'broll') return 'broll';
  return 'footage';
}

function classifyCoverageRole(asset) {
  if (asset.shot_type === 'talking_head') return 'avatar';
  if (asset.shot_type === 'drone') return 'scale';
  if (asset.shot_type === 'broll') return 'amenity';
  return 'room';
}

function classifyPriority(asset) {
  if (asset.shot_type === 'talking_head') return 4;
  if (asset.shot_type === 'drone') return 3;
  if (asset.shot_type === 'broll') return 2;
  if (asset.kind === 'approved_room_clip') return 2;
  return 1;
}

function summarizeCounts(shots) {
  return shots.reduce((counts, shot) => {
    counts.total += 1;
    counts[shot.shot_type] = (counts[shot.shot_type] ?? 0) + 1;
    return counts;
  }, { total: 0, footage: 0, broll: 0, drone: 0, talking_head: 0 });
}
