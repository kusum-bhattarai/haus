#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvFile } from './src/env.js';
import { FLOOR_PLANS, findFloorPlan } from './src/floorPlans.js';
import { createLayer1Payload, Layer1ValidationError } from './src/layer1/index.js';
import { createLayer2Profile, Layer2ValidationError } from './src/layer2/index.js';
import { createLayer3Handoff, Layer3ValidationError } from './src/layer3/index.js';

loadEnvFile();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.join(__dirname, 'frontend');
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/floor-plans') {
      return sendJson(res, {
        floor_plans: FLOOR_PLANS.map(({ imagePath, ...plan }) => plan)
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/pipeline/layers-1-3') {
      return await handlePipeline(req, res);
    }

    if (req.method === 'GET') {
      return serveStatic(url.pathname, res);
    }

    return sendJson(res, { error: 'Not found' }, 404);
  } catch (error) {
    return sendError(res, error);
  }
});

server.listen(port, host, () => {
  console.log(`Haus demo server running at http://${host}:${port}`);
});

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

function floorPlanForClient({ imagePath, ...plan }) {
  return plan;
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
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
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
