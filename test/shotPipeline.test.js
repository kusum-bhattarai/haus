import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runLayer5 } from '../src/layer5/index.js';
import { buildAssetBank, buildDirectedTimeline, classifyShots, reviewTimeline } from '../src/shotPipeline/index.js';

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'haus-shot-pipeline-'));
}

function sampleJob(rootDir) {
  return {
    _job_dir: path.join(rootDir, 'job-1'),
    job_id: 'job-1',
    input: { floor_plan_id: '1b1' },
    handoff: {
      creative_spec: {
        room_sequence: ['living_room_1', 'bedroom_1']
      },
      delivery: {
        caption_context: {
          property_brief: 'Warm family condo',
          aesthetic_summary: 'Warm japandi',
          featured_objects: ['crib'],
          tone: 'luxury_listing'
        }
      },
      vibe_report: {
        aesthetic_name: 'Warm Japandi Family Calm',
        summary: 'Calm warm-neutral interiors.'
      }
    },
    rooms: [
      {
        room_id: 'living_room_1',
        room_name: 'living room',
        sequence_index: 0,
        current_motion_mode: 'slow_dolly',
        artifacts: {
          styled_image_path: path.join(rootDir, 'living-still.png'),
          styled_image_url: 'https://cdn.example.com/living-still.png'
        },
        video_generation: {
          duration_seconds: 5
        }
      },
      {
        room_id: 'bedroom_1',
        room_name: 'bedroom',
        sequence_index: 1,
        current_motion_mode: 'static_zoom',
        artifacts: {
          styled_image_path: path.join(rootDir, 'bedroom-still.png'),
          styled_image_url: 'https://cdn.example.com/bedroom-still.png'
        },
        video_generation: {
          duration_seconds: 5
        }
      }
    ],
    artifacts: {
      approved_room_clips: [
        {
          room_id: 'living_room_1',
          path: path.join(rootDir, 'living-room.mp4'),
          url: 'https://cdn.example.com/living-room.mp4'
        },
        {
          room_id: 'bedroom_1',
          path: path.join(rootDir, 'bedroom.mp4'),
          url: 'https://cdn.example.com/bedroom.mp4'
        }
      ]
    }
  };
}

test('buildAssetBank loads room assets and curated manifest extras', async () => {
  const rootDir = await tempRoot();
  const manifestDir = path.join(rootDir, 'property_assets', '1b1');
  await mkdir(manifestDir, { recursive: true });
  await writeFile(path.join(manifestDir, 'manifest.json'), JSON.stringify({
    music_bed: 'music.mp3',
    assets: [
      { id: 'drone-open', path: 'drone.mp4', type: 'drone', label: 'Arrival drone' },
      { id: 'pool-broll', path: 'pool.png', type: 'broll', label: 'Pool detail' }
    ]
  }));

  const bank = await buildAssetBank(sampleJob(rootDir), { rootDir });

  assert.equal(bank.music_bed_path, path.join(manifestDir, 'music.mp3'));
  assert.equal(bank.assets.some((asset) => asset.kind === 'approved_room_clip'), true);
  assert.equal(bank.assets.some((asset) => asset.shot_type === 'drone'), true);
  assert.equal(bank.assets.some((asset) => asset.shot_type === 'broll'), true);
});

test('director covers rooms before reuse and review accepts deterministic timeline', async () => {
  const rootDir = await tempRoot();
  const job = sampleJob(rootDir);
  const assetBank = await buildAssetBank(job, { rootDir });
  const shotManifest = classifyShots(assetBank);
  const timeline = buildDirectedTimeline(job, shotManifest);
  const review = reviewTimeline(job, assetBank, timeline);

  assert.equal(timeline.segments.length >= 2, true);
  assert.deepEqual(
    timeline.segments.filter((segment) => segment.room_id).slice(0, 2).map((segment) => segment.room_id),
    ['living_room_1', 'bedroom_1']
  );
  assert.equal(review.pass, true);
});

test('runLayer5 emits timeline, manifest, review report, and render path', async () => {
  const rootDir = await tempRoot();
  const jobDir = path.join(rootDir, 'job-1');
  await mkdir(jobDir, { recursive: true });
  const manifestDir = path.join(rootDir, 'property_assets', '1b1');
  await mkdir(manifestDir, { recursive: true });
  await writeFile(path.join(manifestDir, 'manifest.json'), JSON.stringify({
    assets: [
      { id: 'drone-open', path: 'drone.mp4', type: 'drone', label: 'Arrival drone' }
    ]
  }));

  const commands = [];
  const result = await runLayer5(sampleJob(rootDir), {
    rootDir,
    execFileImpl: async (command, args) => {
      commands.push({ command, args });
      return { stdout: '', stderr: '' };
    },
    fetchImpl: async (url, request) => {
      if (url.endsWith('/audio/speech')) {
        return {
          ok: true,
          async arrayBuffer() {
            return new TextEncoder().encode('mp3').buffer;
          }
        };
      }
      const payload = JSON.parse(request.body);
      if (payload.text?.format?.name === 'haus_timeline_narration') {
        return {
          ok: true,
          async json() {
            return {
              output_text: JSON.stringify({
                title: 'Shot story',
                story_arc: 'Room by room',
                segments: [
                  { sequence_index: 0, narration: 'The arrival shot sets the scale.', subtitle_text: 'Arrival sets the scale.' },
                  { sequence_index: 1, narration: 'The living room move opens the flow.', subtitle_text: 'Living flow.' },
                  { sequence_index: 2, narration: 'The bedroom move turns private.', subtitle_text: 'Private retreat.' },
                  { sequence_index: 3, narration: 'The closing shot returns to the tour.', subtitle_text: 'Book the tour.' }
                ]
              })
            };
          }
        };
      }
      return {
        ok: true,
        async json() {
          return { output_text: JSON.stringify({ instagram: 'ig', tiktok: 'tt', listing: 'ls' }) };
        }
      };
    },
    apiKey: 'key'
  });

  assert.equal(commands.some(({ command }) => command === 'ffmpeg'), true);
  assert.equal(commands.some(({ args }) => args.includes('subtitles.srt')), false);
  assert.equal(commands.some(({ args }) => args.some((arg) => String(arg).includes('overlay=0:0'))), true);
  assert.equal(commands.some(({ args }) => args.includes('-shortest')), false);
  assert.equal(result.shot_manifest.counts.drone >= 1, true);
  assert.equal(result.timeline.segments.length >= 2, true);
  assert.equal(result.review_report.pass, true);
  assert.match(result.timeline_path, /timeline\.json$/);
  assert.match(result.voiceover_path, /voiceover\.mp3$/);
  assert.match(result.subtitles_path, /subtitles\.ass$/);
  assert.equal(result.subtitle_overlay_paths.length, result.timeline.segments.length);
  assert.equal(result.narration_plan.segments.length, result.timeline.segments.length);
  assert.equal(result.captions.instagram, 'ig');
});
