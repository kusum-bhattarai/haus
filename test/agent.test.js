import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';

import { createHausServer } from '../server.js';
import { createCreativeAgent, createEvalAgent, createGenmediaAdapter, createJobManager, createAgentRuntime, loadAutohdrSkill, routeEvalDecision } from '../src/agent/index.js';

async function tempCacheDir() {
  return mkdtemp(path.join(os.tmpdir(), 'haus-agent-'));
}

function sampleHandoff() {
  return {
    handoff_id: 'handoff_1',
    session_id: 'session_1',
    pinterest_intelligence: {
      aesthetic_profile: {
        palette: 'warm_neutral',
        lighting: 'golden_hour',
        density: 'minimal',
        style_era: 'japandi'
      },
      pins: [],
      cluster_summary: []
    },
    vibe_report: {
      summary: 'Calm Japandi interiors with oak, linen, and soft natural light.'
    },
    creative_spec: {
      overall_mood: 'Warm Japandi calm',
      room_sequence: ['living_room_1'],
      negative_prompt: 'no people, no clutter'
    },
    floor_plan: {
      rooms: [
        {
          room_id: 'living_room_1',
          name: 'living room',
          measured_dimensions: { width: 12, length: 16 },
          measured_unit: 'ft'
        }
      ]
    },
    room_generation_jobs: [
      {
        room_id: 'living_room_1',
        room_name: 'living room',
        room_type: 'living_room',
        sequence_index: 0,
        dalle: {
          prompt: 'Photorealistic interior photograph of a 12 by 16 ft living room.'
        },
        video_generation: {
          provider: 'fal',
          model: 'fal-ai/kling-video/v3/pro/image-to-video',
          prompt: 'Slow cinematic move through a calm Japandi living room.',
          camera_motion: 'slow_dolly',
          duration_seconds: 5,
          aspect_ratio: '16:9'
        },
        staging: {
          lighting_instruction: 'golden natural light through south-facing windows',
          must_include: ['cream linen sofa'],
          must_avoid: ['visible brand logos']
        },
        quality_gate: {
          max_video_attempts: 2
        }
      }
    ]
  };
}

function samplePayload() {
  return {
    floor_plan_url: 'file:///tmp/floor.png',
    floor_plan_metadata: {},
    floor_plan_measurements: {},
    pinterest_board_url: 'https://www.pinterest.com/example/board/',
    brief: 'Warm family condo',
    objects: [],
    platform: 'all',
    timestamp: '2026-05-09T12:00:00.000Z',
    session_id: 'session_1'
  };
}

function sampleTwoRoomHandoff() {
  return {
    ...sampleHandoff(),
    creative_spec: {
      ...sampleHandoff().creative_spec,
      room_sequence: ['living_room_1', 'bedroom_1']
    },
    floor_plan: {
      rooms: [
        {
          room_id: 'living_room_1',
          name: 'living room',
          measured_dimensions: { width: 12, length: 16 },
          measured_unit: 'ft'
        },
        {
          room_id: 'bedroom_1',
          name: 'bedroom',
          measured_dimensions: { width: 11, length: 13 },
          measured_unit: 'ft'
        }
      ]
    },
    room_generation_jobs: [
      sampleHandoff().room_generation_jobs[0],
      {
        room_id: 'bedroom_1',
        room_name: 'bedroom',
        room_type: 'bedroom',
        sequence_index: 1,
        dalle: {
          prompt: 'Photorealistic interior photograph of an 11 by 13 ft bedroom.'
        },
        video_generation: {
          provider: 'fal',
          model: 'fal-ai/kling-video/v3/pro/image-to-video',
          prompt: 'Slow cinematic move through a calm Japandi bedroom.',
          camera_motion: 'static_zoom',
          duration_seconds: 5,
          aspect_ratio: '16:9'
        },
        staging: {
          lighting_instruction: 'soft daylight through east-facing window',
          must_include: ['oak nightstand'],
          must_avoid: ['visible brand logos']
        },
        quality_gate: {
          max_video_attempts: 2
        }
      }
    ]
  };
}

test('loads AutoHDR skill restored from stash', async () => {
  const skill = await loadAutohdrSkill(process.cwd());
  assert.match(skill.skillText, /AutoHDR Fal Flow/);
  assert.match(skill.promptsText, /Motion prompt bank/);
  assert.equal(skill.version.length, 64);
});

test('creative agent builds still and video plans from Layer 3 plus AutoHDR rules', async () => {
  const agent = await createCreativeAgent({ rootDir: process.cwd() });
  const handoff = sampleHandoff();
  const roomJob = handoff.room_generation_jobs[0];

  const stillPlan = agent.buildStillPlan({ handoff, roomJob });
  assert.equal(stillPlan.model, 'fal-ai/nano-banana-2');
  assert.match(stillPlan.prompt, /12 by 16 ft living room/);
  assert.match(stillPlan.prompt, /visible-light-source logic/);
  assert.match(stillPlan.negative_prompt, /warped architecture/);

  const videoPlan = agent.buildVideoPlan({ handoff, roomJob, sourceStillUrl: 'https://cdn.example.com/still.png' });
  assert.equal(videoPlan.model, 'bytedance/seedance-2.0/image-to-video');
  assert.equal(videoPlan.params.image_url, 'https://cdn.example.com/still.png');
  assert.match(videoPlan.prompt, /slow and smooth dolly/);
  assert.match(videoPlan.prompt, /12 by 16 ft living room/);
  assert.match(videoPlan.negative_prompt, /layout drift/);
});

test('creative agent injects selected Pinterest references into still retries', async () => {
  const agent = await createCreativeAgent({ rootDir: process.cwd() });
  const handoff = sampleHandoff();
  handoff.pinterest_intelligence.pins = [
    {
      pin_id: 'pin_1',
      image_url: 'https://cdn.example.com/pin-1.jpg',
      title: 'Warm oak living room',
      description: 'Rounded sofa and linen drapes',
      cluster_label: 'japandi'
    }
  ];

  const stillPlan = agent.buildStillPlan({
    handoff,
    roomJob: handoff.room_generation_jobs[0],
    failureContext: { reference_pin_ids: ['pin_1'] }
  });

  assert.match(stillPlan.prompt, /selected Pinterest references/);
  assert.match(stillPlan.prompt, /Warm oak living room/);
});

test('genmedia adapter cache hit skips command runner', async () => {
  const cacheDir = await tempCacheDir();
  let calls = 0;
  const adapter = createGenmediaAdapter({
    cacheDir,
    commandRunner: async (args) => {
      calls += 1;
      const downloadArg = args.find((arg) => arg.startsWith('--download='));
      const template = downloadArg.slice('--download='.length);
      await writeFile(template.replace('{index}', '0').replace('{ext}', 'png'), 'image');
      return { stdout: JSON.stringify({ images: [{ url: 'https://cdn.example.com/still.png' }] }), stderr: '' };
    }
  });

  const request = {
    endpointId: 'fal-ai/nano-banana-2',
    params: { prompt: 'living room' },
    skillVersion: 'skill'
  };
  const first = await adapter.executeCached(request);
  const second = await adapter.executeCached(request);

  assert.equal(first.cache_hit, false);
  assert.equal(second.cache_hit, true);
  assert.equal(calls, 1);
});

test('genmedia adapter reuses cached result json even without downloaded artifact files', async () => {
  const cacheDir = await tempCacheDir();
  let calls = 0;
  const adapter = createGenmediaAdapter({
    cacheDir,
    commandRunner: async () => {
      calls += 1;
      return {
        stdout: JSON.stringify({
          status: 'completed',
          result: { images: [{ url: 'https://cdn.example.com/still.png' }] }
        }),
        stderr: ''
      };
    }
  });

  const request = {
    endpointId: 'fal-ai/nano-banana-2',
    params: { prompt: 'living room' },
    skillVersion: 'skill'
  };
  const first = await adapter.executeCached(request);
  const second = await adapter.executeCached(request);

  assert.equal(first.cache_hit, false);
  assert.equal(first.path, null);
  assert.equal(second.cache_hit, true);
  assert.equal(second.url, 'https://cdn.example.com/still.png');
  assert.equal(calls, 1);
});

test('eval routing sends geometry failures to still retry and motion failures to video retry', () => {
  assert.equal(routeEvalDecision({
    decision: 'retry',
    overall: 5,
    failure_classes: ['geometry_warp']
  }), 'retry_still');
  assert.equal(routeEvalDecision({
    decision: 'retry',
    overall: 5,
    failure_classes: ['motion_unstable']
  }), 'retry_video');
});

test('eval agent can use OpenAI vision for still validation', async () => {
  let requestBody;
  const agent = createEvalAgent({
    openAiApiKey: 'key',
    openAiEvalModel: 'eval-model',
    fetchImpl: async (_url, request) => {
      requestBody = JSON.parse(request.body);
      return {
        ok: true,
        async json() {
          return {
            output_text: JSON.stringify({
              decision: 'pass',
              scores: {
                style_match: 8,
                room_correctness: 8,
                architecture_stability: 8,
                lighting_realism: 8,
                object_completeness: 8,
                motion_quality: 8,
                overall: 8
              },
              overall: 8,
              failure_classes: [],
              message: 'Still passes.'
            })
          };
        }
      };
    }
  });

  const result = await agent.evaluateStill({
    artifact: { url: 'https://cdn.example.com/still.png' },
    roomJob: sampleHandoff().room_generation_jobs[0]
  });

  assert.equal(requestBody.model, 'eval-model');
  assert.equal(requestBody.input[0].content[1].type, 'input_image');
  assert.equal(result.decision, 'pass');
});

test('orchestrator blocks video before still approval', async () => {
  const cacheDir = await tempCacheDir();
  const generated = [];
  const runtime = await createAgentRuntime({
    cacheDir,
    evalMode: 'mock',
    autoApproveStills: false,
    findFloorPlan: () => ({ id: '1b1', name: 'Unit A1', imagePath: '/tmp/floor.png' }),
    createLayer1Payload: async () => samplePayload(),
    createLayer2Profile: async () => ({ session_id: 'session_1' }),
    createLayer3Handoff: async () => sampleHandoff(),
    genmedia: {
      executeCached: async ({ endpointId }) => {
        generated.push(endpointId);
        return endpointId.includes('image-to-video')
          ? { cache_hit: false, path: '/tmp/video.mp4', url: 'https://cdn.example.com/video.mp4', result: {} }
          : { cache_hit: false, path: '/tmp/still.png', url: 'https://cdn.example.com/still.png', result: {} };
      },
      upload: async () => ({ url: 'https://cdn.example.com/uploaded.png' })
    }
  });

  const job = await runtime.createJob({
    floor_plan_id: '1b1',
    pinterest_board_url: 'https://www.pinterest.com/example/board/',
    objects: [],
    platform: 'all'
  });

  await waitFor(async () => {
    const current = await runtime.getJob(job.job_id);
    return current.rooms[0]?.state === 'STILL_REVIEW_READY';
  });

  let current = await runtime.getJob(job.job_id);
  assert.equal(current.rooms[0].video_attempt_count, 0);
  assert.equal(generated.some((endpoint) => endpoint.includes('image-to-video')), false);

  await runtime.approveStill(job.job_id, 'living_room_1', { approved: true });
  await waitFor(async () => {
    const next = await runtime.getJob(job.job_id);
    return next.status === 'completed';
  });

  current = await runtime.getJob(job.job_id);
  assert.equal(current.rooms[0].state, 'APPROVED');
  assert.equal(generated.some((endpoint) => endpoint.includes('image-to-video')), true);
});

test('orchestrator fans out stills, waits for mass review, then starts videos after all approvals', async () => {
  const cacheDir = await tempCacheDir();
  const generated = [];
  const runtime = await createAgentRuntime({
    cacheDir,
    evalMode: 'mock',
    autoApproveStills: false,
    findFloorPlan: () => ({ id: '1b1', name: 'Unit A1', imagePath: '/tmp/floor.png' }),
    createLayer1Payload: async () => samplePayload(),
    createLayer2Profile: async () => ({ session_id: 'session_1' }),
    createLayer3Handoff: async () => sampleTwoRoomHandoff(),
    genmedia: {
      executeCached: async ({ endpointId, params }) => {
        generated.push({ endpointId, params });
        return endpointId.includes('image-to-video')
          ? { cache_hit: false, path: `/tmp/${params.prompt.includes('bedroom') ? 'bedroom' : 'living'}-video.mp4`, url: 'https://cdn.example.com/video.mp4', result: {} }
          : { cache_hit: false, path: `/tmp/${params.prompt.includes('bedroom') ? 'bedroom' : 'living'}-still.png`, url: `https://cdn.example.com/${params.prompt.includes('bedroom') ? 'bedroom' : 'living'}.png`, result: {} };
      },
      upload: async () => ({ url: 'https://cdn.example.com/uploaded.png' })
    }
  });

  const job = await runtime.createJob({
    floor_plan_id: '1b1',
    pinterest_board_url: 'https://www.pinterest.com/example/board/',
    objects: [],
    platform: 'all'
  });

  await waitFor(async () => {
    const current = await runtime.getJob(job.job_id);
    return current.rooms.length === 2 && current.rooms.every((room) => room.state === 'STILL_REVIEW_READY');
  });

  let current = await runtime.getJob(job.job_id);
  assert.equal(current.status, 'waiting');
  assert.equal(current.current_state, 'WAITING_FOR_HUMAN_REVIEW');
  assert.equal(generated.filter(({ endpointId }) => !endpointId.includes('image-to-video')).length, 2);
  assert.equal(generated.some(({ endpointId }) => endpointId.includes('image-to-video')), false);

  await runtime.approveStill(job.job_id, 'living_room_1', { approved: true });
  await waitFor(async () => {
    const next = await runtime.getJob(job.job_id);
    return next.rooms.find((room) => room.room_id === 'living_room_1')?.review.still_approved;
  });

  current = await runtime.getJob(job.job_id);
  assert.equal(generated.some(({ endpointId }) => endpointId.includes('image-to-video')), false);
  assert.equal(current.status, 'waiting');

  await runtime.approveStill(job.job_id, 'bedroom_1', { approved: true });
  await waitFor(async () => {
    const next = await runtime.getJob(job.job_id);
    return next.status === 'completed';
  }, 2000);

  current = await runtime.getJob(job.job_id);
  assert.equal(current.rooms.every((room) => room.state === 'APPROVED'), true);
  assert.equal(generated.filter(({ endpointId }) => endpointId.includes('image-to-video')).length, 2);
});

test('POST /api/jobs creates a backend job from frontend payload', async () => {
  const server = createHausServer({
    agentRuntime: {
      createJob: async () => ({
        job_id: 'job_1',
        status: 'queued',
        current_state: 'CREATED'
      })
    }
  });

  const response = await requestServer(server, {
    method: 'POST',
    url: '/api/jobs',
    body: {
      floor_plan_id: '1b1',
      pinterest_board_url: 'https://www.pinterest.com/example/board/',
      objects: [],
      platform: 'all'
    }
  });
  assert.equal(response.status, 202);
  assert.equal(response.body.job_id, 'job_1');
});

test('job manager emits ordered events to subscribers', async () => {
  const manager = createJobManager({ cacheDir: await tempCacheDir() });
  const job = await manager.createJob({ input: {}, floorPlan: null });
  const seen = [];
  const unsubscribe = manager.subscribe(job.job_id, (event) => seen.push(event.type));

  await manager.emitEvent(job.job_id, { type: 'room.still.started', state: 'ROOM_QUEUE_RUNNING', message: 'still' });
  await manager.emitEvent(job.job_id, { type: 'room.still.review_ready', state: 'WAITING_FOR_HUMAN_REVIEW', message: 'review' });
  unsubscribe();

  assert.deepEqual(seen, ['room.still.started', 'room.still.review_ready']);
});

async function waitFor(check, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for condition.');
}

async function requestServer(server, { method, url, body }) {
  const req = Readable.from([Buffer.from(JSON.stringify(body ?? {}))]);
  req.method = method;
  req.url = url;
  req.headers = { host: '127.0.0.1' };

  let status = 200;
  let text = '';
  const res = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    }
  });
  res.writeHead = (nextStatus) => {
    status = nextStatus;
    return res;
  };
  res.end = (chunk) => {
    if (chunk) text += chunk.toString();
    res.emit('finish');
    return res;
  };

  server.emit('request', req, res);
  await new Promise((resolve) => res.on('finish', resolve));
  return { status, body: JSON.parse(text) };
}
