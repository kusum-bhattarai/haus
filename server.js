#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvFile } from './src/env.js';
import { createAgentRuntime } from './src/agent/index.js';
import { FLOOR_PLANS, findFloorPlan } from './src/floorPlans.js';
import { createLayer1Payload, Layer1ValidationError } from './src/layer1/index.js';
import { createLayer2Profile, Layer2ValidationError } from './src/layer2/index.js';
import { createLayer3Handoff, Layer3ValidationError, listStyleLibrary } from './src/layer3/index.js';
import { buildCacheDictionary } from './scripts/cache-dictionary.js';

loadEnvFile();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.join(__dirname, 'frontend');
const cacheDir = path.resolve(process.env.HAUS_CACHE_DIR ?? path.join(__dirname, '.haus-cache'));
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

export function createHausServer(options = {}) {
  const runtimePromise = Promise.resolve(options.agentRuntime ?? createAgentRuntime({ rootDir: __dirname }));

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const agentRuntime = await runtimePromise;

      if (req.method === 'GET' && url.pathname === '/api/floor-plans') {
        return sendJson(res, {
          floor_plans: FLOOR_PLANS.map(({ imagePath, ...plan }) => plan)
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/pipeline/layers-1-3') {
        return await handlePipeline(req, res);
      }

      if (req.method === 'GET' && url.pathname === '/api/reel-workspace') {
        return await handleReelWorkspace(res);
      }

      if (req.method === 'GET' && url.pathname === '/api/demo-cache') {
        return await handleDemoCache(res);
      }

      if (req.method === 'GET' && url.pathname === '/api/style-library') {
        return sendJson(res, await listStyleLibrary());
      }

      if (req.method === 'POST' && url.pathname === '/api/jobs') {
        return await handleCreateJob(req, res, agentRuntime);
      }

      const jobEventsMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
      if (req.method === 'GET' && jobEventsMatch) {
        return await handleJobEvents(req, res, agentRuntime, jobEventsMatch[1]);
      }

      const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
      if (req.method === 'GET' && jobMatch) {
        return await handleGetJob(res, agentRuntime, jobMatch[1]);
      }

      const shotManifestMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/shot-manifest$/);
      if (req.method === 'GET' && shotManifestMatch) {
        return await handleArtifactJson(res, agentRuntime, shotManifestMatch[1], 'shot_manifest');
      }

      const timelineMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/timeline$/);
      if (req.method === 'GET' && timelineMatch) {
        return await handleArtifactJson(res, agentRuntime, timelineMatch[1], 'timeline');
      }

      const reviewMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/review-report$/);
      if (req.method === 'GET' && reviewMatch) {
        return await handleArtifactJson(res, agentRuntime, reviewMatch[1], 'review_report');
      }

      const approvalMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/rooms\/([^/]+)\/still-approval$/);
      if (req.method === 'POST' && approvalMatch) {
        return await handleStillApproval(req, res, agentRuntime, approvalMatch[1], approvalMatch[2]);
      }

      const retryMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/rooms\/([^/]+)\/retry$/);
      if (req.method === 'POST' && retryMatch) {
        return await handleRetryRoom(req, res, agentRuntime, retryMatch[1], retryMatch[2]);
      }

      const editMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/edit$/);
      if (req.method === 'POST' && editMatch) {
        return await handleEditRoom(req, res, agentRuntime, editMatch[1]);
      }

      const assetMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/assets\/(.+)$/);
      if (req.method === 'GET' && assetMatch) {
        return serveJobAsset(res, agentRuntime, assetMatch[1], assetMatch[2]);
      }

      const reelAssetMatch = url.pathname.match(/^\/api\/reel-assembler\/([^/]+)\/assets\/(.+)$/);
      if (req.method === 'GET' && reelAssetMatch) {
        return serveReelAsset(res, reelAssetMatch[1], reelAssetMatch[2]);
      }

      const demoAssetMatch = url.pathname.match(/^\/api\/demo-assets\/(.+)$/);
      if (req.method === 'GET' && demoAssetMatch) {
        return serveCacheAsset(res, demoAssetMatch[1]);
      }

      if (req.method === 'GET') {
        return serveStatic(url.pathname, res);
      }

      return sendJson(res, { error: 'Not found' }, 404);
    } catch (error) {
      return sendError(res, error);
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createHausServer();
  server.listen(port, host, () => {
    console.log(`Haus demo server running at http://${host}:${port}`);
  });
}

async function handlePipeline(req, res) {
  const body = await readJsonBody(req);
  const floorPlan = findFloorPlan(body.floor_plan_id);

  if (!floorPlan) {
    return sendJson(res, { error: `Unknown floor_plan_id: ${body.floor_plan_id}` }, 400);
  }

  const payload = await createLayer1Payload({
    floor_plan_image: floorPlan.imagePath,
    pinterest_board_url: body.pinterest_board_url,
    brief: body.brief ?? null,
    objects: Array.isArray(body.objects) ? body.objects : [],
    platform: body.platform ?? 'all'
  });

  const profile = await createLayer2Profile(payload);
  const handoff = await createLayer3Handoff(profile);

  return sendJson(res, {
    floor_plan: floorPlanForClient(floorPlan),
    payload,
    profile,
    handoff
  });
}

async function handleCreateJob(req, res, agentRuntime) {
  const body = await readJsonBody(req);
  const job = await agentRuntime.createJob({
    floor_plan_id: body.floor_plan_id,
    pinterest_board_url: body.pinterest_board_url,
    brief: body.brief ?? null,
    objects: Array.isArray(body.objects) ? body.objects : [],
    platform: body.platform ?? 'all'
  });

  return sendJson(res, {
    job_id: job.job_id,
    status: job.status,
    current_state: job.current_state
  }, 202);
}

async function handleGetJob(res, agentRuntime, jobId) {
  const job = await agentRuntime.getJob(jobId);
  return sendJson(res, job);
}

async function handleReelWorkspace(res) {
  const root = path.join(cacheDir, 'reel-assembler');
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const folders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const folder = await newestFolderWithFinalReel(root, folders);
  if (!folder) return sendJson(res, { error: 'No reel assembler output found' }, 404);

  const folderPath = path.join(root, folder);
  const manifest = await readJsonFile(path.join(folderPath, 'manifest.json')).catch(() => ({}));
  const assetUrl = (relativePath) => `/api/reel-assembler/${encodeURIComponent(folder)}/assets/${relativePath}`;
  const priceScenes = (manifest.scenes ?? []).filter((scene) => scene.type === 'price_card');
  const clipScenes = (manifest.scenes ?? []).filter((scene) => scene.type === 'clip');
  const demoCache = await buildDemoCache();

  return sendJson(res, {
    folder,
    title: 'Springmarc style reels',
    promise: 'Same layout, different Pinterest-led styles, fast enough to keep browsing.',
    final_video_url: assetUrl('final_reel.mp4'),
    final_reels: demoCache.reels,
    cache_summary: demoCache.summary,
    floor_plan_reels: priceScenes.map((scene) => ({
      id: scene.id,
      plan_name: scene.plan?.name ?? scene.title,
      layout: scene.plan?.layout,
      sqft: scene.plan?.sqft,
      price: scene.plan?.price,
      thumbnail_url: assetUrl(path.relative(folderPath, scene.card_path)),
      segment_url: assetUrl(`${pad(scene.index)}-${scene.id}.mp4`)
    })),
    style_reels: [
      { id: 'japandi', name: 'Warm Japandi', source: 'Pinterest board', mood: 'Oak, linen, calm daylight', selected: true },
      { id: 'organic-modern', name: 'Organic Modern', source: 'Pin remix', mood: 'Stone, curves, soft contrast' },
      { id: 'resort-minimal', name: 'Resort Minimal', source: 'Pin remix', mood: 'Poolside neutrals, airy luxury' },
      { id: 'family-soft', name: 'Soft Family Calm', source: 'Object-aware', mood: 'Crib, work corner, warm storage' }
    ],
    clip_beats: clipScenes.map((scene) => ({
      id: scene.id,
      title: scene.title,
      subtitle: scene.subtitle,
      segment_url: assetUrl(`${pad(scene.index)}-${scene.id}.mp4`)
    }))
  });
}

async function handleDemoCache(res) {
  return sendJson(res, await buildDemoCache());
}

async function buildDemoCache() {
  const cacheRoot = cacheDir;
  const [pinterest, layer3, reels, assets, generationVideos, roomVideos, dictionary] = await Promise.all([
    summarizePinterestCache(path.join(cacheRoot, 'pinterest')),
    summarizeLayer3Cache(path.join(cacheRoot, 'layer3-creative-plans')),
    summarizeReelCache(path.join(cacheRoot, 'reel-assembler')),
    summarizeGenerationAssets(path.join(cacheRoot, 'agent', 'generations')),
    summarizeGenerationVideos(path.join(cacheRoot, 'agent', 'generations')),
    summarizeRoomVideos(path.join(cacheRoot, 'reel-assembler')),
    buildCacheDictionary({ cacheRoot }).catch(() => null)
  ]);

  const bundles = buildDemoBundles({ pinterest, layer3, reels, assets, generationVideos, roomVideos, dictionary });
  const styles = layer3.map((style, index) => {
    const linkedReels = reels.filter((reel) => styleReelMatch(style, reel));
    const linkedBundles = bundles.filter((bundle) => bundle.style?.cache_id === style.cache_id);
    return {
      ...style,
      pinterest_board_ids: linkedBundles.map((bundle) => bundle.board?.board_id).filter(Boolean),
      reel_ids: linkedReels.map((reel) => reel.id)
    };
  });

  return {
    generated_at: new Date().toISOString(),
    cache_root: path.basename(cacheRoot),
    summary: {
      pinterest_files: pinterest.files.length,
      pinterest_boards: pinterest.boards.length,
      pinterest_pins: pinterest.pin_count,
      layer3_styles: styles.length,
      final_reels: reels.length,
      visual_assets: assets.length,
      room_videos: roomVideos.length + generationVideos.length,
      coherent_styles: bundles.length
    },
    pinterest,
    layer3: styles,
    assets,
    generation_videos: generationVideos,
    room_videos: roomVideos,
    reels,
    bundles,
    dictionary
  };
}

function buildDemoBundles({ pinterest, layer3, reels, assets, generationVideos, roomVideos, dictionary }) {
  const stylesByHash = new Map(layer3.map((style) => [style.cache_id, style]));
  const boardsByUrl = new Map(pinterest.boards.map((board) => [board.source_url, board]));
  const assetByGeneration = indexByGenerationId(assets);
  const videoByGeneration = indexByGenerationId(generationVideos);

  return Object.entries(dictionary?.by_pinterest_url ?? {}).map(([boardUrl, entry]) => {
    const style = chooseBundleStyle(entry, stylesByHash, layer3);
    if (!style) return null;
    const board = boardsByUrl.get(boardUrl) ?? {
      board_id: pinterestBoardId(boardUrl),
      source_url: boardUrl,
      cache_ids: entry.pinterest_cache_indexes?.filter((item) => item.file).map((item) => item.hash_index) ?? [],
      pin_count: entry.pinterest_pin_count ?? 0,
      pins: []
    };
    const generationEntries = Object.values(entry.generations ?? {});
    const stills = generationEntries
      .filter((generation) => generation.kind === 'still' || generation.kind === 'anchor')
      .map((generation) => generationAssetFor(assetByGeneration, generation))
      .filter(Boolean);
    const videos = generationEntries
      .filter((generation) => generation.kind === 'video')
      .map((generation) => generationAssetFor(videoByGeneration, generation))
      .filter(Boolean);
    const linkedReels = reels.filter((reel) => styleReelMatch(style, reel));
    const reelFolders = new Set(linkedReels.map((reel) => reel.folder));
    const linkedRoomVideos = roomVideos.filter((video) => reelFolders.has(video.folder));

    return {
      id: boardUrl,
      pinterest_board_url: boardUrl,
      board,
      style,
      style_names: entry.style_names ?? [],
      generation_ids: generationEntries.map((generation) => generation.generation_id),
      assets: sortAssetsForRooms(style, stills),
      generation_videos: sortAssetsForRooms(style, videos),
      room_videos: sortAssetsForRooms(style, [...videos, ...linkedRoomVideos]),
      reels: linkedReels,
      cache_indexes: {
        pinterest: entry.pinterest_cache_indexes ?? [],
        layer3: entry.layer3_creative_plan_hashes ?? []
      }
    };
  }).filter(Boolean).sort((left, right) => (
    Number(right.assets.length > 0) - Number(left.assets.length > 0)
    || Number(right.room_videos.length > 0) - Number(left.room_videos.length > 0)
    || Number(right.reels.length > 0) - Number(left.reels.length > 0)
    || (right.assets.length + right.room_videos.length) - (left.assets.length + left.room_videos.length)
    || (right.board?.pin_count ?? 0) - (left.board?.pin_count ?? 0)
  ));
}

function chooseBundleStyle(entry, stylesByHash, layer3) {
  for (const hash of entry.layer3_creative_plan_hashes ?? []) {
    const style = stylesByHash.get(hash);
    if (style) return style;
  }
  return layer3.find((style) => entry.style_names?.includes(style.aesthetic_name)) ?? null;
}

function indexByGenerationId(items) {
  const map = new Map();
  for (const item of items) {
    const id = item.generation_id ?? generationIdFromPath(item.id);
    if (!id) continue;
    const existing = map.get(id) ?? [];
    existing.push(item);
    map.set(id, existing);
  }
  return map;
}

function generationAssetFor(index, generation) {
  const candidates = index.get(generation.generation_id) ?? [];
  const asset = candidates[0];
  if (!asset) return null;
  return {
    ...asset,
    generation_id: generation.generation_id,
    hash_index: generation.hash_index,
    room_id: generation.room_id,
    room_name: generation.room_name,
    room_hint: generation.room_id ?? asset.room_hint
  };
}

function sortAssetsForRooms(style, items) {
  const roomOrder = new Map((style.room_plans ?? []).map((room, index) => [normalizeToken(room.room_id), index]));
  return items.sort((left, right) => (
    (roomOrder.get(normalizeToken(left.room_id ?? left.room_hint)) ?? 999)
    - (roomOrder.get(normalizeToken(right.room_id ?? right.room_hint)) ?? 999)
    || (right.mtime_ms ?? 0) - (left.mtime_ms ?? 0)
  ));
}

async function summarizePinterestCache(dir) {
  const files = await jsonFiles(dir);
  const boards = new Map();
  let pinCount = 0;

  for (const file of files) {
    const pins = flattenPins(await readJsonFile(file.path).catch(() => []));
    pinCount += pins.length;
    for (const pin of pins) {
      const sourceUrl = pin.source_url ?? pin.board_url ?? null;
      if (!sourceUrl) continue;
      const boardId = pinterestBoardId(sourceUrl);
      const existing = boards.get(boardId) ?? {
        board_id: boardId,
        source_url: sourceUrl,
        cache_ids: [],
        pin_count: 0,
        pins: []
      };
      existing.cache_ids.push(file.id);
      existing.pin_count += 1;
      if (existing.pins.length < 9) {
        existing.pins.push({
          pin_id: pin.pin_id ?? pin.id ?? null,
          title: pin.title ?? 'Untitled pin',
          image_url: pin.image_url ?? null,
          cluster_label: pin.cluster_label ?? null
        });
      }
      boards.set(boardId, existing);
    }
  }

  return {
    path: path.relative(cacheDir, dir),
    files: files.map(({ id, mtime_ms }) => ({ cache_id: id, mtime_ms })),
    boards: [...boards.values()].map((board) => ({
      ...board,
      cache_ids: [...new Set(board.cache_ids)]
    })).sort((a, b) => b.pin_count - a.pin_count),
    pin_count: pinCount
  };
}

async function summarizeLayer3Cache(dir) {
  const files = await jsonFiles(dir);
  const styles = [];

  for (const file of files) {
    const plan = await readJsonFile(file.path).catch(() => null);
    if (!plan?.vibe_report) continue;
    styles.push({
      cache_id: file.id,
      mtime_ms: file.mtime_ms,
      aesthetic_name: plan.vibe_report.aesthetic_name ?? 'Cached style',
      summary: plan.vibe_report.summary ?? plan.overall_mood ?? '',
      lighting_mood: plan.vibe_report.lighting_mood ?? '',
      materials: (plan.vibe_report.materials ?? []).slice(0, 5),
      avoid: (plan.vibe_report.avoid ?? []).slice(0, 4),
      room_count: (plan.room_plans ?? plan.vibe_report.room_guidance ?? []).length,
      room_plans: (plan.room_plans ?? []).slice(0, 8).map((room) => ({
        room_id: room.room_id,
        camera_motion: room.camera_motion,
        duration_seconds: room.duration_seconds,
        must_include: (room.must_include ?? []).slice(0, 4)
      }))
    });
  }

  return styles.sort((a, b) => b.mtime_ms - a.mtime_ms);
}

async function summarizeReelCache(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const reels = [];

  for (const entry of entries.filter((item) => item.isDirectory())) {
    const folder = entry.name;
    const folderPath = path.join(dir, folder);
    const finalPath = path.join(folderPath, 'final_reel.mp4');
    const fileStat = await stat(finalPath).catch(() => null);
    if (!fileStat?.isFile()) continue;
    const manifest = await readJsonFile(path.join(folderPath, 'manifest.json')).catch(() => ({}));
    const scenes = manifest.scenes ?? [];
    const duration = scenes.reduce((sum, scene) => sum + Number(scene.duration ?? 0), 0);
    reels.push({
      id: folder,
      folder,
      final_file: 'final_reel.mp4',
      final_video_url: `/api/reel-assembler/${encodeURIComponent(folder)}/assets/final_reel.mp4`,
      size_bytes: fileStat.size,
      mtime_ms: fileStat.mtimeMs,
      scene_count: scenes.length,
      duration_seconds: Number(duration.toFixed(1)),
      clip_count: scenes.filter((scene) => scene.type === 'clip').length,
      card_count: scenes.filter((scene) => scene.type !== 'clip').length,
      voiceover_provider: scenes.find((scene) => scene.voiceover_provider)?.voiceover_provider ?? null,
      cache_relative_path: path.relative(cacheDir, finalPath),
      style_hint: reelStyleHint(folder, manifest),
      scenes: scenes.slice(0, 12).map((scene) => ({
        id: scene.id,
        type: scene.type,
        title: scene.title,
        subtitle: scene.subtitle,
        duration: scene.duration
      }))
    });
  }

  return reels.sort((a, b) => b.mtime_ms - a.mtime_ms);
}

async function summarizeGenerationAssets(dir) {
  const files = await walkFiles(dir);
  const assets = [];
  for (const filePath of files) {
    const extension = path.extname(filePath).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) continue;
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) continue;
    const relativePath = path.relative(cacheDir, filePath);
    assets.push({
      id: relativePath.replaceAll(path.sep, '/'),
      url: `/api/demo-assets/${relativePath.split(path.sep).map(encodeURIComponent).join('/')}`,
      name: path.basename(filePath),
      kind: fileAssetKind(filePath),
      room_hint: roomHintFromAsset(filePath),
      size_bytes: fileStat.size,
      mtime_ms: fileStat.mtimeMs
    });
  }
  return assets.sort((a, b) => b.mtime_ms - a.mtime_ms);
}

async function summarizeGenerationVideos(dir) {
  const files = await walkFiles(dir);
  const videos = [];
  for (const filePath of files) {
    if (path.extname(filePath).toLowerCase() !== '.mp4') continue;
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) continue;
    const relativePath = path.relative(cacheDir, filePath);
    videos.push({
      id: relativePath.replaceAll(path.sep, '/'),
      url: `/api/demo-assets/${relativePath.split(path.sep).map(encodeURIComponent).join('/')}`,
      name: path.basename(filePath),
      kind: 'video',
      room_hint: roomHintFromAsset(filePath),
      generation_id: generationIdFromPath(relativePath),
      size_bytes: fileStat.size,
      mtime_ms: fileStat.mtimeMs
    });
  }
  return videos.sort((a, b) => b.mtime_ms - a.mtime_ms);
}

async function summarizeRoomVideos(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const videos = [];

  for (const entry of entries.filter((item) => item.isDirectory())) {
    const folder = entry.name;
    const folderPath = path.join(dir, folder);
    const files = await readdir(folderPath, { withFileTypes: true }).catch(() => []);
    for (const file of files.filter((item) => item.isFile() && item.name.endsWith('.mp4') && item.name !== 'final_reel.mp4')) {
      const filePath = path.join(folderPath, file.name);
      const fileStat = await stat(filePath).catch(() => null);
      if (!fileStat?.isFile()) continue;
      videos.push({
        id: `${folder}/${file.name}`,
        url: `/api/reel-assembler/${encodeURIComponent(folder)}/assets/${encodeURIComponent(file.name)}`,
        name: file.name,
        folder,
        room_hint: roomHintFromVideo(file.name),
        size_bytes: fileStat.size,
        mtime_ms: fileStat.mtimeMs
      });
    }
  }

  return videos.sort((a, b) => b.mtime_ms - a.mtime_ms);
}

async function walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function fileAssetKind(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (name.startsWith('anchor_')) return 'anchor';
  if (name.startsWith('still-')) return 'styled still';
  if (filePath.includes(`${path.sep}cards${path.sep}`)) return 'card';
  if (filePath.includes(`${path.sep}captions${path.sep}`)) return 'caption';
  if (filePath.includes(`${path.sep}thumbnails${path.sep}`)) return 'thumbnail';
  return 'image';
}

function roomHintFromAsset(filePath) {
  const name = path.basename(filePath, path.extname(filePath)).toLowerCase();
  const match = name.match(/(?:anchor_)?([a-z]+(?:_[a-z]+)?)/);
  return match?.[1] ?? name;
}

function roomHintFromVideo(fileName) {
  return path.basename(fileName, '.mp4').replace(/^\d+-/, '');
}

function generationIdFromPath(filePath) {
  const parts = String(filePath).split(/[\\/]+/);
  const index = parts.lastIndexOf('generations');
  return index >= 0 ? parts[index + 1] : null;
}

async function newestFolderWithFinalReel(root, folders) {
  const candidates = [];
  for (const folder of folders) {
    const fileStat = await stat(path.join(root, folder, 'final_reel.mp4')).catch(() => null);
    if (fileStat?.isFile()) candidates.push({ folder, mtime_ms: fileStat.mtimeMs });
  }
  return candidates.sort((a, b) => b.mtime_ms - a.mtime_ms)[0]?.folder ?? null;
}

async function jsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(dir, entry.name);
    const fileStat = await stat(filePath).catch(() => null);
    files.push({
      id: path.basename(entry.name, '.json'),
      path: filePath,
      mtime_ms: fileStat?.mtimeMs ?? 0
    });
  }
  return files.sort((a, b) => b.mtime_ms - a.mtime_ms);
}

function flattenPins(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap((item) => Array.isArray(item) ? item : []);
}

function pinterestBoardId(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.slice(0, 2).join('/') || sourceUrl;
  } catch {
    return sourceUrl;
  }
}

function styleReelMatch(style, reel) {
  const haystack = normalizeToken(`${reel.folder} ${reel.style_hint}`);
  const tokens = normalizeToken(style.aesthetic_name).split('_').filter((token) => token.length > 3);
  return tokens.some((token) => haystack.includes(token));
}

function reelStyleHint(folder, manifest) {
  const text = JSON.stringify(manifest).toLowerCase();
  if (text.includes('japandi')) return 'Warm Japandi';
  if (text.includes('haven')) return 'Haven';
  if (text.includes('mid-century') || text.includes('botanical')) return 'Earthy Mid-Century Botanical';
  return folder.replace(/^springmarc[-_]?/i, '').replaceAll('-', ' ');
}

function normalizeToken(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

async function handleArtifactJson(res, agentRuntime, jobId, key) {
  const job = await agentRuntime.getJob(jobId);
  const value = job.artifacts?.[key];
  if (!value) return sendJson(res, { error: `${key} not found` }, 404);
  return sendJson(res, value);
}

async function handleJobEvents(req, res, agentRuntime, jobId) {
  const job = await agentRuntime.getJob(jobId);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });

  for (const event of job.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  const unsubscribe = agentRuntime.subscribe(jobId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  req.on('close', unsubscribe);
}

async function handleStillApproval(req, res, agentRuntime, jobId, roomId) {
  const body = await readJsonBody(req);
  setImmediate(() => {
    agentRuntime.approveStill(jobId, roomId, {
      approved: Boolean(body.approved),
      note: body.note ?? null
    }).catch((error) => console.error(error));
  });
  return sendJson(res, { ok: true, job_id: jobId, room_id: roomId }, 202);
}

async function handleRetryRoom(req, res, agentRuntime, jobId, roomId) {
  const body = await readJsonBody(req);
  setImmediate(() => {
    agentRuntime.retryRoom(jobId, roomId, {
      target: body.target ?? 'video',
      note: body.note ?? null,
      referencePinIds: Array.isArray(body.reference_pin_ids) ? body.reference_pin_ids : []
    }).catch((error) => console.error(error));
  });
  return sendJson(res, { ok: true, job_id: jobId, room_id: roomId }, 202);
}

async function handleEditRoom(req, res, agentRuntime, jobId) {
  const body = await readJsonBody(req);
  const message = (body.message ?? '').trim();
  if (!message) return sendJson(res, { error: 'message is required' }, 400);
  const roomId = typeof body.room_id === 'string' ? body.room_id : null;
  setImmediate(() => {
    agentRuntime.editRoom(jobId, message, { roomId }).catch((error) => console.error('[edit]', error));
  });
  return sendJson(res, { ok: true, job_id: jobId }, 202);
}

function floorPlanForClient({ imagePath, ...plan }) {
  return plan;
}

async function serveJobAsset(res, agentRuntime, jobId, filename) {
  const job = await agentRuntime.getJob(jobId).catch(() => null);
  if (!job) return sendJson(res, { error: 'Job not found' }, 404);

  const jobsDir = agentRuntime.jobManager.jobsDir;
  const assetPath = path.normalize(path.join(jobsDir, jobId, filename));
  if (!assetPath.startsWith(jobsDir)) return sendJson(res, { error: 'Invalid path' }, 400);

  try {
    const fileStat = await stat(assetPath);
    if (!fileStat.isFile()) return sendJson(res, { error: 'Not found' }, 404);
  } catch {
    return sendJson(res, { error: 'Not found' }, 404);
  }

  res.writeHead(200, { 'Content-Type': contentType(assetPath), 'Cache-Control': 'no-store' });
  createReadStream(assetPath).pipe(res);
}

async function serveReelAsset(res, folder, filename) {
  const root = path.join(cacheDir, 'reel-assembler');
  const folderPath = path.normalize(path.join(root, decodeURIComponent(folder)));
  const assetPath = path.normalize(path.join(folderPath, decodeURIComponent(filename)));
  if (!folderPath.startsWith(root) || !assetPath.startsWith(folderPath)) return sendJson(res, { error: 'Invalid path' }, 400);

  try {
    const fileStat = await stat(assetPath);
    if (!fileStat.isFile()) return sendJson(res, { error: 'Not found' }, 404);
  } catch {
    return sendJson(res, { error: 'Not found' }, 404);
  }

  res.writeHead(200, { 'Content-Type': contentType(assetPath), 'Cache-Control': 'no-store' });
  createReadStream(assetPath).pipe(res);
}

async function serveCacheAsset(res, filename) {
  const assetPath = path.normalize(path.join(cacheDir, decodeURIComponent(filename)));
  if (!assetPath.startsWith(cacheDir)) return sendJson(res, { error: 'Invalid path' }, 400);

  try {
    const fileStat = await stat(assetPath);
    if (!fileStat.isFile()) return sendJson(res, { error: 'Not found' }, 404);
  } catch {
    return sendJson(res, { error: 'Not found' }, 404);
  }

  res.writeHead(200, { 'Content-Type': contentType(assetPath) });
  createReadStream(assetPath).pipe(res);
}

async function serveStatic(requestPath, res) {
  const normalizedPath = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.normalize(path.join(frontendDir, normalizedPath));

  if (!filePath.startsWith(frontendDir)) {
    return sendJson(res, { error: 'Invalid path' }, 400);
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return sendJson(res, { error: 'Not found' }, 404);
    }
  } catch {
    return sendJson(res, { error: 'Not found' }, 404);
  }

  res.writeHead(200, { 'Content-Type': contentType(filePath), 'Cache-Control': 'no-store' });
  createReadStream(filePath).pipe(res);
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.js') return 'text/javascript; charset=utf-8';
  if (extension === '.png') return 'image/png';
  if (extension === '.svg') return 'image/svg+xml; charset=utf-8';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.mp4') return 'video/mp4';
  if (extension === '.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function pad(value) {
  return String(value).padStart(2, '0');
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function sendJson(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

function sendError(res, error) {
  const status = error instanceof Layer1ValidationError ||
    error instanceof Layer2ValidationError ||
    error instanceof Layer3ValidationError
    ? 400
    : 500;

  sendJson(res, {
    error: error.message,
    details: error.details ?? []
  }, status);
}
