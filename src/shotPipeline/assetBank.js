import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm']);

export async function buildAssetBank(job, options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const floorPlanId = job.input?.floor_plan_id ?? job.payload?.floor_plan_id ?? job.floor_plan?.id ?? 'unknown';
  const manifest = options.propertyAssetManifest
    ? normalizeInlineManifest(options.propertyAssetManifest, rootDir)
    : await loadPropertyManifest(rootDir, floorPlanId);
  const assets = [];
  const warnings = [];

  for (const room of job.rooms ?? []) {
    if (room.artifacts?.styled_image_path || room.artifacts?.styled_image_url) {
      assets.push({
        asset_id: `still:${room.room_id}`,
        label: `${room.room_name} still`,
        kind: 'room_still',
        shot_type: 'footage',
        media_type: 'image',
        room_id: room.room_id,
        room_name: room.room_name,
        sequence_index: room.sequence_index ?? 0,
        path: room.artifacts.styled_image_path ?? null,
        url: room.artifacts.styled_image_url ?? null,
        duration_seconds: 4,
        motion_preset: room.current_motion_mode ?? 'push_in',
        tags: ['room', 'still']
      });
    }
  }

  for (const clip of job.artifacts?.approved_room_clips ?? []) {
    const room = (job.rooms ?? []).find((candidate) => candidate.room_id === clip.room_id);
    assets.push({
      asset_id: `clip:${clip.room_id}`,
      label: room ? `${room.room_name} clip` : clip.room_id,
      kind: 'approved_room_clip',
      shot_type: 'footage',
      media_type: 'video',
      room_id: clip.room_id,
      room_name: room?.room_name ?? clip.room_id,
      sequence_index: room?.sequence_index ?? 0,
      path: clip.path ?? null,
      url: clip.url ?? null,
      duration_seconds: room?.video_generation?.duration_seconds ?? 5,
      motion_preset: room?.current_motion_mode ?? 'lateral_pan',
      tags: ['room', 'video']
    });
  }

  const manifestAssets = manifest?.assets ?? [];
  const manifestBaseDir = manifest?.__base_dir ?? path.dirname(manifest?.manifest_path ?? rootDir);
  for (const asset of manifestAssets) {
    const resolvedPath = asset.path ? path.resolve(manifestBaseDir, asset.path) : null;
    const mediaType = detectMediaType(asset.media_type, resolvedPath);
    if (!resolvedPath || mediaType === 'unknown') {
      warnings.push(`Skipped manifest asset ${asset.id ?? asset.label ?? 'unknown'} due to unsupported media.`);
      continue;
    }
    assets.push({
      asset_id: asset.id ?? `manifest:${assets.length}`,
      label: asset.label ?? asset.type ?? 'asset',
      kind: asset.type ?? 'asset',
      shot_type: normalizeShotType(asset.type),
      media_type: mediaType,
      room_id: asset.room_id ?? null,
      room_name: asset.room_name ?? null,
      sequence_index: Number(asset.sequence_index ?? 999),
      path: resolvedPath,
      url: null,
      duration_seconds: Number(asset.duration_seconds ?? defaultDurationFor(asset.type, mediaType)),
      motion_preset: asset.motion_preset ?? defaultMotionFor(asset.type),
      tags: Array.isArray(asset.tags) ? asset.tags : []
    });
  }

  const avatarBaseImagePath = manifest?.avatar_base_image
    ? path.resolve(manifestBaseDir, manifest.avatar_base_image)
    : null;
  const musicBedPath = manifest?.music_bed
    ? path.resolve(manifestBaseDir, manifest.music_bed)
    : null;

  return {
    floor_plan_id: floorPlanId,
    manifest_path: manifest?.manifest_path ?? null,
    avatar_base_image_path: avatarBaseImagePath,
    music_bed_path: musicBedPath,
    assets,
    warnings
  };
}

async function loadPropertyManifest(rootDir, floorPlanId) {
  const candidates = [
    path.join(rootDir, 'property_assets', floorPlanId, 'manifest.json'),
    path.join(rootDir, 'output', 'property_assets', floorPlanId, 'manifest.json')
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      const manifest = JSON.parse(await readFile(candidate, 'utf8'));
      return { ...manifest, manifest_path: candidate };
    } catch {
      // Keep scanning candidate paths.
    }
  }

  return null;
}

function normalizeInlineManifest(manifest, rootDir) {
  if (!manifest) return null;
  const baseDir = manifest.base_dir ? path.resolve(rootDir, manifest.base_dir) : rootDir;
  return {
    ...manifest,
    manifest_path: manifest.manifest_path ?? path.join(baseDir, 'inline-manifest.json'),
    __base_dir: baseDir
  };
}

function normalizeShotType(type) {
  if (type === 'drone') return 'drone';
  if (type === 'broll') return 'broll';
  if (type === 'talking_head') return 'talking_head';
  return 'footage';
}

function detectMediaType(mediaType, filePath) {
  if (mediaType === 'image' || mediaType === 'video') return mediaType;
  const ext = path.extname(filePath ?? '').toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return 'unknown';
}

function defaultDurationFor(type, mediaType) {
  if (type === 'talking_head') return 3;
  if (type === 'drone') return 4;
  if (type === 'broll') return 3;
  return mediaType === 'image' ? 4 : 5;
}

function defaultMotionFor(type) {
  if (type === 'talking_head') return 'slow_hold';
  if (type === 'drone') return 'drone_descend';
  if (type === 'broll') return 'orbit';
  return 'lateral_pan';
}
