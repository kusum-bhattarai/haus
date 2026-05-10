#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvFile } from './src/env.js';
import { createAgentRuntime } from './src/agent/index.js';
import { FLOOR_PLANS, findFloorPlan } from './src/floorPlans.js';
import { createLayer1Payload, Layer1ValidationError } from './src/layer1/index.js';
import { createLayer2Profile, Layer2ValidationError } from './src/layer2/index.js';
import { createLayer3Handoff, Layer3ValidationError, listStyleLibrary } from './src/layer3/index.js';

loadEnvFile();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.join(__dirname, 'frontend');
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

export function createHausServer(options = {}) {
  const runtimePromise = Promise.resolve(options.agentRuntime ?? createAgentRuntime({ rootDir: __dirname }));

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const agentRuntime = await runtimePromise;

      if (req.method === 'GET' && url.pathname === '/api/floor-plans') {
        return sendJson(res, {
          floor_plans: FLOOR_PLANS.map(({ imagePath, ...plan }) => plan)
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/pipeline/layers-1-3') {
        return await handlePipeline(req, res);
      }

      if (req.method === 'GET' && url.pathname === '/api/reel-workspace') {
        return await handleReelWorkspace(res);
      }

      if (req.method === 'GET' && url.pathname === '/api/style-library') {
        return sendJson(res, await listStyleLibrary());
      }

      if (req.method === 'POST' && url.pathname === '/api/jobs') {
        return await handleCreateJob(req, res, agentRuntime);
      }

      const jobEventsMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
      if (req.method === 'GET' && jobEventsMatch) {
        return await handleJobEvents(req, res, agentRuntime, jobEventsMatch[1]);
      }

      const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
      if (req.method === 'GET' && jobMatch) {
        return await handleGetJob(res, agentRuntime, jobMatch[1]);
      }

      const shotManifestMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/shot-manifest$/);
      if (req.method === 'GET' && shotManifestMatch) {
        return await handleArtifactJson(res, agentRuntime, shotManifestMatch[1], 'shot_manifest');
      }

      const timelineMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/timeline$/);
      if (req.method === 'GET' && timelineMatch) {
        return await handleArtifactJson(res, agentRuntime, timelineMatch[1], 'timeline');
      }

      const reviewMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/review-report$/);
      if (req.method === 'GET' && reviewMatch) {
        return await handleArtifactJson(res, agentRuntime, reviewMatch[1], 'review_report');
      }

      const approvalMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/rooms\/([^/]+)\/still-approval$/);
      if (req.method === 'POST' && approvalMatch) {
        return await handleStillApproval(req, res, agentRuntime, approvalMatch[1], approvalMatch[2]);
      }

      const retryMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/rooms\/([^/]+)\/retry$/);
      if (req.method === 'POST' && retryMatch) {
        return await handleRetryRoom(req, res, agentRuntime, retryMatch[1], retryMatch[2]);
      }

      const editMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/edit$/);
      if (req.method === 'POST' && editMatch) {
        return await handleEditRoom(req, res, agentRuntime, editMatch[1]);
      }

      const assetMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/assets\/(.+)$/);
      if (req.method === 'GET' && assetMatch) {
        return serveJobAsset(res, agentRuntime, assetMatch[1], assetMatch[2]);
      }

      const reelAssetMatch = url.pathname.match(/^\/api\/reel-assembler\/([^/]+)\/assets\/(.+)$/);
      if (req.method === 'GET' && reelAssetMatch) {
        return serveReelAsset(res, reelAssetMatch[1], reelAssetMatch[2]);
      }

      if (req.method === 'GET') {
        return serveStatic(url.pathname, res);
      }

      return sendJson(res, { error: 'Not found' }, 404);
    } catch (error) {
      return sendError(res, error);
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createHausServer();
  server.listen(port, host, () => {
    console.log(`Haus demo server running at http://${host}:${port}`);
  });
}

async function handlePipeline(req, res) {
  const body = await readJsonBody(req);
  const floorPlan = findFloorPlan(body.floor_plan_id);

  if (!floorPlan) {
    return sendJson(res, { error: `Unknown floor_plan_id: ${body.floor_plan_id}` }, 400);
  }

  const payload = await createLayer1Payload({
    floor_plan_image: floorPlan.imagePath,
    pinterest_board_url: body.pinterest_board_url,
    brief: body.brief ?? null,
    objects: Array.isArray(body.objects) ? body.objects : [],
    platform: body.platform ?? 'all'
  });

  const profile = await createLayer2Profile(payload);
  const handoff = await createLayer3Handoff(profile);

  return sendJson(res, {
    floor_plan: floorPlanForClient(floorPlan),
    payload,
    profile,
    handoff
  });
}

async function handleCreateJob(req, res, agentRuntime) {
  const body = await readJsonBody(req);
  const job = await agentRuntime.createJob({
    floor_plan_id: body.floor_plan_id,
    pinterest_board_url: body.pinterest_board_url,
    brief: body.brief ?? null,
    objects: Array.isArray(body.objects) ? body.objects : [],
    platform: body.platform ?? 'all'
  });

  return sendJson(res, {
    job_id: job.job_id,
    status: job.status,
    current_state: job.current_state
  }, 202);
}

async function handleGetJob(res, agentRuntime, jobId) {
  const job = await agentRuntime.getJob(jobId);
  return sendJson(res, job);
}

async function handleReelWorkspace(res) {
  const root = path.join(__dirname, '.haus-cache', 'reel-assembler');
  const preferred = 'springmarc-2026-05-10T07-56-25-161Z';
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const folders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const folder = folders.includes(preferred) ? preferred : folders.filter((name) => name.startsWith('springmarc-')).sort().at(-1);
  if (!folder) return sendJson(res, { error: 'No reel assembler output found' }, 404);

  const folderPath = path.join(root, folder);
  const manifest = await readJsonFile(path.join(folderPath, 'manifest.json')).catch(() => ({}));
  const assetUrl = (relativePath) => `/api/reel-assembler/${encodeURIComponent(folder)}/assets/${relativePath}`;
  const priceScenes = (manifest.scenes ?? []).filter((scene) => scene.type === 'price_card');
  const clipScenes = (manifest.scenes ?? []).filter((scene) => scene.type === 'clip');

  return sendJson(res, {
    folder,
    title: 'Springmarc style reels',
    promise: 'Same layout, different Pinterest-led styles, fast enough to keep browsing.',
    final_video_url: assetUrl('final_reel.mp4'),
    floor_plan_reels: priceScenes.map((scene) => ({
      id: scene.id,
      plan_name: scene.plan?.name ?? scene.title,
      layout: scene.plan?.layout,
      sqft: scene.plan?.sqft,
      price: scene.plan?.price,
      thumbnail_url: assetUrl(path.relative(folderPath, scene.card_path)),
      segment_url: assetUrl(`${pad(scene.index)}-${scene.id}.mp4`)
    })),
    style_reels: [
      { id: 'japandi', name: 'Warm Japandi', source: 'Pinterest board', mood: 'Oak, linen, calm daylight', selected: true },
      { id: 'organic-modern', name: 'Organic Modern', source: 'Pin remix', mood: 'Stone, curves, soft contrast' },
      { id: 'resort-minimal', name: 'Resort Minimal', source: 'Pin remix', mood: 'Poolside neutrals, airy luxury' },
      { id: 'family-soft', name: 'Soft Family Calm', source: 'Object-aware', mood: 'Crib, work corner, warm storage' }
    ],
    clip_beats: clipScenes.map((scene) => ({
      id: scene.id,
      title: scene.title,
      subtitle: scene.subtitle,
      segment_url: assetUrl(`${pad(scene.index)}-${scene.id}.mp4`)
    }))
  });
}

async function handleArtifactJson(res, agentRuntime, jobId, key) {
  const job = await agentRuntime.getJob(jobId);
  const value = job.artifacts?.[key];
  if (!value) return sendJson(res, { error: `${key} not found` }, 404);
  return sendJson(res, value);
}

async function handleJobEvents(req, res, agentRuntime, jobId) {
  const job = await agentRuntime.getJob(jobId);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });

  for (const event of job.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  const unsubscribe = agentRuntime.subscribe(jobId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  req.on('close', unsubscribe);
}

async function handleStillApproval(req, res, agentRuntime, jobId, roomId) {
  const body = await readJsonBody(req);
  setImmediate(() => {
    agentRuntime.approveStill(jobId, roomId, {
      approved: Boolean(body.approved),
      note: body.note ?? null
    }).catch((error) => console.error(error));
  });
  return sendJson(res, { ok: true, job_id: jobId, room_id: roomId }, 202);
}

async function handleRetryRoom(req, res, agentRuntime, jobId, roomId) {
  const body = await readJsonBody(req);
  setImmediate(() => {
    agentRuntime.retryRoom(jobId, roomId, {
      target: body.target ?? 'video',
      note: body.note ?? null,
      referencePinIds: Array.isArray(body.reference_pin_ids) ? body.reference_pin_ids : []
    }).catch((error) => console.error(error));
  });
  return sendJson(res, { ok: true, job_id: jobId, room_id: roomId }, 202);
}

async function handleEditRoom(req, res, agentRuntime, jobId) {
  const body = await readJsonBody(req);
  const message = (body.message ?? '').trim();
  if (!message) return sendJson(res, { error: 'message is required' }, 400);
  const roomId = typeof body.room_id === 'string' ? body.room_id : null;
  setImmediate(() => {
    agentRuntime.editRoom(jobId, message, { roomId }).catch((error) => console.error('[edit]', error));
  });
  return sendJson(res, { ok: true, job_id: jobId }, 202);
}

function floorPlanForClient({ imagePath, ...plan }) {
  return plan;
}

async function serveJobAsset(res, agentRuntime, jobId, filename) {
  const job = await agentRuntime.getJob(jobId).catch(() => null);
  if (!job) return sendJson(res, { error: 'Job not found' }, 404);

  const jobsDir = agentRuntime.jobManager.jobsDir;
  const assetPath = path.normalize(path.join(jobsDir, jobId, filename));
  if (!assetPath.startsWith(jobsDir)) return sendJson(res, { error: 'Invalid path' }, 400);

  try {
    const fileStat = await stat(assetPath);
    if (!fileStat.isFile()) return sendJson(res, { error: 'Not found' }, 404);
  } catch {
    return sendJson(res, { error: 'Not found' }, 404);
  }

  res.writeHead(200, { 'Content-Type': contentType(assetPath) });
  createReadStream(assetPath).pipe(res);
}

async function serveReelAsset(res, folder, filename) {
  const root = path.join(__dirname, '.haus-cache', 'reel-assembler');
  const folderPath = path.normalize(path.join(root, decodeURIComponent(folder)));
  const assetPath = path.normalize(path.join(folderPath, filename));
  if (!folderPath.startsWith(root) || !assetPath.startsWith(folderPath)) return sendJson(res, { error: 'Invalid path' }, 400);

  try {
    const fileStat = await stat(assetPath);
    if (!fileStat.isFile()) return sendJson(res, { error: 'Not found' }, 404);
  } catch {
    return sendJson(res, { error: 'Not found' }, 404);
  }

  res.writeHead(200, { 'Content-Type': contentType(assetPath) });
  createReadStream(assetPath).pipe(res);
}

async function serveStatic(requestPath, res) {
  const normalizedPath = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.normalize(path.join(frontendDir, normalizedPath));

  if (!filePath.startsWith(frontendDir)) {
    return sendJson(res, { error: 'Invalid path' }, 400);
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return sendJson(res, { error: 'Not found' }, 404);
    }
  } catch {
    return sendJson(res, { error: 'Not found' }, 404);
  }

  res.writeHead(200, { 'Content-Type': contentType(filePath) });
  createReadStream(filePath).pipe(res);
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.js') return 'text/javascript; charset=utf-8';
  if (extension === '.png') return 'image/png';
  if (extension === '.svg') return 'image/svg+xml; charset=utf-8';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.mp4') return 'video/mp4';
  if (extension === '.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function pad(value) {
  return String(value).padStart(2, '0');
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function sendJson(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

function sendError(res, error) {
  const status = error instanceof Layer1ValidationError ||
    error instanceof Layer2ValidationError ||
    error instanceof Layer3ValidationError
    ? 400
    : 500;

  sendJson(res, {
    error: error.message,
    details: error.details ?? []
  }, status);
}
