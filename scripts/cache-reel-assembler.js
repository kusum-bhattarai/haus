#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { accessSync, createWriteStream, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { fal } from '@fal-ai/client';

import { extractFirstMediaUrl } from '../src/agent/genmediaAdapter.js';
import { buildCacheDictionary } from './cache-dictionary.js';

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const DEFAULT_JOB_ID = 'a9c86517-d38d-4db0-9bc9-5ca967d2316c';
let OUT_W = 1080;
let OUT_H = 1920;
const FPS = 24;
const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';
const DEFAULT_ELEVENLABS_MODEL = 'eleven_multilingual_v2';
const DEFAULT_ELEVENLABS_VOICE_ID = 'eXpIbVcVbLo8ZJQDlDnl';
const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
const DEFAULT_OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_OPENAI_TTS_VOICE = 'alloy';
const DEFAULT_THUMBNAIL_MODEL = 'fal-ai/gemini-3.1-flash-image-preview/edit';
const DEFAULT_FAL_TTS_MODEL = 'fal-ai/dia-tts';
const DEFAULT_MAX_CLIP_SECONDS = 2.8;
const DEFAULT_TARGET_SECONDS = 20;
const SAFE_REEL_X_PAD = 72;
const SAFE_REEL_Y_PAD = 310;

const FLOOR_PLANS = [
  { id: '1b1', image: 'frontend/floor_plans/1b1.png', name: 'Unit A1', layout: '1 BED / 1 BATH', sqft: '689 SQ FT', price: 'STARTING AT $2,040' },
  { id: '2b2', image: 'frontend/floor_plans/2b2.png', name: 'Unit B2', layout: '2 BED / 2 BATH', sqft: '988 SQ FT', price: 'STARTING AT $2,620' },
  { id: '3b2', image: 'frontend/floor_plans/3b2.png', name: 'Unit C3', layout: '3 BED / 2 BATH', sqft: '1,250 SQ FT', price: 'STARTING AT $3,180' }
];

function buildVibeCopy(job, style = null) {
  const vibe = style?.vibe_report ?? job.handoff?.vibe_report ?? {};
  const guidanceMap = new Map((vibe.room_guidance ?? []).map((g) => [g.room_id, g]));
  return {
    guidanceMap,
    aestheticName: vibe.aesthetic_name ?? style?.aesthetic_profile?.style_name ?? style?.style_id ?? 'Your Style',
    summary: vibe.summary ?? null,
    topMaterial: (vibe.materials ?? [])[0] ?? null
  };
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  applyRenderPreset(args);
  if (args.checkElevenLabs) {
    await checkElevenLabs();
    return;
  }
  const job = await loadJob(args.jobId ?? DEFAULT_JOB_ID);
  const style = await loadStyleEntry(args);
  await assertJobStyleMatchesCache(job, style);
  const edit = args.editJson ? JSON.parse(await readFile(path.resolve(args.editJson), 'utf8')) : null;
  const outputDir = path.resolve(args.outputDir ?? `.haus-cache/reel-assembler/springmarc-${timestamp()}`);
  await mkdir(outputDir, { recursive: true });

  const assetResolution = await resolveRoomAssets(job, outputDir);
  await writeJson(path.join(outputDir, 'asset_manifest.json'), assetResolution.manifest);
  if (assetResolution.clipsByRoomId.size < 1) {
    throw new Error(`No usable room videos found for job ${job.job_id}. See ${path.join(outputDir, 'asset_manifest.json')} for skipped rooms.`);
  }
  const scenes = applySceneEdit(buildScenePlan(job, {
    style,
    clipsByRoomId: assetResolution.clipsByRoomId,
    reels: args.reels,
    targetDuration: args.duration ?? DEFAULT_TARGET_SECONDS
  }), edit);
  validateScenes(scenes);
  await writeJson(path.join(outputDir, 'scene_plan.json'), { job_id: job.job_id, scenes });
  if (args.dryRun) {
    console.log(JSON.stringify({
      output_dir: outputDir,
      scene_count: scenes.length,
      asset_manifest: path.join(outputDir, 'asset_manifest.json'),
      scene_plan: path.join(outputDir, 'scene_plan.json')
    }, null, 2));
    return;
  }

  await generateSceneAssets(scenes, outputDir, args);
  const segmentPaths = [];
  for (const scene of scenes) {
    const segmentPath = await renderScene(scene, outputDir, edit);
    segmentPaths.push(segmentPath);
  }
  const finalPath = await concatSegments(segmentPaths, outputDir);
  await writeJson(path.join(outputDir, 'manifest.json'), { final_video_path: finalPath, scenes });
  console.log(JSON.stringify({ output_dir: outputDir, final_video_path: finalPath, scenes: scenes.length }, null, 2));
}

function buildScenePlan(job, options = {}) {
  const clips = options.clipsByRoomId ?? new Map((job.artifacts?.approved_room_clips ?? []).map((clip) => [clip.room_id, { path: clip.path }]));
  const order = job.handoff?.creative_spec?.room_sequence ?? [];
  const roomJobs = new Map((job.handoff?.room_generation_jobs ?? []).map((room) => [room.room_id, room]));
  const { guidanceMap, aestheticName, summary, topMaterial } = buildVibeCopy(job, options.style);

  const hookNarration = summary
    ? `${summary.slice(0, 130).replace(/\s\S+$/, '')}. That is what Haus builds for Springmarc.`
    : 'At Springmarc, your future home starts as a floor plan you can actually see.';

  const priceScenes = options.reels
    ? [{
      id: 'price_summary',
      type: 'price_summary',
      title: 'FLOOR PLANS',
      lines: ['1B1 FROM $2,040', '2B2 FROM $2,620', '3B2 FROM $3,180'],
      plans: FLOOR_PLANS,
      style_name: aestheticName,
      narration: 'Choose one, two, or three bedrooms, with pricing matched to each plan.',
      fallback_narration: 'Compare one, two, and three bedroom plans with clear starting prices.',
      subtitle: '1B1, 2B2, AND 3B2 AVAILABLE'
      }]
    : FLOOR_PLANS.map((plan) => ({
        id: plan.id,
        type: 'price_card',
        title: plan.name,
        lines: [plan.layout, plan.sqft, plan.price],
        plan,
        style_name: aestheticName,
        narration: `${plan.name}: ${plan.layout.toLowerCase()}, ${plan.sqft.toLowerCase()}, ${plan.price.toLowerCase()}.`,
        subtitle: `${plan.name}: ${plan.price}`
      }));

  const scenes = [
    {
      id: 'hook',
      type: 'card',
      title: 'SPRINGMARC',
      lines: ['PICK A FLOOR PLAN', 'SEE THE HOME FIRST'],
      narration: hookNarration,
      fallback_narration: 'Tour the floor plan, pick a style, and see the apartment before it exists.',
      subtitle: 'SEE IT BEFORE IT IS BUILT.'
    },
    ...(options.reels ? [] : [{
      id: 'style_feature',
      type: 'card',
      title: 'CHOOSE ANY STYLE',
      lines: ['PASTE A PINTEREST BOARD', 'HAUS APPLIES THE STYLE'],
      narration: `Paste a Pinterest board. Haus reads the aesthetic — ${aestheticName} — and stages every room to match.`,
      subtitle: `${aestheticName.toUpperCase()}. APPLIED.`
    }]),
    ...priceScenes
  ];

  for (const roomId of order) {
    const clip = clips.get(roomId);
    if (!clip?.path) continue;
    const room = roomJobs.get(roomId);
    const guidance = guidanceMap.get(roomId);
    const titleWord = roomId.split('_')[0].toUpperCase();
    const fallbackNarration = roomFallbackLine(titleWord, guidance, aestheticName, topMaterial);
    const narration = guidance?.headline ?? fallbackNarration;
    const subtitleSource = guidance?.must_include?.[0] ?? aestheticName;
    const subtitle = subtitleSource.toUpperCase().replace(/[^A-Z0-9 '$.,:;!?-]/g, '').slice(0, 40);
    scenes.push({
      id: roomId,
      type: 'clip',
      title: titleWord,
      clip_path: clip.path,
      asset_duration: clip.duration ?? null,
      narration,
      fallback_narration: fallbackNarration,
      subtitle,
      motion: room?.video_generation?.camera_motion ?? null,
      must_include: room?.staging?.must_include ?? [],
      objects: room?.staging?.objects_to_include ?? []
    });
  }

  const closeNarration = topMaterial
    ? `From floor plan to ${aestheticName} — ${topMaterial}, every room, buyer ready.`
    : 'That is the offer: from floor plan, to style matched clips, to a buyer ready reel.';

  scenes.push({
    id: 'close',
    type: 'card',
    title: 'HAUS FOR SPRINGMARC',
    lines: ['REAL ESTATE REELS', 'FROM A FLOOR PLAN'],
    narration: closeNarration,
    fallback_narration: 'From floor plan to finished reel, Haus turns the vision into a tour.',
    subtitle: 'FROM FLOOR PLAN TO BUYER REEL.'
  });
  return applyTimingBudgets(scenes, {
    reels: options.reels,
    targetSeconds: options.targetDuration ?? DEFAULT_TARGET_SECONDS
  }).map((scene, index) => ({ ...scene, index }));
}

async function loadStyleEntry(args, options = {}) {
  const rootDir = options.rootDir ?? ROOT;
  const styleDir = path.join(rootDir, '.haus-cache', 'style-library');
  if (args.fromStyle) return JSON.parse(await readFile(path.resolve(args.fromStyle), 'utf8'));
  if (!args.styleId) return null;

  const localPath = path.join(styleDir, `${args.styleId}.json`);
  if (existsSyncLite(localPath)) return JSON.parse(await readFile(localPath, 'utf8'));

  const index = await readJsonSafe(path.join(styleDir, 'index.json')) ?? { styles: [] };
  const match = (index.styles ?? []).find((style) => style.style_id === args.styleId);
  if (!match) throw new Error(`Style not found: ${args.styleId}`);

  const staleBasenamePath = match.path ? path.join(styleDir, path.basename(match.path)) : null;
  if (staleBasenamePath && existsSyncLite(staleBasenamePath)) return JSON.parse(await readFile(staleBasenamePath, 'utf8'));
  if (match.path && existsSyncLite(match.path)) return JSON.parse(await readFile(match.path, 'utf8'));
  throw new Error(`Style index entry is stale and local file is missing: ${args.styleId}`);
}

async function assertJobStyleMatchesCache(job, style, options = {}) {
  if (!style) return;
  const rootDir = options.rootDir ?? ROOT;
  const dictionary = options.dictionary ?? await buildCacheDictionary({ cacheRoot: path.join(rootDir, '.haus-cache') });
  const identity = styleIdentity(style);
  const hashes = generationHashesFromJob(job);
  const owners = hashes.map((hash) => ({ hash, owner: dictionary.generation_to_style?.[hash] })).filter((item) => item.owner);
  if (!owners.length) return assertJobMetadataMatchesStyle(job, identity);

  const mismatches = owners.filter(({ owner }) => !ownerMatchesStyle(owner, identity));
  if (!mismatches.length) return;

  const owner = mismatches[0].owner;
  const sample = mismatches.slice(0, 5).map(({ hash }) => hash.slice(0, 10)).join(', ');
  throw new Error([
    `Style/job mismatch for job ${job.job_id}.`,
    `Cache hashes belong to "${owner.style_name ?? 'unknown style'}"` +
      `${owner.pinterest_board_url ? ` (${owner.pinterest_board_url})` : ''}.`,
    `Requested style is "${identity.name ?? identity.id ?? 'unknown style'}"` +
      `${identity.boardUrl ? ` (${identity.boardUrl})` : ''}.`,
    `Matching cache hashes are required; sample hashes: ${sample}.`
  ].join(' '));
}

function assertJobMetadataMatchesStyle(job, identity) {
  const jobName = job.handoff?.vibe_report?.aesthetic_name ?? null;
  const jobBoard = job.input?.pinterest_board_url ?? job.payload?.pinterest_board_url ?? job.handoff?.source_input?.pinterest_board_url ?? null;
  const nameMismatch = jobName && identity.name && normalizeIdentity(jobName) !== normalizeIdentity(identity.name);
  const boardMismatch = jobBoard && identity.boardUrl && jobBoard !== identity.boardUrl;
  if (!nameMismatch && !boardMismatch) return;
  throw new Error(
    `Style/job mismatch for job ${job.job_id}. Job metadata is "${jobName ?? 'unknown style'}"` +
    `${jobBoard ? ` (${jobBoard})` : ''}, but requested style is "${identity.name ?? identity.id ?? 'unknown style'}"` +
    `${identity.boardUrl ? ` (${identity.boardUrl})` : ''}.`
  );
}

function generationHashesFromJob(job) {
  const paths = [
    ...(job.artifacts?.approved_room_clips ?? []).map((clip) => clip.path),
    ...(job.rooms ?? []).flatMap((room) => Object.values(room.artifacts ?? {}))
  ];
  return unique(paths.map(generationHashFromPath).filter(Boolean));
}

function styleIdentity(style) {
  return {
    id: style.style_id ?? null,
    name: style.vibe_report?.aesthetic_name ?? style.aesthetic_profile?.style_name ?? null,
    boardUrl: style.source?.pinterest_board_url ?? style.source_input?.pinterest_board_url ?? null
  };
}

function ownerMatchesStyle(owner, identity) {
  if (owner.pinterest_board_url && identity.boardUrl && owner.pinterest_board_url === identity.boardUrl) return true;
  if (owner.style_name && identity.name && normalizeIdentity(owner.style_name) === normalizeIdentity(identity.name)) return true;
  return false;
}

function normalizeIdentity(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveRoomAssets(job, outputDir, options = {}) {
  const rootDir = options.rootDir ?? ROOT;
  const downloadFn = options.downloadFn ?? downloadRemoteAsset;
  const durationFn = options.mediaDurationFn ?? mediaDuration;
  const clipsByRoomId = new Map();
  const manifest = { job_id: job.job_id, generated_at: new Date().toISOString(), rooms: [] };
  const approved = new Map((job.artifacts?.approved_room_clips ?? []).map((clip) => [clip.room_id, clip]));
  const runtimeRooms = new Map((job.rooms ?? []).map((room) => [room.room_id, room]));
  const roomJobs = new Map((job.handoff?.room_generation_jobs ?? []).map((room) => [room.room_id, room]));
  const roomIds = unique([
    ...(job.handoff?.creative_spec?.room_sequence ?? []),
    ...approved.keys(),
    ...runtimeRooms.keys(),
    ...roomJobs.keys()
  ]);

  for (const roomId of roomIds) {
    const clip = approved.get(roomId) ?? {};
    const runtimeRoom = runtimeRooms.get(roomId) ?? {};
    const roomJob = roomJobs.get(roomId) ?? {};
    const resolved = await resolveOneRoomAsset({ roomId, clip, runtimeRoom, roomJob, outputDir, rootDir, downloadFn, durationFn });
    manifest.rooms.push(resolved.manifest);
    if (resolved.path) clipsByRoomId.set(roomId, { path: resolved.path, duration: resolved.duration, source_type: resolved.manifest.source_type });
  }

  return { clipsByRoomId, manifest };
}

async function resolveOneRoomAsset({ roomId, clip, runtimeRoom, roomJob, outputDir, rootDir, downloadFn, durationFn }) {
  const artifacts = runtimeRoom.artifacts ?? {};
  const base = {
    room_id: roomId,
    room_name: roomJob.room_name ?? runtimeRoom.room_name ?? null,
    state: runtimeRoom.state ?? null,
    source_type: null,
    source_url: null,
    local_path: null,
    duration: null,
    skipped_reason: null
  };

  for (const candidate of [
    { type: 'approved_local_path', path: clip.path },
    { type: 'approved_url', url: clip.url },
    { type: 'room_local_path', path: artifacts.video_clip_path },
    { type: 'room_video_url', url: artifacts.video_url },
    await generationResultFromStalePath(clip.path ?? artifacts.video_clip_path, rootDir),
    await generationResultByRequest(runtimeRoom.plans?.video_plan, rootDir)
  ].filter(Boolean)) {
    try {
      const localPath = candidate.path && existsSyncLite(candidate.path)
        ? candidate.path
        : candidate.url ? await downloadResolvedVideo(candidate.url, roomId, outputDir, downloadFn) : null;
      if (!localPath) continue;
      const duration = await durationFn(localPath).catch(() => null);
      return {
        path: localPath,
        duration,
        manifest: { ...base, source_type: candidate.type, source_url: candidate.url ?? null, local_path: localPath, duration }
      };
    } catch (error) {
      base.skipped_reason = `download_failed: ${error.message}`;
    }
  }

  const pending = await pendingGenerationReason(runtimeRoom.plans?.video_plan, rootDir);
  return { path: null, duration: null, manifest: { ...base, skipped_reason: base.skipped_reason ?? pending ?? 'missing_video' } };
}

async function generationResultFromStalePath(filePath, rootDir) {
  const hash = generationHashFromPath(filePath);
  if (!hash) return null;
  const result = await readJsonSafe(path.join(rootDir, '.haus-cache', 'agent', 'generations', hash, 'result.json'));
  const url = extractFirstMediaUrl(result);
  return url ? { type: 'generation_result_by_stale_path', url } : null;
}

async function generationResultByRequest(videoPlan, rootDir) {
  if (!videoPlan?.model || !videoPlan?.params) return null;
  const match = await findGenerationRequest(rootDir, (request) =>
    request.endpoint_id === videoPlan.model && stableJson(request.params) === stableJson(videoPlan.params)
  , { preferResult: true });
  if (!match?.dir) return null;
  const result = await readJsonSafe(path.join(match.dir, 'result.json'));
  const url = extractFirstMediaUrl(result);
  return url ? { type: 'generation_result_by_request', url } : null;
}

async function pendingGenerationReason(videoPlan, rootDir) {
  if (!videoPlan?.model || !videoPlan?.params) return null;
  const match = await findGenerationRequest(rootDir, (request) =>
    request.endpoint_id === videoPlan.model && stableJson(request.params) === stableJson(videoPlan.params)
  );
  if (!match) return null;
  if (match.request?.request_id || match.request?.status_url || match.request?.response_url) return 'pending_with_request_metadata';
  return 'pending_unrecoverable';
}

async function findGenerationRequest(rootDir, predicate, options = {}) {
  const generationsDir = path.join(rootDir, '.haus-cache', 'agent', 'generations');
  let entries = [];
  try {
    entries = await readdir(generationsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(generationsDir, entry.name);
    const request = await readJsonSafe(path.join(dir, 'request.json'));
    if (request && predicate(request)) matches.push({ dir, request, hasResult: existsSyncLite(path.join(dir, 'result.json')) });
  }
  if (!matches.length) return null;
  if (options.preferResult) return matches.find((match) => match.hasResult) ?? matches[0];
  return matches[0];
}

async function downloadResolvedVideo(url, roomId, outputDir, downloadFn) {
  const localPath = path.join(outputDir, 'assets', 'remote', `${roomId}.mp4`);
  if (existsSyncLite(localPath)) return localPath;
  await downloadFn(url, localPath);
  return localPath;
}

async function downloadRemoteAsset(url, destPath) {
  await mkdir(path.dirname(destPath), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  await pipeline(response.body, createWriteStream(destPath));
}

function generationHashFromPath(filePath) {
  if (!filePath) return null;
  const parts = path.normalize(filePath).split(path.sep);
  const index = parts.lastIndexOf('generations');
  return index >= 0 ? parts[index + 1] ?? null : null;
}

function applyTimingBudgets(scenes, options = {}) {
  if (options.reels) {
    return scenes.map((scene) => {
      const budget = scene.id === 'hook' || scene.id === 'price_summary' || scene.id === 'close' ? 5 : scene.type === 'clip' ? 3 : 5;
      const maxWords = wordsForDuration(budget);
      const fallback = scene.fallback_narration ?? deterministicFallback(scene);
      return {
        ...scene,
        budget_seconds: budget,
        max_words: maxWords,
        original_narration: scene.narration,
        fallback_narration: fallback,
        narration: fitNarrationToBudget(scene.narration, budget, fallback)
      };
    });
  }
  const maxClipSeconds = Number(process.env.HAUS_REEL_MAX_CLIP_SECONDS ?? DEFAULT_MAX_CLIP_SECONDS);
  const planned = scenes.map((scene) => {
    const cap = scene.type === 'clip'
      ? Math.min(Number(scene.asset_duration ?? maxClipSeconds), maxClipSeconds)
      : scene.type === 'price_card' ? 2.0 : 2.4;
    return { ...scene, budget_seconds: Math.max(1.6, Math.min(cap, scene.type === 'clip' ? maxClipSeconds : 3.0)) };
  });
  const total = planned.reduce((sum, scene) => sum + scene.budget_seconds, 0);
  const scale = total > options.targetSeconds ? options.targetSeconds / total : 1;
  return planned.map((scene) => {
    const floor = scene.type === 'clip' ? 1.8 : 1.4;
    const budget = Number(Math.max(floor, scene.budget_seconds * scale).toFixed(2));
    const maxWords = wordsForDuration(budget);
    const fallback = scene.fallback_narration ?? deterministicFallback(scene);
    return {
      ...scene,
      budget_seconds: budget,
      max_words: maxWords,
      original_narration: scene.narration,
      fallback_narration: fallback,
      narration: fitNarrationToBudget(scene.narration, budget, fallback)
    };
  });
}

function fitNarrationToBudget(text, budgetSeconds, fallback) {
  const maxWords = wordsForDuration(budgetSeconds);
  return wordCount(text) <= maxWords ? text : limitWords(fallback, maxWords);
}

function wordsForDuration(seconds) {
  if (seconds <= 2.1) return 5;
  if (seconds <= 3.1) return 9;
  if (seconds <= 3.8) return 11;
  if (seconds <= 5.1) return 15;
  return Math.max(11, Math.floor(seconds * 3));
}

function roomFallbackLine(titleWord, guidance, aestheticName, topMaterial) {
  const room = titleWord.slice(0, 1) + titleWord.slice(1).toLowerCase();
  const material = guidance?.must_include?.[0] ?? topMaterial ?? aestheticName;
  return `${room}: ${material}.`;
}

function deterministicFallback(scene) {
  if (scene.type === 'price_summary') return 'One, two, and three bedroom plans are available.';
  if (scene.type === 'price_card') return `${scene.plan.name}: ${scene.plan.price}.`;
  if (scene.type === 'card') return scene.subtitle ?? scene.title;
  return `${scene.title}: ${scene.subtitle}.`;
}

function limitWords(text, maxWords) {
  return String(text ?? '').split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ').replace(/[.,:;!?-]+$/, '') + '.';
}

function wordCount(text) {
  return String(text ?? '').split(/\s+/).filter(Boolean).length;
}

function applyRenderPreset(args) {
  if (args.referenceHaven) {
    OUT_W = 1278;
    OUT_H = 720;
    process.env.HAUS_REEL_MAX_CLIP_SECONDS ??= '5.2';
  } else if (args.reels) {
    OUT_W = 1080;
    OUT_H = 1920;
    process.env.HAUS_REEL_MAX_CLIP_SECONDS ??= '2.8';
  }
}

function applySceneEdit(scenes, edit) {
  if (!edit) return scenes;
  const sceneEdits = new Map((edit.scenes ?? []).map((scene) => [scene.room_id, scene]));
  const filtered = scenes.filter((scene) => scene.type !== 'clip' || sceneEdits.get(scene.id)?.include !== false);
  for (const scene of filtered) {
    if (scene.id === 'hook' && edit.story_hook) {
      scene.narration = edit.story_hook;
      scene.lines = ['PICK A FLOOR PLAN', 'PASTE A STYLE'];
    }
    const sceneEdit = sceneEdits.get(scene.id);
    if (sceneEdit?.subtitle) scene.subtitle = sceneEdit.subtitle;
  }
  return filtered.map((scene, index) => ({ ...scene, index }));
}

async function generateSceneAssets(scenes, outputDir, args) {
  await mkdir(path.join(outputDir, 'voiceovers'), { recursive: true });
  await mkdir(path.join(outputDir, 'cards'), { recursive: true });
  await mkdir(path.join(outputDir, 'captions'), { recursive: true });
  await mkdir(path.join(outputDir, 'price_prompts'), { recursive: true });
  await mkdir(path.join(outputDir, 'thumbnails'), { recursive: true });
  const priceTemplate = await loadPricePromptTemplate();
  const priceSummaryTemplate = await loadPriceSummaryPromptTemplate();
  for (const scene of scenes) {
    scene.voiceover_path = path.join(outputDir, 'voiceovers', `${pad(scene.index)}-${scene.id}.mp3`);
    scene.caption_path = path.join(outputDir, 'captions', `${pad(scene.index)}-${scene.id}.png`);
    scene.voiceover_provider = await generateVoiceover(scene.narration, scene.voiceover_path, args);
    scene.duration = await mediaDuration(scene.voiceover_path);
    if (scene.budget_seconds && scene.duration > scene.budget_seconds + 0.15 && scene.narration !== scene.fallback_narration) {
      scene.narration = fitNarrationToBudget(scene.fallback_narration, scene.budget_seconds, scene.fallback_narration);
      scene.voiceover_rewritten = true;
      scene.voiceover_provider = await generateVoiceover(scene.narration, scene.voiceover_path, args);
      scene.duration = await mediaDuration(scene.voiceover_path);
    }
    await writeFile(scene.caption_path, renderTextPng({
      eyebrow: scene.title,
      lines: [scene.subtitle],
      mode: 'caption'
    }));
    if (scene.type === 'price_card') {
      scene.price_prompt_path = path.join(outputDir, 'price_prompts', `${pad(scene.index)}-${scene.id}.txt`);
      scene.card_path = path.join(outputDir, 'cards', `${pad(scene.index)}-${scene.id}.png`);
      scene.floor_plan_path = path.join(ROOT, scene.plan.image);
      const pricePrompt = renderTemplate(priceTemplate, {
        community_name: 'Springmarc',
        plan_name: scene.plan.name,
        layout: scene.plan.layout,
        sqft: scene.plan.sqft,
        price: scene.plan.price,
        style_name: scene.style_name ?? 'Your Style',
        floor_plan_image: scene.floor_plan_path
      });
      await writeFile(scene.price_prompt_path, pricePrompt);
      const thumbnailPath = path.join(outputDir, 'thumbnails', `${pad(scene.index)}-${scene.id}.png`);
      const reusedThumbnail = args.reuseThumbnailsFrom
        ? path.resolve(args.reuseThumbnailsFrom, 'thumbnails', `${pad(scene.index)}-${scene.id}.png`)
        : null;
      if (reusedThumbnail && existsSyncLite(reusedThumbnail)) {
        scene.card_path = reusedThumbnail;
        scene.thumbnail_model = 'reused';
      } else {
        const thumbnail = await generatePriceThumbnail(scene.floor_plan_path, pricePrompt, thumbnailPath);
        scene.card_path = thumbnail.path;
        scene.thumbnail_url = thumbnail.url;
        scene.thumbnail_model = thumbnail.model;
      }
    } else if (scene.type === 'price_summary') {
      scene.price_prompt_path = path.join(outputDir, 'price_prompts', `${pad(scene.index)}-${scene.id}.txt`);
      scene.card_path = path.join(outputDir, 'cards', `${pad(scene.index)}-${scene.id}.png`);
      const pricePrompt = renderTemplate(priceSummaryTemplate, {
        community_name: 'Springmarc',
        style_name: scene.style_name ?? 'Your Style',
        plan_1_name: scene.plans[0].name,
        plan_1_layout: scene.plans[0].layout,
        plan_1_sqft: scene.plans[0].sqft,
        plan_1_price: scene.plans[0].price,
        plan_2_name: scene.plans[1].name,
        plan_2_layout: scene.plans[1].layout,
        plan_2_sqft: scene.plans[1].sqft,
        plan_2_price: scene.plans[1].price,
        plan_3_name: scene.plans[2].name,
        plan_3_layout: scene.plans[2].layout,
        plan_3_sqft: scene.plans[2].sqft,
        plan_3_price: scene.plans[2].price
      });
      await writeFile(scene.price_prompt_path, pricePrompt);
      const thumbnailPath = path.join(outputDir, 'thumbnails', `${pad(scene.index)}-${scene.id}.png`);
      const reusedThumbnail = args.reuseThumbnailsFrom
        ? path.resolve(args.reuseThumbnailsFrom, 'thumbnails', `${pad(scene.index)}-${scene.id}.png`)
        : null;
      if (reusedThumbnail && existsSyncLite(reusedThumbnail)) {
        scene.card_path = reusedThumbnail;
        scene.thumbnail_model = 'reused';
      } else {
        const thumbnail = await generateTextThumbnail(pricePrompt, thumbnailPath, scene.plans.map((plan) => path.join(ROOT, plan.image)));
        scene.card_path = thumbnail.path;
        scene.thumbnail_url = thumbnail.url;
        scene.thumbnail_model = thumbnail.model;
      }
    } else if (scene.type === 'card') {
      scene.card_path = path.join(outputDir, 'cards', `${pad(scene.index)}-${scene.id}.png`);
      await writeFile(scene.card_path, renderTextPng({
        eyebrow: scene.title,
        lines: scene.lines,
        footer: 'SpringMarc at San Marcos',
        mode: 'card'
      }));
    }
  }
}

async function renderScene(scene, outputDir, edit = null) {
  const out = path.join(outputDir, `${pad(scene.index)}-${scene.id}.mp4`);
  const duration = renderDurationForScene(scene, edit);
  const fadeOutAt = Math.max(0, duration - 0.18).toFixed(3);
  if (scene.type === 'card' || scene.type === 'price_card' || scene.type === 'price_summary') {
    const cardFilter = scene.type === 'price_card'
      ? `[0:v]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease,pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${FPS},fade=t=in:st=0:d=0.12,fade=t=out:st=${fadeOutAt}:d=0.18,format=yuv420p[v]`
      : `[0:v]scale=${OUT_W}:${OUT_H},fps=${FPS},fade=t=in:st=0:d=0.12,fade=t=out:st=${fadeOutAt}:d=0.18,format=yuv420p[v]`;
    await execFileAsync('ffmpeg', [
      '-y',
      '-loop', '1', '-t', String(duration), '-i', scene.card_path,
      '-i', scene.voiceover_path,
      '-filter_complex', cardFilter,
      '-map', '[v]', '-map', '1:a',
      '-t', String(duration),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '160k', out
    ]);
    return out;
  }

  await execFileAsync('ffmpeg', [
    '-y',
    '-stream_loop', '-1', '-i', scene.clip_path,
    '-i', scene.voiceover_path,
    '-loop', '1', '-t', String(duration), '-i', scene.caption_path,
    '-filter_complex', [
      preserveAssetFilters('0:v'),
      `[bg][fg]overlay=0:0[tmp]`,
      `[tmp][2:v]overlay=0:0:format=auto,fade=t=in:st=0:d=0.10,fade=t=out:st=${fadeOutAt}:d=0.18,trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS[v]`
    ].join(';'),
    '-map', '[v]', '-map', '1:a',
    '-t', String(duration),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '160k', out
  ]);
  return out;
}

function renderDurationForScene(scene, edit = null) {
  if (scene.budget_seconds) return Number(scene.budget_seconds);
  const audioDuration = Math.max(1.8, Number(scene.duration ?? 3));
  const maxClipSeconds = Number(edit?.max_clip_seconds ?? process.env.HAUS_REEL_MAX_CLIP_SECONDS ?? DEFAULT_MAX_CLIP_SECONDS);
  return scene.type === 'clip' ? Math.min(audioDuration, maxClipSeconds) : Math.min(audioDuration, 3.7);
}

function preserveAssetFilters(inputLabel) {
  const safeW = Math.max(320, OUT_W - SAFE_REEL_X_PAD * 2);
  const safeH = Math.max(320, OUT_H - SAFE_REEL_Y_PAD);
  return [
    `[${inputLabel}]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},boxblur=36:2,eq=brightness=-0.10:saturation=0.78[bg]`,
    `[${inputLabel}]scale=${safeW}:${safeH}:force_original_aspect_ratio=decrease,pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2:color=black@0,fps=${FPS}[fg]`
  ].join(';');
}

async function concatSegments(paths, outputDir) {
  const listPath = path.join(outputDir, 'segments.txt');
  await writeFile(listPath, paths.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n') + '\n');
  const out = path.join(outputDir, 'final_reel.mp4');
  await execFileAsync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-vf', `fps=${FPS},format=yuv420p`,
    '-af', 'aresample=async=1:first_pts=0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart', out
  ]);
  return out;
}

const voiceoverState = { elevenLabsError: null, openAiError: null };

async function generateVoiceover(text, out, args = {}) {
  if (process.env.ELEVENLABS_API_KEY && !voiceoverState.elevenLabsError) {
    try {
      await generateVoiceoverWithElevenLabs(text, out);
      return 'elevenlabs';
    } catch (error) {
      voiceoverState.elevenLabsError = error;
      if (args.requireElevenLabs) throw new Error(`ElevenLabs voiceover required but failed: ${error.message}`);
      console.error(`[voiceover] ElevenLabs failed; trying OpenAI: ${error.message.slice(0, 160)}`);
    }
  } else if (args.requireElevenLabs) {
    throw new Error('ElevenLabs voiceover required but ELEVENLABS_API_KEY is missing.');
  }
  if (process.env.FAL_KEY) {
    try {
      await generateVoiceoverWithFal(text, out);
      return 'fal';
    } catch (error) {
      console.error(`[voiceover] fal TTS failed; trying OpenAI: ${error.message.slice(0, 160)}`);
    }
  }
  if (process.env.OPENAI_API_KEY && !voiceoverState.openAiError) {
    try {
      const response = await fetch(OPENAI_SPEECH_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENAI_TTS_MODEL ?? DEFAULT_OPENAI_TTS_MODEL,
          voice: process.env.OPENAI_TTS_VOICE ?? DEFAULT_OPENAI_TTS_VOICE,
          input: text,
          format: 'mp3'
        })
      });
      if (!response.ok) throw new Error(await response.text());
      await writeFile(out, Buffer.from(await response.arrayBuffer()));
      return 'openai';
    } catch (error) {
      voiceoverState.openAiError = error;
      console.error(`[voiceover] OpenAI failed; using macOS say fallback: ${error.message.slice(0, 160)}`);
    }
  }
  await generateVoiceoverWithSay(text, out);
  return 'macos_say';
}

async function generateVoiceoverWithFal(text, out) {
  fal.config({ credentials: process.env.FAL_KEY });
  const model = process.env.FAL_TTS_MODEL ?? DEFAULT_FAL_TTS_MODEL;
  const result = await fal.subscribe(model, {
    input: { text: `[S1] ${text}` },
    logs: false
  });
  const audioUrl = result?.data?.audio?.url ?? result?.audio?.url;
  if (!audioUrl) throw new Error(`No audio URL returned from ${model}.`);
  const response = await fetch(audioUrl);
  if (!response.ok) throw new Error(`Failed to download fal TTS audio: ${response.status}`);
  await writeFile(out, Buffer.from(await response.arrayBuffer()));
}

async function checkElevenLabs() {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is missing.');
  const out = path.join('/tmp', `haus-elevenlabs-check-${Date.now()}.mp3`);
  await generateVoiceoverWithElevenLabs('Springmarc voiceover check.', out);
  console.log(JSON.stringify({
    ok: true,
    provider: 'elevenlabs',
    voice_id: process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_ELEVENLABS_VOICE_ID,
    model_id: process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_ELEVENLABS_MODEL,
    sample_path: out
  }, null, 2));
}

async function generateVoiceoverWithElevenLabs(text, out) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_ELEVENLABS_VOICE_ID;
  const response = await fetch(`${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_ELEVENLABS_MODEL,
      voice_settings: {
        stability: 0.43,
        similarity_boost: 0.82,
        style: 0.25,
        use_speaker_boost: true
      }
    })
  });
  if (!response.ok) throw new Error(await response.text());
  await writeFile(out, Buffer.from(await response.arrayBuffer()));
}

async function generateVoiceoverWithSay(text, out) {
  const aiffPath = out.replace(/\.mp3$/, '.aiff');
  await execFileAsync('say', ['-v', process.env.HAUS_SAY_VOICE ?? 'Samantha', '-r', process.env.HAUS_SAY_RATE ?? '225', '-o', aiffPath, text]);
  await execFileAsync('ffmpeg', ['-y', '-i', aiffPath, '-c:a', 'libmp3lame', '-b:a', '160k', out]);
}

async function mediaDuration(filePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath
  ]);
  return Number(stdout.trim()) || 3;
}

function validateScenes(scenes) {
  const missing = scenes.filter((scene) => scene.clip_path && !path.isAbsolute(scene.clip_path));
  if (missing.length) throw new Error(`Clip paths must be absolute: ${missing.map((s) => s.id).join(', ')}`);
  const absent = scenes.filter((scene) => scene.clip_path && !existsSyncLite(scene.clip_path));
  if (absent.length) throw new Error(`Missing cached clips: ${absent.map((s) => `${s.id}:${s.clip_path}`).join(', ')}`);
}

async function loadJob(jobId) {
  const filePath = path.join(ROOT, '.haus-cache', 'agent', 'jobs', jobId, 'job.json');
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function loadPricePromptTemplate() {
  return readFile(path.join(ROOT, 'prompts', 'thumbnail_price.jinja'), 'utf8');
}

async function loadPriceSummaryPromptTemplate() {
  return readFile(path.join(ROOT, 'prompts', 'thumbnail_price_summary.jinja'), 'utf8');
}

function renderTemplate(template, values) {
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) => values[key] ?? '');
}

async function generatePriceThumbnail(floorPlanPath, prompt, out) {
  if (!process.env.FAL_KEY) throw new Error('FAL_KEY is required to generate price thumbnails.');
  const thumbnailModel = process.env.THUMBNAIL_MODEL ?? DEFAULT_THUMBNAIL_MODEL;
  fal.config({ credentials: process.env.FAL_KEY });
  const floorPlan = new Blob([await readFile(floorPlanPath)], { type: mimeFromPath(floorPlanPath) });
  const uploaded = await fal.storage.upload(floorPlan, { filename: path.basename(floorPlanPath) });
  const imageUrl = typeof uploaded === 'string' ? uploaded : uploaded?.url ?? String(uploaded);
  const result = await fal.subscribe(thumbnailModel, {
    input: {
      image_urls: [imageUrl],
      prompt,
      resolution: '2K',
      aspect_ratio: '9:16',
      output_format: 'png',
      num_images: 1
    },
    logs: true,
    onQueueUpdate(update) {
      if (update.status === 'IN_PROGRESS') {
        for (const log of update.logs ?? []) console.log(`[thumbnail] ${log.message}`);
      }
    }
  });
  const url = extractFirstImageUrl(result?.data ?? result);
  if (!url) throw new Error(`No thumbnail image returned from ${thumbnailModel}.`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download thumbnail: ${response.status} ${await response.text()}`);
  await writeFile(out, Buffer.from(await response.arrayBuffer()));
  return { path: out, url, model: thumbnailModel };
}

async function generateTextThumbnail(prompt, out, imagePaths = []) {
  if (!process.env.FAL_KEY) throw new Error('FAL_KEY is required to generate price summary thumbnails.');
  const thumbnailModel = process.env.THUMBNAIL_MODEL ?? DEFAULT_THUMBNAIL_MODEL;
  fal.config({ credentials: process.env.FAL_KEY });
  const imageUrls = [];
  for (const imagePath of imagePaths) {
    const image = new Blob([await readFile(imagePath)], { type: mimeFromPath(imagePath) });
    const uploaded = await fal.storage.upload(image, { filename: path.basename(imagePath) });
    imageUrls.push(typeof uploaded === 'string' ? uploaded : uploaded?.url ?? String(uploaded));
  }
  const result = await fal.subscribe(thumbnailModel, {
    input: {
      image_urls: imageUrls,
      prompt,
      resolution: '2K',
      aspect_ratio: '9:16',
      output_format: 'png',
      num_images: 1
    },
    logs: true,
    onQueueUpdate(update) {
      if (update.status === 'IN_PROGRESS') {
        for (const log of update.logs ?? []) console.log(`[price_summary] ${log.message}`);
      }
    }
  });
  const url = extractFirstImageUrl(result?.data ?? result);
  if (!url) throw new Error(`No price summary image returned from ${thumbnailModel}.`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download price summary: ${response.status} ${await response.text()}`);
  await writeFile(out, Buffer.from(await response.arrayBuffer()));
  return { path: out, url, model: thumbnailModel };
}

function extractFirstImageUrl(result) {
  const images = result?.images ?? result?.output ?? result?.image ?? [];
  const list = Array.isArray(images) ? images : [images];
  const first = list.find(Boolean);
  if (!first) return null;
  if (typeof first === 'string') return first;
  return first.url ?? first.image_url ?? null;
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function renderPriceCardPng(plan) {
  const pixels = Buffer.alloc(OUT_W * OUT_H * 4);
  fillRect(pixels, 0, 0, OUT_W, OUT_H, [16, 21, 27, 255]);
  fillRect(pixels, 0, 0, OUT_W, OUT_H / 2, [10, 20, 32, 255]);
  fillRect(pixels, 0, OUT_H / 2, OUT_W, OUT_H / 2, [231, 220, 199, 255]);
  fillRect(pixels, 64, 90, 952, 760, [13, 29, 43, 255]);
  fillRect(pixels, 135, 190, 810, 8, [217, 184, 117, 255]);
  fillRect(pixels, 135, 190, 8, 540, [217, 184, 117, 255]);
  fillRect(pixels, 135, 730, 810, 8, [217, 184, 117, 255]);
  fillRect(pixels, 945, 190, 8, 548, [217, 184, 117, 255]);
  fillRect(pixels, 395, 190, 7, 540, [217, 184, 117, 210]);
  fillRect(pixels, 665, 190, 7, 540, [217, 184, 117, 210]);
  fillRect(pixels, 135, 430, 810, 7, [217, 184, 117, 210]);
  fillRect(pixels, 200, 500, 120, 120, [217, 184, 117, 160]);
  fillRect(pixels, 735, 270, 145, 185, [217, 184, 117, 135]);
  drawCentered(pixels, 'SPRINGMARC BLUEPRINT', 118, 5, [235, 209, 162, 255]);
  drawCentered(pixels, `${plan.name}  ${plan.layout}`, 790, 5, [235, 209, 162, 255]);
  fillRect(pixels, 82, 1015, 916, 470, [248, 244, 234, 255]);
  fillRect(pixels, 145, 1085, 790, 12, [116, 92, 61, 255]);
  fillRect(pixels, 145, 1430, 790, 12, [116, 92, 61, 255]);
  fillRect(pixels, 145, 1090, 12, 345, [116, 92, 61, 255]);
  fillRect(pixels, 923, 1090, 12, 345, [116, 92, 61, 255]);
  fillRect(pixels, 215, 1160, 250, 145, [180, 139, 91, 255]);
  fillRect(pixels, 565, 1145, 285, 210, [203, 184, 150, 255]);
  fillRect(pixels, 225, 1360, 620, 42, [49, 56, 48, 255]);
  drawCentered(pixels, 'STYLE PREVIEW', 985, 5, [92, 72, 49, 255]);
  drawCentered(pixels, plan.price, 1515, 8, [28, 31, 28, 255]);
  drawCentered(pixels, `${plan.sqft}  JAPANDI READY`, 1625, 5, [98, 82, 58, 255]);
  drawCentered(pixels, 'PICK A PLAN. PASTE A STYLE. SEE THE HOME.', 1740, 4, [98, 82, 58, 255]);
  return encodePng(OUT_W, OUT_H, pixels);
}

function renderTextPng({ eyebrow, lines, footer = null, mode }) {
  const pixels = Buffer.alloc(OUT_W * OUT_H * 4);
  fillRect(pixels, 0, 0, OUT_W, OUT_H, mode === 'card' ? [20, 24, 20, 255] : [0, 0, 0, 0]);
  if (mode === 'caption') {
    fillRect(pixels, 70, 1495, 940, 240, [9, 11, 10, 178]);
    drawCentered(pixels, eyebrow, 1534, 4, [216, 190, 142, 255]);
    drawCentered(pixels, lines[0], 1602, 6, [255, 255, 245, 255]);
    return encodePng(OUT_W, OUT_H, pixels);
  }

  drawCentered(pixels, eyebrow, 520, 9, [238, 211, 162, 255]);
  lines.forEach((line, i) => drawCentered(pixels, line, 710 + i * 120, i === 0 ? 7 : 6, [255, 255, 246, 255]));
  if (footer) drawCentered(pixels, footer.toUpperCase(), 1460, 4, [180, 166, 135, 255]);
  drawCentered(pixels, 'FLOOR PLAN TO REAL ESTATE REEL', 1585, 4, [180, 166, 135, 255]);
  return encodePng(OUT_W, OUT_H, pixels);
}

function drawCentered(pixels, text, y, scale, color) {
  const lines = wrapText(text, scale === 9 ? 17 : 25);
  lines.forEach((line, i) => {
    const x = Math.round((OUT_W - line.length * 6 * scale) / 2);
    drawText(pixels, x, y + i * 9 * scale, line, scale, color);
  });
}

function drawText(pixels, x, y, text, scale, color) {
  let cursor = x;
  for (const char of String(text).toUpperCase()) {
    drawGlyph(pixels, cursor, y, FONT[char] ?? FONT[' '], scale, color);
    cursor += 6 * scale;
  }
}

function drawGlyph(pixels, x, y, glyph, scale, color) {
  glyph.forEach((row, rowIndex) => {
    [...row].forEach((cell, colIndex) => {
      if (cell === '1') fillRect(pixels, x + colIndex * scale, y + rowIndex * scale, scale, scale, color);
    });
  });
}

function fillRect(pixels, x, y, w, h, color) {
  for (let row = Math.max(0, y); row < Math.min(OUT_H, y + h); row += 1) {
    for (let col = Math.max(0, x); col < Math.min(OUT_W, x + w); col += 1) {
      const offset = (row * OUT_W + col) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
    }
  }
}

function wrapText(text, maxChars) {
  const words = String(text ?? '').toUpperCase().replace(/[^A-Z0-9 '$.,:;!?-]/g, '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', Buffer.from([...u32(width), ...u32(height), 8, 6, 0, 0, 0])),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const body = Buffer.concat([typeBuffer, data]);
  return Buffer.concat([Buffer.from(u32(data.length)), body, Buffer.from(u32(crc32(body)))]);
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--require-elevenlabs') args.requireElevenLabs = true;
    else if (arg === '--check-elevenlabs') args.checkElevenLabs = true;
    else if (arg === '--reference-haven') args.referenceHaven = true;
    else if (arg === '--reels') args.reels = true;
    else if (arg === '--edit-json') args.editJson = argv[++i];
    else if (arg === '--reuse-thumbnails-from') args.reuseThumbnailsFrom = argv[++i];
    else if (arg === '--job-id') args.jobId = argv[++i];
    else if (arg === '--style-id') args.styleId = argv[++i];
    else if (arg === '--from-style') args.fromStyle = argv[++i];
    else if (arg === '--duration') args.duration = Number(argv[++i]);
    else if (arg === '--output-dir') args.outputDir = argv[++i];
  }
  return args;
}

function loadDotEnv() {
  try {
    const text = readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}

async function readJsonSafe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function existsSyncLite(filePath) {
  try {
    accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const FONT = {
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  6: ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '01100', '01000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  ';': ['00000', '01100', '01100', '00000', '01100', '01100', '01000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  "'": ['01100', '01100', '01000', '00000', '00000', '00000', '00000'],
  '$': ['00100', '01111', '10100', '01110', '00101', '11110', '00100'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000']
};

export {
  assertJobStyleMatchesCache,
  buildScenePlan,
  fitNarrationToBudget,
  generationHashFromPath,
  loadStyleEntry,
  renderDurationForScene,
  resolveRoomAssets,
  wordsForDuration
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
