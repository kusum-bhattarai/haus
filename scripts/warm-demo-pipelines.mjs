#!/usr/bin/env node
/**
 * Runs all 3 demo pipelines in parallel and writes demo_presets.json on completion.
 * Run after clearing .haus-cache and starting the server:
 *
 *   node scripts/warm-demo-pipelines.mjs
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://127.0.0.1:3000';
const CACHE_DIR = path.join(ROOT, '.haus-cache');
const PRESETS_PATH = path.join(CACHE_DIR, 'demo_presets.json');

const PIPELINES = [
  {
    label: 'A1 · Japandi',
    floor_plan_id: '1b1',
    pinterest_board_url: 'https://www.pinterest.com/tarive22/japandi-interior-design/',
    brief: 'Warm, calm home for a young family that needs a cozy work corner.',
    objects: ['standing_desk', 'bookshelf'],
  },
  {
    label: 'B2 · Artistic',
    floor_plan_id: '2b2',
    pinterest_board_url: 'https://www.pinterest.com/tarive22/artistic-interior/',
    brief: 'Creative, expressive living space with eclectic artistic flair.',
    objects: ['standing_desk', 'bookshelf'],
  },
  {
    label: 'C3 · Dark',
    floor_plan_id: '3b2',
    pinterest_board_url: 'https://www.pinterest.com/tarive22/dark-interior/',
    brief: 'Bold, sophisticated home with dramatic moody interiors.',
    objects: ['standing_desk', 'bookshelf'],
  },
];

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function getJob(jobId) {
  const res = await fetch(`${BASE}/api/jobs/${jobId}`);
  return res.json();
}

async function waitForJob(label, jobId, pollMs = 8000) {
  while (true) {
    const job = await getJob(jobId);
    const state = job.current_state ?? job.status;
    console.log(`  [${label}] ${state}`);
    if (job.status === 'completed') return job;
    if (job.status === 'failed') throw new Error(`${label} failed: ${job.warnings?.at(-1)?.message ?? 'unknown'}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

function presetKey(p) {
  return `${p.floor_plan_id}|${p.pinterest_board_url}|${[...p.objects].sort().join(',')}`;
}

async function main() {
  console.log('Starting all 3 demo pipelines in parallel...\n');

  const jobs = await Promise.all(
    PIPELINES.map(async (p) => {
      const result = await post(`${BASE}/api/jobs`, {
        floor_plan_id: p.floor_plan_id,
        pinterest_board_url: p.pinterest_board_url,
        brief: p.brief,
        objects: p.objects,
        platform: 'all',
      });
      console.log(`✓ ${p.label} → job ${result.job_id} (${result.status})`);
      return { pipeline: p, job_id: result.job_id, status: result.status };
    })
  );

  // Any already-completed presets (from a previous run) can be skipped
  const pending = jobs.filter((j) => j.status !== 'completed');
  const completed = jobs.filter((j) => j.status === 'completed');

  if (pending.length) {
    console.log(`\nWaiting for ${pending.length} pipeline(s) to complete...\n`);
    await Promise.all(
      pending.map(async ({ pipeline, job_id }) => {
        console.log(`  [${pipeline.label}] polling job ${job_id}...`);
        await waitForJob(pipeline.label, job_id);
        console.log(`  ✓ [${pipeline.label}] done`);
        completed.push({ pipeline, job_id });
      })
    );
  }

  // Write demo_presets.json
  await mkdir(CACHE_DIR, { recursive: true });
  let presets = {};
  try { presets = JSON.parse(await readFile(PRESETS_PATH, 'utf8')); } catch { /* new file */ }

  for (const { pipeline, job_id } of completed) {
    presets[presetKey(pipeline)] = job_id;
  }
  await writeFile(PRESETS_PATH, `${JSON.stringify(presets, null, 2)}\n`);

  console.log('\n✅ demo_presets.json written:');
  for (const [key, id] of Object.entries(presets)) {
    console.log(`   "${key}" → ${id}`);
  }
  console.log('\nDone. Restart the server and all 3 demos will be instant.');
}

main().catch((err) => { console.error(err); process.exit(1); });
