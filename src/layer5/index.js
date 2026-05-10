import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';

import { buildAssetBank, buildDirectedTimeline, classifyShots, reviewTimeline } from '../shotPipeline/index.js';

const execFileAsync = promisify(execFile);

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
const CAPTION_MODEL = process.env.OPENAI_CREATIVE_MODEL ?? 'gpt-4o-mini';
const NARRATION_MODEL = process.env.OPENAI_SCRIPT_MODEL ?? CAPTION_MODEL;
const TTS_MODEL = process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts';
const TTS_VOICE = process.env.OPENAI_TTS_VOICE ?? 'alloy';
const FPS = 24;
const OUTPUT_W = 1920;
const OUTPUT_H = 1080;

export async function runLayer5(job, options = {}) {
  const outputDir = options.outputDir ?? path.join(job._job_dir, 'layer5');
  await mkdir(outputDir, { recursive: true });

  const assetBank = await buildAssetBank(job, options).catch((err) => ({
    floor_plan_id: job.input?.floor_plan_id ?? 'unknown',
    manifest_path: null,
    avatar_base_image_path: null,
    music_bed_path: null,
    assets: [],
    warnings: [`Asset bank failed: ${err.message}`]
  }));
  const shotManifest = classifyShots(assetBank);
  let timeline = buildDirectedTimeline(job, shotManifest);
  let review = reviewTimeline(job, assetBank, timeline);

  if (!review.pass && timeline.segments.length > 0) {
    timeline = reviseTimeline(timeline);
    review = reviewTimeline(job, assetBank, timeline);
  }

  const narration = await buildNarrationPlan(job, assetBank, timeline, options).catch((err) => {
    console.error('[layer5] narration planning failed:', err.message);
    return buildFallbackNarrationPlan(job, timeline);
  });
  const [voiceoverPath, subtitlesPath, captions] = await Promise.all([
    generateVoiceover(narration, outputDir, options).catch((err) => {
      console.error('[layer5] voiceover failed:', err.message);
      return null;
    }),
    writeSubtitles(timeline, outputDir, narration).catch((err) => {
      console.error('[layer5] subtitles failed:', err.message);
      return null;
    }),
    generateCaptions(job, options).catch((err) => {
      console.error('[layer5] captions failed:', err.message);
      return null;
    })
  ]);
  const subtitleOverlays = await writeSubtitleOverlays(narration, outputDir).catch((err) => {
    console.error('[layer5] subtitle overlays failed:', err.message);
    return [];
  });

  const finalVideoPath = await renderTimeline(job, assetBank, timeline, review, {
    ...options,
    outputDir,
    voiceoverPath,
    subtitlesPath,
    subtitleOverlays
  }).catch((err) => {
      console.error('[layer5] render failed:', err.stderr || err.message);
      return fallbackAssemble(job, outputDir).catch((fallbackErr) => {
        console.error('[layer5] fallback render failed:', fallbackErr.message);
        return null;
      });
    });

  const artifactPaths = await persistArtifacts(outputDir, { assetBank, shotManifest, timeline, review, narration });
  return {
    final_video_path: finalVideoPath,
    captions,
    narration_script: narration.text,
    narration_plan: narration,
    narration_plan_path: artifactPaths.narration_plan_path,
    voiceover_path: voiceoverPath,
    subtitles_path: subtitlesPath,
    subtitle_overlay_paths: subtitleOverlays.map((overlay) => overlay.path),
    asset_bank: assetBank,
    asset_bank_path: artifactPaths.asset_bank_path,
    shot_manifest: shotManifest,
    shot_manifest_path: artifactPaths.shot_manifest_path,
    timeline,
    timeline_path: artifactPaths.timeline_path,
    review_report: review,
    review_report_path: artifactPaths.review_report_path
  };
}

async function renderTimeline(job, assetBank, timeline, review, options) {
  if (!review.pass || timeline.segments.length === 0) {
    return fallbackAssemble(job, options.outputDir);
  }

  const outputPath = path.join(options.outputDir, 'final_16x9.mp4');
  const inputs = [];
  const inputMap = new Map();
  let inputIndex = 0;

  for (const segment of timeline.segments) {
    if (!inputMap.has(segment.asset_id)) {
      inputMap.set(segment.asset_id, inputIndex);
      if (segment.media_type === 'image') {
        inputs.push('-loop', '1', '-i', segment.path);
      } else {
        inputs.push('-i', segment.path);
      }
      inputIndex += 1;
    }
  }

  const duration = timeline.total_duration || timeline.segments.reduce((sum, segment) => sum + segment.output_duration, 0);
  const overlayInputs = new Map();
  for (const overlay of options.subtitleOverlays ?? []) {
    overlayInputs.set(overlay.sequence_index, inputIndex);
    inputs.push('-loop', '1', '-i', overlay.path);
    inputIndex += 1;
  }
  const audioPlan = buildAudioPlan(assetBank, duration, { ...options, timelineInputCount: inputIndex });
  inputs.push(...audioPlan.inputs);

  const videoParts = [];
  for (const segment of timeline.segments) {
    const idx = inputMap.get(segment.asset_id);
    const label = `v${segment.sequence_index}`;
    const baseLabel = overlayInputs.has(segment.sequence_index) ? `vb${segment.sequence_index}` : label;
    const filters = segment.media_type === 'image'
      ? buildImageFilters(segment)
      : buildVideoFilters(segment);
    videoParts.push(`[${idx}:v]${filters}[${baseLabel}]`);
    if (overlayInputs.has(segment.sequence_index)) {
      videoParts.push(`[${baseLabel}][${overlayInputs.get(segment.sequence_index)}:v]overlay=0:0:format=auto[${label}]`);
    }
  }

  const concatInputs = timeline.segments.map((segment) => `[v${segment.sequence_index}]`).join('');
  const filterParts = [
    ...videoParts,
    `${concatInputs}concat=n=${timeline.segments.length}:v=1:a=0[vbase]`
  ];
  let videoOutputLabel = '[vbase]';
  if (options.subtitlesPath && !options.subtitleOverlays?.length) {
    filterParts.push(`[vbase]subtitles=filename='${escapeFilterPath(options.subtitlesPath)}'[vout]`);
    videoOutputLabel = '[vout]';
  }
  filterParts.push(...audioPlan.filters);

  await execWith(options.execFileImpl, 'ffmpeg', [
    '-y',
    ...inputs,
    '-filter_complex', filterParts.join(';'),
    '-map', videoOutputLabel,
    '-map', audioPlan.outputLabel,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-movflags', '+faststart',
    outputPath
  ]);

  return outputPath;
}

function buildAudioPlan(assetBank, duration, options) {
  const inputs = [];
  const filters = [];
  const hasVoiceover = Boolean(options.voiceoverPath);
  const hasMusic = Boolean(assetBank.music_bed_path);
  let nextIndex = options.timelineInputCount ?? 0;

  if (hasVoiceover) {
    inputs.push('-i', options.voiceoverPath);
    filters.push(`[${nextIndex}:a]apad,atrim=0:${duration},asetpts=PTS-STARTPTS,volume=1.0[voice]`);
    nextIndex += 1;
  }

  if (hasMusic) {
    inputs.push('-stream_loop', '-1', '-i', assetBank.music_bed_path);
    filters.push(`[${nextIndex}:a]atrim=0:${duration},asetpts=PTS-STARTPTS,volume=0.14[music]`);
    nextIndex += 1;
  }

  if (hasVoiceover && hasMusic) {
    filters.push(`[voice][music]amix=inputs=2:duration=longest:dropout_transition=0,atrim=0:${duration}[aout]`);
    return { inputs, filters, outputLabel: '[aout]' };
  }
  if (hasVoiceover) return { inputs, filters, outputLabel: '[voice]' };
  if (hasMusic) return { inputs, filters, outputLabel: '[music]' };

  inputs.push('-f', 'lavfi', '-t', String(duration), '-i', 'anullsrc=r=44100:cl=stereo');
  filters.push(`[${nextIndex}:a]asetpts=PTS-STARTPTS[aout]`);
  return { inputs, filters, outputLabel: '[aout]' };
}

function buildVideoFilters(segment) {
  const filters = [
    `trim=start=${segment.source_in}:end=${segment.source_out}`,
    'setpts=PTS-STARTPTS',
    `tpad=stop_mode=clone:stop_duration=${segment.output_duration}`,
    `trim=duration=${segment.output_duration}`,
    `scale=${OUTPUT_W}:${OUTPUT_H}:force_original_aspect_ratio=increase`,
    `crop=${OUTPUT_W}:${OUTPUT_H}`,
    `fps=${FPS}`,
    'format=yuv420p'
  ];
  return filters.join(',');
}

function buildImageFilters(segment) {
  const totalFrames = Math.max(1, Math.round(segment.output_duration * FPS));
  const endScale = segment.zoom_keyframes?.at(-1)?.scale ?? 1.08;
  return [
    `scale=${OUTPUT_W}:${OUTPUT_H}:force_original_aspect_ratio=increase`,
    `crop=${OUTPUT_W}:${OUTPUT_H}`,
    `zoompan=z='min(zoom+${((endScale - 1) / totalFrames).toFixed(5)},${endScale})':d=${totalFrames}:s=${OUTPUT_W}x${OUTPUT_H}:fps=${FPS}`,
    'format=yuv420p',
    'setpts=PTS-STARTPTS'
  ].join(',');
}

async function fallbackAssemble(job, outputDir) {
  const clips = (job.artifacts?.approved_room_clips ?? []).filter((clip) => clip.path);
  if (clips.length === 0) return null;
  const outputPath = path.join(outputDir, 'final_16x9.mp4');

  if (clips.length === 1) {
    await execWith(null, 'ffmpeg', [
      '-y', '-i', clips[0].path,
      '-vf', `fps=${FPS},scale=${OUTPUT_W}:${OUTPUT_H}:force_original_aspect_ratio=decrease,pad=${OUTPUT_W}:${OUTPUT_H}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-movflags', '+faststart',
      outputPath
    ]);
    return outputPath;
  }

  const inputs = clips.flatMap((clip) => ['-i', clip.path]);
  const parts = clips.map((_, i) => `[${i}:v]fps=${FPS},scale=${OUTPUT_W}:${OUTPUT_H}:force_original_aspect_ratio=decrease,pad=${OUTPUT_W}:${OUTPUT_H}:(ow-iw)/2:(oh-ih)/2,format=yuv420p[v${i}]`);
  const concat = clips.map((_, i) => `[v${i}]`).join('');
  parts.push(`${concat}concat=n=${clips.length}:v=1:a=0[vout]`);

  await execWith(null, 'ffmpeg', [
    '-y',
    ...inputs,
    '-f', 'lavfi', '-t', String(clips.length * 5), '-i', 'anullsrc=r=44100:cl=stereo',
    '-filter_complex', parts.join(';'),
    '-map', '[vout]',
    '-map', `${clips.length}:a`,
    '-shortest',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-movflags', '+faststart',
    outputPath
  ]);

  return outputPath;
}

function reviseTimeline(timeline) {
  const deduped = [];
  for (const segment of timeline.segments) {
    const prev = deduped.at(-1);
    if (prev && prev.asset_id === segment.asset_id) continue;
    const next = { ...segment };
    if (prev && prev.motion_preset === next.motion_preset) {
      next.motion_preset = alternateMotion(next.motion_preset);
    }
    deduped.push(next);
  }
  return {
    ...timeline,
    total_duration: round(deduped.reduce((sum, segment) => sum + segment.output_duration, 0)),
    segments: deduped.map((segment, index) => ({ ...segment, sequence_index: index }))
  };
}

function alternateMotion(motion) {
  if (motion === 'slow_hold') return 'push_in';
  if (motion === 'push_in') return 'lateral_pan';
  if (motion === 'lateral_pan') return 'slow_hold';
  return 'slow_hold';
}

async function persistArtifacts(outputDir, payload) {
  const paths = {
    asset_bank_path: path.join(outputDir, 'asset_bank.json'),
    shot_manifest_path: path.join(outputDir, 'shot_manifest.json'),
    timeline_path: path.join(outputDir, 'timeline.json'),
    review_report_path: path.join(outputDir, 'review_report.json'),
    narration_plan_path: path.join(outputDir, 'narration_plan.json')
  };
  await Promise.all([
    writeJson(paths.asset_bank_path, payload.assetBank),
    writeJson(paths.shot_manifest_path, payload.shotManifest),
    writeJson(paths.timeline_path, payload.timeline),
    writeJson(paths.review_report_path, payload.review),
    writeJson(paths.narration_plan_path, payload.narration)
  ]);
  return paths;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function buildNarrationPlan(job, assetBank, timeline, options = {}) {
  const generated = await generateTimelineNarration(job, assetBank, timeline, options);
  if (generated) return generated;

  const script = job.handoff?.delivery?.video_script;
  const scriptedSegments = normalizeScriptSegments(script, timeline);
  if (scriptedSegments.length > 0) {
    return {
      title: script?.title ?? null,
      text: scriptedSegments.map((segment) => segment.narration).join(' '),
      segments: scriptedSegments
    };
  }

  return buildFallbackNarrationPlan(job, timeline);
}

async function generateTimelineNarration(job, assetBank, timeline, options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!apiKey || typeof fetchImpl !== 'function' || timeline.segments.length === 0) return null;

  const roomsById = new Map((job.rooms ?? []).map((room) => [room.room_id, room]));
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: options.narrationModel ?? NARRATION_MODEL,
      instructions: 'You write premium real estate voiceover that follows the edit shot by shot. Return only valid JSON.',
      input: [{
        role: 'user',
        content: JSON.stringify({
          task: 'Write one connected story with exactly one narration beat for every timeline segment.',
          aesthetic_name: job.handoff?.vibe_report?.aesthetic_name ?? null,
          aesthetic_summary: job.handoff?.vibe_report?.summary ?? job.handoff?.delivery?.caption_context?.aesthetic_summary ?? null,
          property_brief: job.handoff?.delivery?.caption_context?.property_brief ?? null,
          shot_count: timeline.segments.length,
          total_duration: timeline.total_duration,
          assets: assetBank.assets?.map((asset) => ({
            asset_id: asset.asset_id,
            label: asset.label,
            shot_type: asset.shot_type,
            room_id: asset.room_id
          })),
          timeline: timeline.segments.map((segment) => {
            const room = roomsById.get(segment.room_id);
            return {
              sequence_index: segment.sequence_index,
              start: segment.start_time,
              end: round(segment.start_time + segment.output_duration),
              duration: segment.output_duration,
              label: segment.label,
              shot_type: segment.shot_type,
              room_id: segment.room_id,
              room_name: room?.room_name ?? segment.room_id,
              motion_preset: segment.motion_preset,
              existing_caption: segment.caption_text,
              creative_headline: room?.creative_headline ?? null,
              creative_prompt: room?.creative_prompt ?? null
            };
          }),
          rules: [
            'Return exactly one segment for each timeline segment, preserving sequence_index.',
            'Narration must describe what is on screen at that moment.',
            'Name the room or visual shown in that shot and mention the camera motion when useful.',
            'Make the beats connect into a story: blueprint promise, entry/living flow, private retreat, dining/kitchen rhythm, outdoor pause, bathroom finish, closing invitation.',
            'Avoid generic lines like serene retreat, visionary home, haven, dream home, luxury living, enchants, or schedule your tour unless tied to the visible shot.',
            'Use concrete visual details from the room and Layer 3 plan.',
            'Keep each subtitle_text under 52 characters.'
          ]
        })
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'haus_timeline_narration',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'story_arc', 'segments'],
            properties: {
              title: { type: 'string' },
              story_arc: { type: 'string' },
              segments: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['sequence_index', 'narration', 'subtitle_text'],
                  properties: {
                    sequence_index: { type: 'number' },
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
  if (!response.ok) throw new Error(body?.error?.message ?? `OpenAI timeline narration failed with status ${response.status}.`);
  const text = body?.output_text ?? extractOutputText(body);
  if (!text) return null;
  const narration = normalizeTimelineNarration(JSON.parse(text), timeline);
  return narration.segments.length === timeline.segments.length ? narration : null;
}

function normalizeTimelineNarration(script, timeline) {
  const byIndex = new Map((script.segments ?? []).map((segment) => [Number(segment.sequence_index), segment]));
  const segments = timeline.segments.map((timelineSegment) => {
    const scriptSegment = byIndex.get(Number(timelineSegment.sequence_index));
    return {
      sequence_index: timelineSegment.sequence_index,
      start: timelineSegment.start_time,
      end: round(timelineSegment.start_time + timelineSegment.output_duration),
      narration: scriptSegment?.narration ?? timelineSegment.caption_text,
      subtitle_text: scriptSegment?.subtitle_text ?? timelineSegment.caption_text
    };
  }).filter((segment) => segment.narration);
  return {
    title: script.title ?? null,
    story_arc: script.story_arc ?? null,
    text: segments.map((segment) => segment.narration).join(' '),
    segments
  };
}

function buildFallbackNarrationPlan(job, timeline) {
  const aesthetic = job.handoff?.vibe_report?.aesthetic_name ?? 'this home';
  const summary = job.handoff?.vibe_report?.summary ?? job.handoff?.delivery?.caption_context?.aesthetic_summary ?? 'a clear property story';
  const segments = timeline.segments.map((segment) => {
    const roomName = titleCase(segment.room_id ?? segment.label ?? 'home');
    const motion = segment.motion_preset?.replaceAll('_', ' ') ?? 'camera';
    if (segment.sequence_index === 0 && segment.shot_type !== 'footage') {
      return narrationSegment(segment, `The edit opens with the plan and render, setting up ${aesthetic} before we enter the rooms.`, 'Plan before the walkthrough.');
    }
    if (segment.shot_type === 'footage') {
      return narrationSegment(segment, `Now the ${motion} moves through ${roomName}, showing how ${summary} becomes an actual daily room.`, `${roomName}: ${motion}.`);
    }
    return narrationSegment(segment, `We close by returning to the full property idea, tying the room flow back to the tour.`, 'Return to the full vision.');
  });
  return {
    title: `${aesthetic} timeline narration`,
    story_arc: 'Shot-by-shot property walkthrough',
    text: segments.map((segment) => segment.narration).join(' '),
    segments
  };
}

function narrationSegment(timelineSegment, narration, subtitleText) {
  return {
    sequence_index: timelineSegment.sequence_index,
    start: timelineSegment.start_time,
    end: round(timelineSegment.start_time + timelineSegment.output_duration),
    narration,
    subtitle_text: subtitleText
  };
}

function normalizeScriptSegments(script, timeline) {
  const source = Array.isArray(script?.segments) ? script.segments : [];
  if (source.length === 0 || timeline.segments.length === 0) return [];
  return timeline.segments.map((timelineSegment, index) => {
    const scriptSegment = source[index] ?? source.at(-1);
    const narration = scriptSegment?.narration ?? scriptSegment?.subtitle_text;
    if (!narration) return null;
    return {
      type: scriptSegment.type ?? timelineSegment.audio_role ?? 'beat',
      start: timelineSegment.start_time,
      end: timelineSegment.start_time + timelineSegment.output_duration,
      narration,
      subtitle_text: scriptSegment.subtitle_text ?? narration
    };
  }).filter(Boolean);
}

async function generateVoiceover(narration, outputDir, options = {}) {
  if (!narration?.text) return null;
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!apiKey || typeof fetchImpl !== 'function') return null;

  const response = await fetchImpl(OPENAI_SPEECH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: options.ttsModel ?? TTS_MODEL,
      voice: options.ttsVoice ?? TTS_VOICE,
      input: narration.text,
      format: 'mp3'
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(body || `OpenAI speech request failed with status ${response.status}.`);
  }

  const bytes = await response.arrayBuffer();
  const outputPath = path.join(outputDir, 'voiceover.mp3');
  await writeFile(outputPath, Buffer.from(bytes));
  return outputPath;
}

async function writeSubtitles(timeline, outputDir, narration = null) {
  const segments = narration?.segments?.length ? narration.segments : (timeline.segments ?? [])
    .filter((segment) => segment.caption_text)
    .map((segment) => ({
      start: segment.start_time,
      end: segment.start_time + segment.output_duration,
      subtitle_text: segment.caption_text
    }));

  const events = segments
    .filter((segment) => segment.subtitle_text)
    .map((segment) => `Dialogue: 0,${formatAssTime(segment.start)},${formatAssTime(segment.end)},Default,,0,0,0,,${escapeAssText(segment.subtitle_text)}`)
    .join('\n');

  if (!events) return null;
  const outputPath = path.join(outputDir, 'subtitles.ass');
  await writeFile(outputPath, `${assHeader()}${events}\n`);
  return outputPath;
}

async function writeSubtitleOverlays(narration, outputDir) {
  const segments = narration?.segments ?? [];
  if (segments.length === 0) return [];
  const overlayDir = path.join(outputDir, 'subtitle_overlays');
  await mkdir(overlayDir, { recursive: true });
  const overlays = [];
  for (const segment of segments) {
    if (!segment.subtitle_text) continue;
    const filePath = path.join(overlayDir, `subtitle-${String(segment.sequence_index).padStart(3, '0')}.png`);
    await writeFile(filePath, renderSubtitlePng(segment.subtitle_text));
    overlays.push({ sequence_index: segment.sequence_index, path: filePath });
  }
  return overlays;
}

async function generateCaptions(job, options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!apiKey || typeof fetchImpl !== 'function') return null;

  const ctx = job.handoff?.delivery?.caption_context ?? {};
  const vibe = job.handoff?.vibe_report ?? {};
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: CAPTION_MODEL,
      instructions: 'You are a luxury real estate copywriter. Write punchy, aspirational captions. Return only valid JSON.',
      input: [
        {
          role: 'user',
          content: JSON.stringify({
            task: 'Write 3 captions for this property visualization.',
            property_brief: ctx.property_brief ?? null,
            aesthetic_name: vibe.aesthetic_name ?? null,
            aesthetic_summary: ctx.aesthetic_summary ?? vibe.summary ?? null,
            featured_objects: ctx.featured_objects ?? [],
            tone: ctx.tone ?? 'luxury_listing',
            schema: {
              instagram: 'caption with hashtags, max 150 chars',
              tiktok: 'caption with trending hashtags, max 100 chars',
              listing: 'professional property description, max 200 chars'
            }
          })
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'haus_captions',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['instagram', 'tiktok', 'listing'],
            properties: {
              instagram: { type: 'string' },
              tiktok: { type: 'string' },
              listing: { type: 'string' }
            }
          }
        }
      }
    })
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) return null;
  const text = body?.output_text ?? extractOutputText(body);
  return text ? JSON.parse(text) : null;
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

function escapeFilterPath(filePath) {
  return filePath
    .replaceAll('\\', '\\\\')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'");
}

function formatSrtTime(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds) * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':') + `,${String(ms).padStart(3, '0')}`;
}

function formatAssTime(seconds) {
  const totalCs = Math.max(0, Math.round(Number(seconds) * 100));
  const hours = Math.floor(totalCs / 360000);
  const minutes = Math.floor((totalCs % 360000) / 6000);
  const secs = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function assHeader() {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${OUTPUT_W}
PlayResY: ${OUTPUT_H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,Avenir Next,62,&H00FFFFFF,&H00FFFFFF,&H9A000000,&H78000000,-1,0,0,0,100,100,0,0,1,5,1,2,140,140,86,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
`;
}

function escapeAssText(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('{', '\\{')
    .replaceAll('}', '\\}')
    .replace(/\r?\n/g, '\\N');
}

function titleCase(value) {
  return String(value ?? '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderSubtitlePng(text) {
  const width = OUTPUT_W;
  const height = OUTPUT_H;
  const pixels = Buffer.alloc(width * height * 4);
  const scale = 7;
  const lines = wrapSubtitle(text, 34).slice(0, 2);
  const lineHeight = 9 * scale;
  const blockHeight = lines.length * lineHeight + 58;
  const rectW = Math.min(1540, Math.max(...lines.map((line) => line.length), 1) * 6 * scale + 120);
  const rectX = Math.round((width - rectW) / 2);
  const rectY = height - blockHeight - 70;
  fillRect(pixels, width, rectX, rectY, rectW, blockHeight, [0, 0, 0, 155]);

  lines.forEach((line, lineIndex) => {
    const textW = line.length * 6 * scale;
    const x = Math.round((width - textW) / 2);
    const y = rectY + 28 + lineIndex * lineHeight;
    drawText(pixels, width, x, y, line, scale, [255, 255, 255, 255]);
  });

  return encodePng(width, height, pixels);
}

function wrapSubtitle(text, maxChars) {
  const words = String(text ?? '').toUpperCase().replace(/[^A-Z0-9 '&.,:;!?-]/g, '').split(/\s+/).filter(Boolean);
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
  return lines.length ? lines : [''];
}

function drawText(pixels, width, x, y, text, scale, color) {
  let cursor = x;
  for (const char of text) {
    drawGlyph(pixels, width, cursor, y, FONT[char] ?? FONT[' '], scale, color);
    cursor += 6 * scale;
  }
}

function drawGlyph(pixels, width, x, y, glyph, scale, color) {
  glyph.forEach((row, rowIndex) => {
    [...row].forEach((cell, colIndex) => {
      if (cell !== '1') return;
      fillRect(pixels, width, x + colIndex * scale, y + rowIndex * scale, scale, scale, color);
    });
  });
}

function fillRect(pixels, width, x, y, rectW, rectH, color) {
  for (let row = Math.max(0, y); row < Math.min(OUTPUT_H, y + rectH); row += 1) {
    for (let col = Math.max(0, x); col < Math.min(OUTPUT_W, x + rectW); col += 1) {
      const offset = (row * width + col) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
    }
  }
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
    pngChunk('IHDR', Buffer.from([
      ...u32(width),
      ...u32(height),
      8,
      6,
      0,
      0,
      0
    ])),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const body = Buffer.concat([typeBuffer, data]);
  return Buffer.concat([
    Buffer.from(u32(data.length)),
    body,
    Buffer.from(u32(crc32(body)))
  ]);
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
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
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101']
};

async function execWith(execFileImpl, command, args) {
  if (execFileImpl) return execFileImpl(command, args);
  return execFileAsync(command, args);
}

function round(value) {
  return Number(value.toFixed(3));
}
