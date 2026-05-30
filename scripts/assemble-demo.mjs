#!/usr/bin/env node
/**
 * Direct ffmpeg assembly for demo — bypasses the full layer5 pipeline.
 * Concatenates approved room clips, adds the matching music bed, done.
 */
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.haus-cache');
const JOBS_DIR = path.join(CACHE_DIR, 'agent', 'jobs');
const MUSIC_DIR = path.join(ROOT, 'frontend', 'assets', 'music');

const JOBS = [
  {
    jobId: '3655307f-1ba8-46b2-ab7c-0aa569113664',
    label: 'A1 · Japandi',
    floorPlanId: '1b1',
    presetUrl: 'https://www.pinterest.com/tarive22/japandi-interior-design/',
    music: path.join(MUSIC_DIR, 'warm-japandi.mp3'),
  },
  {
    jobId: '5e6a720a-6312-48f6-9bea-e4f868c484ca',
    label: 'B2 · Artistic',
    floorPlanId: '2b2',
    presetUrl: 'https://www.pinterest.com/tarive22/artistic-interior/',
    music: path.join(MUSIC_DIR, 'earthy-mid-century.mp3'),
  },
  {
    jobId: 'c85b1d95-280c-4b11-9ffe-321dfbe50223',
    label: 'C3 · Dark',
    floorPlanId: '3b2',
    presetUrl: 'https://www.pinterest.com/tarive22/dark-interior/',
    music: path.join(MUSIC_DIR, 'japandi-noir.mp3'),
  },
];
const OBJECTS = ['standing_desk', 'bookshelf'];
const W = 1280, H = 720, FPS = 24, CRF = 23;

async function assemble({ jobId, label, music }) {
  console.log(`\n[${label}] assembling...`);
  const jobDir = path.join(JOBS_DIR, jobId);
  const job = JSON.parse(await readFile(path.join(jobDir, 'job.json'), 'utf8'));

  const roomOrder = new Map((job.rooms ?? []).map((r, i) => [r.room_id, r.sequence_index ?? i]));
  const clips = (job.artifacts?.approved_room_clips ?? [])
    .filter(c => c.path)
    .sort((a, b) => (roomOrder.get(a.room_id) ?? 0) - (roomOrder.get(b.room_id) ?? 0));

  if (!clips.length) throw new Error(`No clips for ${label}`);

  const outputDir = path.join(jobDir, 'layer5');
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'final_16x9.mp4');

  const n = clips.length;
  const videoInputs = clips.flatMap(c => ['-i', c.path]);
  const audioInput = ['-stream_loop', '-1', '-i', music];

  const vFilters = clips.map((_, i) =>
    `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=${FPS},format=yuv420p[v${i}]`
  );
  const concatInputs = clips.map((_, i) => `[v${i}]`).join('');
  const totalDuration = clips.reduce((sum, c) => sum + 5, 0); // conservative 5s/clip
  vFilters.push(`${concatInputs}concat=n=${n}:v=1:a=0[vout]`);
  const aFilter = `[${n}:a]atrim=0:${totalDuration},asetpts=PTS-STARTPTS,volume=0.18[aout]`;

  const args = [
    '-y',
    ...videoInputs,
    ...audioInput,
    '-filter_complex', [...vFilters, aFilter].join(';'),
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', String(CRF),
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-shortest',
    '-movflags', '+faststart',
    outputPath,
  ];

  console.log(`[${label}] running ffmpeg on ${n} clips...`);
  await execFileAsync('ffmpeg', args);
  console.log(`[${label}] done → ${outputPath.split('/').slice(-3).join('/')}`);
  return outputPath;
}

const presets = {};
for (const entry of JOBS) {
  const videoPath = await assemble(entry);

  // Update job.json to completed
  const jobPath = path.join(JOBS_DIR, entry.jobId, 'job.json');
  const job = JSON.parse(await readFile(jobPath, 'utf8'));
  job.status = 'completed';
  job.current_state = 'COMPLETED';
  job.artifacts.final_video_path = videoPath;
  job.artifacts.final_video_url = `/api/jobs/${entry.jobId}/assets/layer5/final_16x9.mp4`;
  await writeFile(jobPath, `${JSON.stringify(job, null, 2)}\n`);

  const key = `${entry.floorPlanId}|${entry.presetUrl}|${[...OBJECTS].sort().join(',')}`;
  presets[key] = entry.jobId;
}

await mkdir(CACHE_DIR, { recursive: true });
await writeFile(path.join(CACHE_DIR, 'demo_presets.json'), `${JSON.stringify(presets, null, 2)}\n`);

console.log('\n✅ demo_presets.json written:');
Object.entries(presets).forEach(([k, v]) => console.log(`  ${k.split('|')[0]} → ${v.slice(0, 8)}`));
console.log('\nRestart the server and all 3 demos will be instant.');
