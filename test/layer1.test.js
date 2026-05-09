import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  Layer1ValidationError,
  createLayer1Payload,
  extractFloorPlanMeasurementsWithVision
} from '../src/layer1/index.js';

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

async function createTempWorkspace() {
  return mkdtemp(path.join(os.tmpdir(), 'haus-layer1-'));
}

function extractedMeasurements() {
  return {
    source: 'ml_parser',
    unit: 'ft',
    scale: null,
    rooms: [
      {
        room_id: null,
        name: 'Bedroom',
        dimensions: { width: 10, length: 11, area: 110 },
        unit: 'ft',
        confidence: 0.82
      }
    ],
    notes: 'Visible dimensions extracted from floor plan.'
  };
}

test('creates a Layer 1 payload from valid local input and caches the image', async () => {
  const workspace = await createTempWorkspace();
  const floorPlanPath = path.join(workspace, 'floor-plan.png');
  const cacheDir = path.join(workspace, 'cache');
  await writeFile(floorPlanPath, ONE_BY_ONE_PNG);

  const payload = await createLayer1Payload(
    {
      floor_plan_image: floorPlanPath,
      pinterest_board_url: 'https://www.pinterest.com/example/warm-home/',
      brief: 'Warm family condo',
      objects: ['crib', 'bookshelf', 'crib'],
      platform: 'instagram',
      floor_plan_measurements: {
        source: 'user_provided',
        unit: 'ft',
        rooms: [
          {
            name: 'Living Room',
            dimensions: { width: 12, length: 16 },
            confidence: 1
          }
        ]
      }
    },
    {
      cacheDir,
      sessionId: '11111111-1111-4111-8111-111111111111',
      now: () => '2026-05-08T12:00:00.000Z'
    }
  );

  assert.equal(payload.session_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(payload.timestamp, '2026-05-08T12:00:00.000Z');
  assert.equal(payload.pinterest_board_url, 'https://www.pinterest.com/example/warm-home/');
  assert.deepEqual(payload.objects, ['crib', 'bookshelf']);
  assert.equal(payload.platform, 'instagram');
  assert.match(payload.floor_plan_url, /^file:\/\//);
  assert.deepEqual(payload.floor_plan_metadata, {
    source: 'local_upload',
    mime_type: 'image/png',
    size_bytes: ONE_BY_ONE_PNG.length,
    width_px: 1,
    height_px: 1,
    sha256: payload.floor_plan_metadata.sha256,
    cache_key: payload.floor_plan_metadata.sha256
  });
  assert.match(payload.floor_plan_metadata.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(payload.floor_plan_measurements, {
    source: 'user_provided',
    unit: 'ft',
    scale: null,
    rooms: [
      {
        room_id: null,
        name: 'Living Room',
        dimensions: { width: 12, length: 16, area: 192 },
        unit: 'ft',
        confidence: 1
      }
    ],
    notes: null
  });

  const persistedPayload = JSON.parse(
    await readFile(path.join(cacheDir, 'payloads', `${payload.session_id}.json`), 'utf8')
  );
  assert.deepEqual(persistedPayload, payload);
});

test('reuses the same cached image URL for identical local image content', async () => {
  const workspace = await createTempWorkspace();
  const firstPath = path.join(workspace, 'first.png');
  const secondPath = path.join(workspace, 'second.png');
  const cacheDir = path.join(workspace, 'cache');
  await writeFile(firstPath, ONE_BY_ONE_PNG);
  await writeFile(secondPath, ONE_BY_ONE_PNG);

  let extractionCalls = 0;
  const extractor = async () => {
    extractionCalls += 1;
    return extractedMeasurements();
  };

  const first = await createLayer1Payload(
    {
      floor_plan_image: firstPath,
      pinterest_board_url: 'https://www.pinterest.com/example/board/',
      objects: []
    },
    { cacheDir, persist: false, floorPlanMeasurementExtractor: extractor }
  );

  const second = await createLayer1Payload(
    {
      floor_plan_image: secondPath,
      pinterest_board_url: 'https://www.pinterest.com/example/board/',
      objects: []
    },
    { cacheDir, persist: false, floorPlanMeasurementExtractor: extractor }
  );

  assert.equal(first.floor_plan_url, second.floor_plan_url);
  assert.deepEqual(first.floor_plan_measurements, extractedMeasurements());
  assert.deepEqual(second.floor_plan_measurements, extractedMeasurements());
  assert.equal(extractionCalls, 1);
});

test('rejects invalid Pinterest board URLs', async () => {
  const workspace = await createTempWorkspace();
  const floorPlanPath = path.join(workspace, 'floor-plan.png');
  await writeFile(floorPlanPath, ONE_BY_ONE_PNG);

  await assert.rejects(
    createLayer1Payload(
      {
        floor_plan_image: floorPlanPath,
        pinterest_board_url: 'https://example.com/not-pinterest/',
        objects: []
      },
      { cacheDir: path.join(workspace, 'cache'), persist: false }
    ),
    (error) => {
      assert.ok(error instanceof Layer1ValidationError);
      assert.equal(error.details[0].field, 'pinterest_board_url');
      assert.equal(error.details[0].code, 'invalid_host');
      return true;
    }
  );
});

test('rejects unknown objects and overly long briefs', async () => {
  const workspace = await createTempWorkspace();
  const floorPlanPath = path.join(workspace, 'floor-plan.png');
  await writeFile(floorPlanPath, ONE_BY_ONE_PNG);

  await assert.rejects(
    createLayer1Payload(
      {
        floor_plan_image: floorPlanPath,
        pinterest_board_url: 'https://www.pinterest.com/example/board/',
        brief: 'x'.repeat(201),
        objects: ['standing_desk', 'espresso_machine']
      },
      { cacheDir: path.join(workspace, 'cache'), persist: false }
    ),
    (error) => {
      assert.ok(error instanceof Layer1ValidationError);
      assert.deepEqual(
        error.details.map((issue) => issue.code),
        ['too_long', 'unknown_object']
      );
      return true;
    }
  );
});

test('accepts remote floor plan URLs without fetching them', async () => {
  const workspace = await createTempWorkspace();

  const payload = await createLayer1Payload(
    {
      floor_plan_url: 'https://cdn.example.com/floor-plan.jpg',
      pinterest_board_url: 'https://www.pinterest.com/example/board/'
    },
    {
      cacheDir: path.join(workspace, 'cache'),
      persist: false,
      floorPlanMeasurementExtractor: async () => extractedMeasurements()
    }
  );

  assert.equal(payload.floor_plan_url, 'https://cdn.example.com/floor-plan.jpg');
  assert.deepEqual(payload.floor_plan_metadata, {
    source: 'remote_url',
    mime_type: null,
    size_bytes: null,
    width_px: null,
    height_px: null,
    sha256: null,
    cache_key: null
  });
  assert.deepEqual(payload.floor_plan_measurements, extractedMeasurements());
  assert.deepEqual(payload.objects, []);
  assert.equal(payload.platform, 'all');
});

test('fails clearly when vision extraction is required without an API key', async () => {
  const workspace = await createTempWorkspace();
  const floorPlanPath = path.join(workspace, 'floor-plan.png');
  await writeFile(floorPlanPath, ONE_BY_ONE_PNG);

  await assert.rejects(
    createLayer1Payload(
      {
        floor_plan_image: floorPlanPath,
        pinterest_board_url: 'https://www.pinterest.com/example/board/'
      },
      { cacheDir: path.join(workspace, 'cache'), persist: false, openAiApiKey: '' }
    ),
    /OPENAI_API_KEY is required/
  );
});

test('rejects malformed floor plan measurements', async () => {
  const workspace = await createTempWorkspace();
  const floorPlanPath = path.join(workspace, 'floor-plan.png');
  await writeFile(floorPlanPath, ONE_BY_ONE_PNG);

  await assert.rejects(
    createLayer1Payload(
      {
        floor_plan_image: floorPlanPath,
        pinterest_board_url: 'https://www.pinterest.com/example/board/',
        floor_plan_measurements: {
          source: 'user_provided',
          unit: 'yards',
          rooms: [
            {
              name: 'Bedroom',
              dimensions: { width: 0, length: 10 }
            }
          ]
        }
      },
      { cacheDir: path.join(workspace, 'cache'), persist: false }
    ),
    (error) => {
      assert.ok(error instanceof Layer1ValidationError);
      assert.deepEqual(
        error.details.map((issue) => issue.code),
        ['invalid_unit', 'invalid_unit', 'invalid_value']
      );
      return true;
    }
  );
});

test('OpenAI vision extractor sends image input and parses structured output', async () => {
  let requestBody;
  const result = await extractFloorPlanMeasurementsWithVision({
    floorPlanUrl: 'https://cdn.example.com/floor-plan.png',
    apiKey: 'test-key',
    model: 'test-vision-model',
    fetchImpl: async (url, request) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(request.headers.Authorization, 'Bearer test-key');
      requestBody = JSON.parse(request.body);

      return {
        ok: true,
        async json() {
          return {
            output_text: JSON.stringify(extractedMeasurements())
          };
        }
      };
    }
  });

  assert.equal(requestBody.model, 'test-vision-model');
  assert.equal(requestBody.input[0].content[1].type, 'input_image');
  assert.equal(requestBody.input[0].content[1].detail, 'high');
  assert.equal(requestBody.text.format.type, 'json_schema');
  assert.equal(requestBody.text.format.strict, true);
  assert.deepEqual(result, extractedMeasurements());
});
