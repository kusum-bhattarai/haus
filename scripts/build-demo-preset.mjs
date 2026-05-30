#!/usr/bin/env node
/**
 * Assembles the final video for a completed agent job and registers it as a demo preset.
 * Run once before a demo to pre-cache the result:
 *
 *   node scripts/build-demo-preset.mjs
 *
 * The preset maps (floor_plan_id, pinterest_board_url, objects) to the job_id so that
 * POST /api/jobs with matching inputs returns the cached job instantly instead of
 * re-running the full pipeline.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const JOB_ID = 'c92d50bc-4125-405d-93f7-79a810bd7ddc';
const CACHE_DIR = path.join(ROOT, '.haus-cache');
const JOBS_DIR = path.join(CACHE_DIR, 'agent', 'jobs');

// The inputs the demo presenter will choose.
const PRESET_FLOOR_PLAN_ID = '1b1';
const PRESET_PINTEREST_URL = 'https://www.pinterest.com/tarive22/artistic-interior/';
const PRESET_OBJECTS = ['standing_desk', 'bookshelf'];

async function main() {
  const jobDir = path.join(JOBS_DIR, JOB_ID);
  const jobPath = path.join(jobDir, 'job.json');

  console.log(`Reading job ${JOB_ID}…`);
  const job = JSON.parse(await readFile(jobPath, 'utf8'));

  const clips = (job.artifacts?.approved_room_clips ?? []).filter((c) => c.path);
  if (clips.length === 0) {
    console.error('No approved_room_clips found — run the pipeline first.');
    process.exit(1);
  }
  console.log(`Found ${clips.length} clips: ${clips.map((c) => c.room_id).join(', ')}`);

  const finalVideoPath = job.artifacts?.final_video_path;
  if (!finalVideoPath) {
    console.log('Final video not yet assembled — running layer5 now…');
    const { runLayer5 } = await import('../src/layer5/index.js');

    const roomOrder = new Map((job.rooms ?? []).map((r) => [r.room_id, r.sequence_index ?? 0]));
    const sortedClips = [...clips].sort((a, b) => (roomOrder.get(a.room_id) ?? 0) - (roomOrder.get(b.room_id) ?? 0));
    const jobForLayer5 = { ...job, artifacts: { ...job.artifacts, approved_room_clips: sortedClips }, _job_dir: jobDir };

    const layer5 = await runLayer5(jobForLayer5);
    console.log('Assembly done →', layer5.final_video_path);

    job.status = 'completed';
    job.current_state = 'COMPLETED';
    job.artifacts.final_video_path = layer5.final_video_path;
    job.artifacts.final_video_url = `/api/jobs/${JOB_ID}/assets/layer5/final_16x9.mp4`;
    job.artifacts.timeline = layer5.timeline;
    job.artifacts.shot_manifest = layer5.shot_manifest;

    await writeFile(jobPath, `${JSON.stringify(job, null, 2)}\n`);
    console.log('job.json updated to completed.');
  } else {
    console.log('Final video already assembled:', finalVideoPath);
    if (job.status !== 'completed') {
      job.status = 'completed';
      job.current_state = 'COMPLETED';
      job.artifacts.final_video_url = `/api/jobs/${JOB_ID}/assets/layer5/final_16x9.mp4`;
      await writeFile(jobPath, `${JSON.stringify(job, null, 2)}\n`);
      console.log('job.json updated to completed.');
    }
  }

  // Write / update demo_presets.json
  const presetsPath = path.join(CACHE_DIR, 'demo_presets.json');
  let presets = {};
  try {
    presets = JSON.parse(await readFile(presetsPath, 'utf8'));
  } catch {
    // file doesn't exist yet
  }

  const key = demoPresetKey(PRESET_FLOOR_PLAN_ID, PRESET_PINTEREST_URL, PRESET_OBJECTS);
  presets[key] = JOB_ID;

  await writeFile(presetsPath, `${JSON.stringify(presets, null, 2)}\n`);
  console.log(`demo_presets.json updated: "${key}" → ${JOB_ID}`);
  console.log('\nDone. Start the server and the demo will skip the pipeline for these inputs.');
}

function demoPresetKey(floorPlanId, pinterestUrl, objects) {
  const sortedObjects = [...(objects ?? [])].sort().join(',');
  return `${floorPlanId}|${pinterestUrl}|${sortedObjects}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
