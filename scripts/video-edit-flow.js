#!/usr/bin/env node
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runLayer5 } from '../src/layer5/index.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const SCRIPT_MODEL = process.env.OPENAI_SCRIPT_MODEL ?? process.env.OPENAI_CREATIVE_MODEL ?? 'gpt-4o-mini';
const DEFAULT_CREATIVE_PLAN_DIR = '.haus-cache/layer3-creative-plans';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest) {
    throw new Error('Missing --manifest <path>');
  }

  const manifestPath = path.resolve(args.manifest);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const rootDir = path.dirname(manifestPath);
  const outputDir = path.resolve(args.outputDir ?? path.join(rootDir, 'video_edit_output'));
  await mkdir(outputDir, { recursive: true });

  const creativePlan = await loadCreativePlan(args.creativePlan ?? manifest.creative_plan_path).catch((error) => {
    console.error(`Creative plan unavailable: ${error.message}`);
    return null;
  });
  const enrichedManifest = enrichManifestWithCreativePlan(manifest, creativePlan);
  const videoScript = await buildVideoScript(enrichedManifest, { useOpenAI: args.openaiScript !== false });
  await writeFile(path.join(outputDir, 'video_script.json'), `${JSON.stringify(videoScript, null, 2)}\n`);
  if (args.scriptOnly) {
    console.log(JSON.stringify({
      output_dir: outputDir,
      creative_plan_path: creativePlan?._path ?? null,
      video_script_path: path.join(outputDir, 'video_script.json')
    }, null, 2));
    return;
  }

  const job = buildEditingJob(enrichedManifest, { rootDir, outputDir, videoScript });
  const result = await runLayer5(job, {
    rootDir,
    outputDir,
    propertyAssetManifest: {
      base_dir: enrichedManifest.base_dir ?? '.',
      assets: enrichedManifest.assets ?? [],
      music_bed: enrichedManifest.music_bed ?? null,
      avatar_base_image: enrichedManifest.avatar_base_image ?? null
    }
  });

  const summary = {
    output_dir: outputDir,
    creative_plan_path: creativePlan?._path ?? null,
    final_video_path: result.final_video_path,
    video_script_path: path.join(outputDir, 'video_script.json'),
    voiceover_path: result.voiceover_path,
    subtitles_path: result.subtitles_path,
    timeline_path: result.timeline_path,
    shot_manifest_path: result.shot_manifest_path,
    review_report_path: result.review_report_path,
    total_shots: result.timeline?.segments?.length ?? 0,
    total_duration: result.timeline?.total_duration ?? null
  };
  console.log(JSON.stringify(summary, null, 2));
}

function buildEditingJob(manifest, { rootDir, outputDir, videoScript }) {
  const rooms = (manifest.rooms ?? []).map((room, index) => ({
    room_id: room.room_id,
    room_name: room.room_name ?? room.room_id.replaceAll('_', ' '),
    creative_headline: room.creative_headline ?? null,
    creative_prompt: room.creative_prompt ?? null,
    sequence_index: index,
    current_motion_mode: room.motion_preset ?? 'slow_dolly',
    artifacts: {
      styled_image_path: room.still_path ? path.resolve(rootDir, room.still_path) : null,
      styled_image_url: null
    },
    video_generation: {
      duration_seconds: Number(room.duration_seconds ?? 5)
    }
  }));

  return {
    _job_dir: outputDir,
    job_id: manifest.job_id ?? 'video-edit-only',
    input: {
      floor_plan_id: manifest.floor_plan_id ?? 'custom'
    },
    handoff: {
      creative_spec: {
        room_sequence: rooms.map((room) => room.room_id)
      },
      delivery: {
        video_script: videoScript,
        caption_context: {
          property_brief: manifest.property_brief ?? null,
          aesthetic_summary: manifest.aesthetic_summary ?? null,
          featured_objects: [],
          tone: 'luxury_listing'
        }
      },
      vibe_report: {
        aesthetic_name: manifest.aesthetic_name ?? 'Custom property edit',
        summary: manifest.aesthetic_summary ?? 'Directed video edit from cached media.'
      }
    },
    rooms,
    artifacts: {
      approved_room_clips: (manifest.rooms ?? [])
        .filter((room) => room.clip_path)
        .map((room) => ({
          room_id: room.room_id,
          path: path.resolve(rootDir, room.clip_path),
          url: null
        }))
    }
  };
}

async function loadCreativePlan(filePath) {
  const planPath = filePath
    ? path.resolve(filePath)
    : await latestJsonPath(path.resolve(DEFAULT_CREATIVE_PLAN_DIR));
  if (!planPath) return null;
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  return { ...plan, _path: planPath };
}

async function latestJsonPath(dirPath) {
  const files = await readdir(dirPath);
  const candidates = await Promise.all(files
    .filter((file) => file.endsWith('.json'))
    .map(async (file) => {
      const filePath = path.join(dirPath, file);
      const info = await stat(filePath);
      return { filePath, mtimeMs: info.mtimeMs };
    }));
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.filePath ?? null;
}

function enrichManifestWithCreativePlan(manifest, creativePlan) {
  if (!creativePlan) return manifest;
  const vibe = creativePlan.vibe_report ?? {};
  return {
    ...manifest,
    property_brief: manifest.property_brief ?? creativePlan.overall_mood ?? vibe.summary ?? null,
    aesthetic_name: manifest.aesthetic_name ?? vibe.aesthetic_name ?? 'Layer 3 property edit',
    aesthetic_summary: manifest.aesthetic_summary ?? vibe.summary ?? creativePlan.overall_mood ?? null,
    creative_plan: creativePlan,
    rooms: mergePlanRooms(manifest.rooms ?? [], creativePlan.room_plans ?? [])
  };
}

function mergePlanRooms(rooms, roomPlans) {
  if (rooms.length === 0) return roomPlans.map((plan) => ({
    room_id: plan.room_id,
    room_name: plan.room_name ?? plan.room_id.replaceAll('_', ' '),
    duration_seconds: plan.duration_seconds ?? 5,
    motion_preset: plan.camera_motion ?? 'slow_dolly'
  }));

  return rooms.map((room) => {
    const plan = findRoomPlan(room, roomPlans);
    return {
      ...room,
      room_name: room.room_name ?? plan?.room_name ?? room.room_id.replaceAll('_', ' '),
      duration_seconds: room.duration_seconds ?? plan?.duration_seconds ?? 5,
      motion_preset: room.motion_preset ?? plan?.camera_motion ?? 'slow_dolly',
      creative_headline: plan?.scene_title ?? plan?.headline ?? null,
      creative_prompt: plan?.video_prompt ?? plan?.dalle_scene_details ?? null
    };
  });
}

function findRoomPlan(room, roomPlans) {
  return roomPlans.find((plan) => plan.room_id === room.room_id)
    ?? roomPlans.find((plan) => plan.room_id?.startsWith(room.room_id))
    ?? roomPlans.find((plan) => room.room_id?.startsWith(plan.room_id?.split('_')[0]));
}

async function buildVideoScript(manifest, options = {}) {
  if (manifest.video_script?.segments?.length) return normalizeVideoScript(manifest.video_script);
  if (options.useOpenAI !== false) {
    const generated = await generateVideoScript(manifest).catch((error) => {
      console.error(`Script generation fell back to local copy: ${error.message}`);
      return null;
    });
    if (generated) return generated;
  }
  return buildFallbackVideoScript(manifest);
}

async function generateVideoScript(manifest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || typeof fetch !== 'function') return null;

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: SCRIPT_MODEL,
      instructions: 'You are a luxury real estate short-form scriptwriter. Return only valid JSON.',
      input: [{
        role: 'user',
        content: JSON.stringify({
          task: 'Create one 20-30 second narrated real estate edit script from cached room clips.',
          vibe: manifest.aesthetic_name ?? 'modern apartment visualization',
          aesthetic_summary: manifest.aesthetic_summary ?? null,
          property_brief: manifest.property_brief ?? null,
          overall_mood: manifest.creative_plan?.overall_mood ?? null,
          global_style_notes: manifest.creative_plan?.global_style_notes ?? [],
          materials: manifest.creative_plan?.vibe_report?.materials ?? [],
          textures: manifest.creative_plan?.vibe_report?.textures ?? [],
          styling_rules: manifest.creative_plan?.vibe_report?.styling_rules ?? [],
          rooms: (manifest.rooms ?? []).map((room) => ({
            name: room.room_name ?? room.room_id,
            headline: room.creative_headline ?? null,
            prompt: room.creative_prompt ?? null
          })),
          required_segments: ['hook', 'arrival', 'flow', 'detail', 'cta'],
          rules: [
            'Use polished but plain English.',
            'Every segment needs narration and short subtitle_text.',
            'Do not mention AI, rendering, cached media, or pipeline internals.',
            'Use the Layer 3 vibe and room details as source of truth.',
            'CTA should invite a tour.'
          ]
        })
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'haus_video_script',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'style', 'duration_seconds', 'target_platform', 'hook_text', 'segments', 'caption', 'hashtags'],
            properties: {
              title: { type: 'string' },
              style: { type: 'string' },
              duration_seconds: { type: 'number' },
              target_platform: { type: 'string' },
              hook_text: { type: 'string' },
              caption: { type: 'string' },
              hashtags: { type: 'array', items: { type: 'string' } },
              segments: {
                type: 'array',
                minItems: 5,
                maxItems: 5,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'narration', 'subtitle_text'],
                  properties: {
                    type: { type: 'string' },
                    narration: { type: 'string' },
                    subtitle_text: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    })
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? `OpenAI script request failed with status ${response.status}.`);
  const text = body?.output_text ?? extractOutputText(body);
  return text ? normalizeVideoScript(JSON.parse(text)) : null;
}

function buildFallbackVideoScript(manifest) {
  const vibe = manifest.aesthetic_name ?? 'warm architectural calm';
  const summary = cleanText(manifest.aesthetic_summary ?? 'a compact apartment staged with clarity and warmth');
  const mood = cleanText(manifest.creative_plan?.overall_mood ?? summary);
  const materials = (manifest.creative_plan?.vibe_report?.materials ?? []).slice(0, 3).join(', ');
  const rooms = manifest.rooms ?? [];
  const firstRoom = roomLabel(rooms[0], 'the entry living space');
  const secondRoom = roomLabel(rooms[1], 'the private retreat');
  const thirdRoom = roomLabel(rooms[2], 'the dining moment');
  const finalRoom = roomLabel(rooms.at(-1), 'the terrace');

  const segments = [
    {
      type: 'hook',
      narration: sentence(`This is ${vibe}: ${mood}`),
      subtitle_text: vibe
    },
    {
      type: 'arrival',
      narration: sentence(`We open in ${firstRoom}, where the layout starts to feel calm, useful, and immediate`),
      subtitle_text: `Start in ${firstRoom}.`
    },
    {
      type: 'flow',
      narration: sentence(`${secondRoom} carries the private side of the home, while ${thirdRoom} keeps the daily rhythm open`),
      subtitle_text: 'Private rooms, open rhythm.'
    },
    {
      type: 'detail',
      narration: sentence(`The edit holds on tactile details${materials ? ` like ${materials}` : ''}, all tied back to ${summary}`),
      subtitle_text: 'Details that sell the feeling.'
    },
    {
      type: 'cta',
      narration: sentence(`End on ${finalRoom}. Book the tour, then walk the vision in person`),
      subtitle_text: 'Book the tour.'
    }
  ];

  return {
    title: `${vibe} property short`,
    style: 'luxury_real_estate',
    duration_seconds: 25,
    target_platform: 'reels',
    hook_text: 'Live inside the plan',
    full_narration: segments.map((segment) => segment.narration).join(' '),
    segments,
    caption: `${vibe} apartment preview, cut from cached Haus room media.`,
    hashtags: ['#realestate', '#architecture', '#apartmenttour']
  };
}

function extractOutputText(body) {
  const output = body?.output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    const node = item.content?.find((content) => content.type === 'output_text');
    if (typeof node?.text === 'string') return node.text;
  }
  return null;
}

function normalizeVideoScript(script) {
  const segments = script.segments.map((segment) => ({
    type: segment.type ?? 'beat',
    narration: segment.narration ?? segment.subtitle_text ?? '',
    subtitle_text: segment.subtitle_text ?? segment.narration ?? ''
  })).filter((segment) => segment.narration);
  return {
    ...script,
    segments,
    full_narration: script.full_narration ?? segments.map((segment) => segment.narration).join(' ')
  };
}

function roomLabel(room, fallback) {
  return titleCase(room?.room_name ?? room?.room_id?.replaceAll('_', ' ') ?? fallback);
}

function titleCase(value) {
  return cleanText(value).replace(/\b\w/g, (char) => char.toUpperCase());
}

function cleanText(value) {
  return String(value ?? '').replace(/[.。]+$/g, '').trim();
}

function sentence(value) {
  return `${cleanText(value)}.`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--manifest') args.manifest = argv[++i];
    else if (token === '--output-dir') args.outputDir = argv[++i];
    else if (token === '--creative-plan') args.creativePlan = argv[++i];
    else if (token === '--no-openai-script') args.openaiScript = false;
    else if (token === '--script-only') args.scriptOnly = true;
  }
  return args;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
