import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildScenePlan,
  fitNarrationToBudget,
  generationHashFromPath,
  loadStyleEntry,
  renderDurationForScene,
  resolveRoomAssets
} from '../scripts/cache-reel-assembler.js';

test('rewrites stale generation path through local result hash', async () => {
  const rootDir = await tmpRoot();
  const outputDir = path.join(rootDir, 'out');
  const hash = 'abc123';
  await writeJson(path.join(rootDir, '.haus-cache/agent/generations', hash, 'result.json'), {
    video: { url: 'https://v3b.fal.media/files/video.mp4' }
  });

  const job = jobWithRooms(['bedroom_1'], {
    approved_room_clips: [{ room_id: 'bedroom_1', path: `/old/.haus-cache/agent/generations/${hash}/video-0.mp4` }]
  });
  const resolved = await resolveRoomAssets(job, outputDir, {
    rootDir,
    downloadFn: fakeDownload,
    mediaDurationFn: async () => 2.4
  });

  const clip = resolved.clipsByRoomId.get('bedroom_1');
  assert.equal(clip.path, path.join(outputDir, 'assets/remote/bedroom_1.mp4'));
  assert.equal(resolved.manifest.rooms[0].source_type, 'generation_result_by_stale_path');
});

test('downloads approved remote URL into reel output assets', async () => {
  const rootDir = await tmpRoot();
  const outputDir = path.join(rootDir, 'out');
  const job = jobWithRooms(['bedroom_1'], {
    approved_room_clips: [{ room_id: 'bedroom_1', path: '/missing/video.mp4', url: 'https://cdn.example.com/room.mp4' }]
  });

  const resolved = await resolveRoomAssets(job, outputDir, {
    rootDir,
    downloadFn: fakeDownload,
    mediaDurationFn: async () => 2.8
  });

  const room = resolved.manifest.rooms[0];
  assert.equal(room.source_type, 'approved_url');
  assert.equal(room.local_path, path.join(outputDir, 'assets/remote/bedroom_1.mp4'));
  assert.equal(JSON.parse(await readFile(room.local_path, 'utf8')).url, 'https://cdn.example.com/room.mp4');
});

test('loads style id from local file before stale index path', async () => {
  const rootDir = await tmpRoot();
  const styleDir = path.join(rootDir, '.haus-cache/style-library');
  await mkdir(styleDir, { recursive: true });
  await writeJson(path.join(styleDir, 'style-a.json'), { style_id: 'style-a', vibe_report: { aesthetic_name: 'Local Style' } });
  await writeJson(path.join(styleDir, 'index.json'), {
    styles: [{ style_id: 'style-a', path: '/stale/other-machine/style-a.json' }]
  });

  const style = await loadStyleEntry({ styleId: 'style-a' }, { rootDir });
  assert.equal(style.vibe_report.aesthetic_name, 'Local Style');
});

test('partial job scene plan uses only available videos', () => {
  const job = jobWithRooms(['living_room_nest', 'bedroom_1']);
  const clipsByRoomId = new Map([['bedroom_1', { path: '/tmp/bedroom_1.mp4', duration: 2.2 }]]);
  const scenes = buildScenePlan(job, { clipsByRoomId, targetDuration: 12 });
  const clipScenes = scenes.filter((scene) => scene.type === 'clip');

  assert.equal(clipScenes.length, 1);
  assert.equal(clipScenes[0].id, 'bedroom_1');
});

test('reels use fixed 30s timing with one price summary and five rooms', () => {
  const roomIds = ['living_room_nest', 'kitchen_taste', 'bedroom_1', 'bedroom_2', 'dining_room_dine'];
  const job = jobWithRooms(roomIds);
  const clipsByRoomId = new Map(roomIds.map((roomId) => [roomId, { path: `/tmp/${roomId}.mp4`, duration: 4.9 }]));
  const scenes = buildScenePlan(job, { clipsByRoomId, reels: true });

  assert.deepEqual(scenes.map((scene) => scene.id), [
    'hook',
    'price_summary',
    'living_room_nest',
    'kitchen_taste',
    'bedroom_1',
    'bedroom_2',
    'dining_room_dine',
    'close'
  ]);
  assert.deepEqual(scenes.map((scene) => scene.budget_seconds), [5, 5, 3, 3, 3, 3, 3, 5]);
});

test('reel narration caps match 5s cards and 3s rooms', () => {
  const roomIds = ['living_room_nest'];
  const job = jobWithRooms(roomIds);
  job.handoff.vibe_report.room_guidance[0].headline = 'This room narration is deliberately much too long for a three second room clip budget.';
  const scenes = buildScenePlan(job, {
    clipsByRoomId: new Map([['living_room_nest', { path: '/tmp/living_room_nest.mp4', duration: 5 }]]),
    reels: true
  });
  const hook = scenes.find((scene) => scene.id === 'hook');
  const room = scenes.find((scene) => scene.id === 'living_room_nest');

  assert.equal(hook.max_words, 15);
  assert.equal(room.max_words, 9);
  assert.ok(wordCount(room.narration) <= 9);
});

test('render duration prefers budget seconds over voiceover duration', () => {
  assert.equal(renderDurationForScene({ type: 'card', budget_seconds: 5, duration: 1.2 }), 5);
  assert.equal(renderDurationForScene({ type: 'clip', budget_seconds: 3, duration: 8 }), 3);
});

test('over-budget narration falls back to deterministic short copy', () => {
  const text = 'This is much too long for a two second visual budget and should not survive.';
  const fitted = fitNarrationToBudget(text, 2.0, 'Oak calm room.');
  assert.equal(fitted, 'Oak calm room.');
});

test('extracts generation hash from stale absolute media path', () => {
  assert.equal(generationHashFromPath('/old/.haus-cache/agent/generations/hash123/video-0.mp4'), 'hash123');
});

function jobWithRooms(roomIds, artifacts = {}) {
  return {
    job_id: 'job-1',
    artifacts,
    handoff: {
      creative_spec: { room_sequence: roomIds },
      vibe_report: {
        aesthetic_name: 'Earthy Mid-Century Botanical',
        summary: 'Warm wood, sculptural plants, and collected art make the apartment feel expressive.',
        materials: ['walnut'],
        room_guidance: roomIds.map((room_id) => ({ room_id, headline: 'Walnut and greenery.', must_include: ['plants'] }))
      },
      room_generation_jobs: roomIds.map((room_id, sequence_index) => ({
        room_id,
        room_name: room_id,
        room_type: room_id.split('_')[0],
        sequence_index,
        staging: { must_include: ['plants'], objects_to_include: [] },
        video_generation: { camera_motion: 'slow push in' }
      }))
    },
    rooms: roomIds.map((room_id) => ({
      room_id,
      room_name: room_id,
      state: 'APPROVED',
      artifacts: { video_clip_path: null, video_url: null },
      plans: { video_plan: null }
    }))
  };
}

function wordCount(text) {
  return String(text ?? '').split(/\s+/).filter(Boolean).length;
}

async function tmpRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'haus-reel-test-'));
}

async function fakeDownload(url, destPath) {
  await mkdir(path.dirname(destPath), { recursive: true });
  await writeFile(destPath, JSON.stringify({ url }));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
