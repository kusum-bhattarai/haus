import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const CAPTION_MODEL = process.env.OPENAI_CREATIVE_MODEL ?? 'gpt-4o-mini';

const FADE_DURATION = 0.5;
const NORMALIZE_FILTER = [
  'fps=24',
  'scale=1920:1080:force_original_aspect_ratio=decrease',
  'pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
  'format=yuv420p'
].join(',');

export async function runLayer5(job, options = {}) {
  const outputDir = options.outputDir ?? path.join(job._job_dir, 'layer5');
  await mkdir(outputDir, { recursive: true });

  const clips = (job.artifacts?.approved_room_clips ?? []).filter((clip) => clip.path);
  const [finalVideoPath, captions] = await Promise.all([
    clips.length >= 1
      ? assembleVideo(clips, outputDir).catch((err) => { console.error('[layer5] ffmpeg failed:', err.message); return null; })
      : Promise.resolve(null),
    generateCaptions(job, options).catch((err) => { console.error('[layer5] captions failed:', err.message); return null; })
  ]);

  return { final_video_path: finalVideoPath, captions };
}

async function assembleVideo(clips, outputDir) {
  const sortedClips = [...clips].sort((a, b) => (a.sequence_index ?? 0) - (b.sequence_index ?? 0));
  const outputPath = path.join(outputDir, 'final_16x9.mp4');

  if (sortedClips.length === 1) {
    await execFileAsync('ffmpeg', [
      '-y', '-i', sortedClips[0].path,
      '-vf', NORMALIZE_FILTER,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-movflags', '+faststart',
      outputPath
    ]);
    return outputPath;
  }

  const durations = await Promise.all(sortedClips.map((clip) => getVideoDuration(clip.path)));

  // Per-clip normalization streams
  const normParts = sortedClips.map((_, i) => `[${i}:v]${NORMALIZE_FILTER}[v${i}]`);

  // Chain xfade transitions across all clips
  let cumOffset = 0;
  let lastLabel = '[v0]';
  const xfadeParts = [];

  for (let i = 1; i < sortedClips.length; i++) {
    cumOffset += durations[i - 1] - FADE_DURATION;
    const outLabel = i === sortedClips.length - 1 ? '[vout]' : `[x${i}]`;
    xfadeParts.push(
      `${lastLabel}[v${i}]xfade=transition=fade:duration=${FADE_DURATION}:offset=${cumOffset.toFixed(3)}${outLabel}`
    );
    lastLabel = outLabel;
  }

  const filterComplex = [...normParts, ...xfadeParts].join(';');
  const inputs = sortedClips.flatMap((clip) => ['-i', clip.path]);

  await execFileAsync('ffmpeg', [
    '-y',
    ...inputs,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-movflags', '+faststart',
    outputPath
  ]);

  return outputPath;
}

async function getVideoDuration(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      filePath
    ]);
    const duration = parseFloat(stdout.trim());
    return isNaN(duration) ? 4 : Math.max(duration, FADE_DURATION * 2);
  } catch {
    return 4;
  }
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
  if (!text) return null;
  return JSON.parse(text);
}

function extractOutputText(body) {
  const output = body?.output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    const t = item.content?.find((c) => c.type === 'output_text');
    if (typeof t?.text === 'string') return t.text;
  }
  return null;
}
