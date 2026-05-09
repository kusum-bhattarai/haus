import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createLayer2Profile,
  extractAestheticProfile,
  extractFloorPlanStructure,
  normalizePinterestPins,
  scrapePinterestBoard
} from '../src/layer2/index.js';

function samplePayload() {
  return {
    floor_plan_url: 'https://cdn.example.com/floor-plan.png',
    floor_plan_metadata: {
      source: 'remote_url',
      mime_type: null,
      size_bytes: null,
      width_px: null,
      height_px: null,
      sha256: null,
      cache_key: null
    },
    floor_plan_measurements: {
      source: 'ml_parser',
      unit: 'ft',
      scale: null,
      rooms: [
        {
          room_id: null,
          name: 'Living Room',
          dimensions: { width: 12, length: 16, area: 192 },
          unit: 'ft',
          confidence: 0.9
        }
      ],
      notes: null
    },
    pinterest_board_url: 'https://www.pinterest.com/example/board/',
    brief: 'Warm family condo',
    objects: ['crib'],
    platform: 'all',
    timestamp: '2026-05-08T12:00:00.000Z',
    session_id: '11111111-1111-4111-8111-111111111111'
  };
}

function samplePins() {
  return [
    {
      pin_id: 'pin_001',
      source_url: 'https://www.pinterest.com/pin/1',
      image_url: 'https://cdn.example.com/pin-1.jpg',
      title: 'Warm Japandi living room #japandi',
      description: 'Cream sofa and oak table',
      save_count: 42,
      hashtags: ['japandi'],
      cluster_label: null,
      selected_for_mood_board: true
    }
  ];
}

function sampleAesthetic() {
  return {
    palette: 'warm_neutral',
    lighting: 'golden_hour',
    density: 'minimal',
    style_era: 'japandi',
    dominant_colors: ['#F2E8DA', '#B89B72', '#4A4037'],
    mood_words: ['calm', 'warm', 'natural'],
    pinterest_cluster_labels: ['low oak furniture'],
    cluster_summary: [
      {
        label: 'low oak furniture',
        pin_ids: ['pin_001'],
        visual_notes: 'Low-profile oak tables with cream textiles.',
        weight: 1
      }
    ],
    confidence: 0.88
  };
}

function sampleFloorPlan() {
  return {
    rooms: [
      {
        room_id: 'living_room_1',
        name: 'living room',
        room_type: 'living_room',
        area_estimate: 'large',
        measured_dimensions: { width: 12, length: 16, area: 192 },
        measured_unit: 'ft',
        windows: 'south-facing',
        natural_light: 'high',
        adjoins: ['kitchen_1'],
        generation_priority: 1
      }
    ],
    total_rooms: 1,
    layout_type: 'open_plan',
    confidence: 0.84,
    notes: null
  };
}

async function tempCacheDir() {
  return mkdtemp(path.join(os.tmpdir(), 'haus-layer2-'));
}

test('normalizes Pinterest actor output and sorts by save count', () => {
  const pins = normalizePinterestPins([
    {
      id: '2',
      url: 'https://www.pinterest.com/pin/2',
      imageUrl: 'https://cdn.example.com/2.jpg',
      title: 'Second #warm',
      saveCount: 10
    },
    {
      id: '1',
      url: 'https://www.pinterest.com/pin/1',
      imageUrl: 'https://cdn.example.com/1.jpg',
      title: 'First #oak',
      saveCount: 25
    }
  ]);

  assert.equal(pins[0].pin_id, '1');
  assert.deepEqual(pins[0].hashtags, ['oak']);
  assert.equal(pins[1].pin_id, '2');
});

test('normalizes nested Pinterest story image output', () => {
  const pins = normalizePinterestPins([
    {
      id: '1012465559998684270',
      url: 'https://www.pinterest.com/pin/1012465559998684270/',
      title: 'Japandi Dining Room with Neutral Decor',
      source_url: 'https://www.pinterest.com/tarive22/japandi-interior-design/',
      pin: {
        story: {
          pages_preview: [
            {
              blocks: [
                {
                  image: {
                    images: {
                      '736x': {
                        url: 'https://i.pinimg.com/736x/87/c2/ff/example.jpg'
                      },
                      originals: {
                        url: 'https://i.pinimg.com/originals/87/c2/ff/example.jpg'
                      }
                    }
                  }
                }
              ]
            }
          ]
        }
      }
    }
  ]);

  assert.equal(pins.length, 1);
  assert.equal(pins[0].image_url, 'https://i.pinimg.com/736x/87/c2/ff/example.jpg');
  assert.equal(pins[0].title, 'Japandi Dining Room with Neutral Decor');
});


test('Pinterest scraper calls Apify synchronous dataset endpoint', async () => {
  let requestUrl;
  let requestBody;

  const pins = await scrapePinterestBoard({
    boardUrl: 'https://www.pinterest.com/example/board/',
    limit: 1,
    actorId: 'owner~pinterest-scraper',
    token: 'token',
    fetchImpl: async (url, request) => {
      requestUrl = url.toString();
      requestBody = JSON.parse(request.body);
      return {
        ok: true,
        async json() {
          return [{ id: '1', url: 'https://pin.example/1', imageUrl: 'https://cdn.example.com/1.jpg' }];
        }
      };
    }
  });

  assert.match(requestUrl, /\/v2\/acts\/owner~pinterest-scraper\/run-sync-get-dataset-items/);
  assert.match(requestUrl, /maxTotalChargeUsd=1/);
  assert.equal(requestBody.startUrls[0].url, 'https://www.pinterest.com/example/board/');
  assert.equal(requestBody.maxItems, 1);
  assert.equal(pins.length, 1);
});

test('aesthetic extractor sends pins as image inputs and parses structured output', async () => {
  let requestBody;
  const result = await extractAestheticProfile({
    pins: samplePins(),
    apiKey: 'key',
    model: 'aesthetic-model',
    fetchImpl: async (_url, request) => {
      requestBody = JSON.parse(request.body);
      return {
        ok: true,
        async json() {
          return { output_text: JSON.stringify(sampleAesthetic()) };
        }
      };
    }
  });

  assert.equal(requestBody.model, 'aesthetic-model');
  assert.equal(requestBody.input[0].content[1].type, 'input_image');
  assert.equal(requestBody.input[0].content[1].detail, 'low');
  assert.equal(requestBody.text.format.type, 'json_schema');
  assert.deepEqual(result, sampleAesthetic());
});

test('floor plan parser includes Layer 1 measurements as context', async () => {
  let requestBody;
  const result = await extractFloorPlanStructure({
    payload: samplePayload(),
    apiKey: 'key',
    model: 'floor-model',
    fetchImpl: async (_url, request) => {
      requestBody = JSON.parse(request.body);
      return {
        ok: true,
        async json() {
          return { output_text: JSON.stringify(sampleFloorPlan()) };
        }
      };
    }
  });

  const context = JSON.parse(requestBody.input[0].content[0].text);
  assert.deepEqual(context.floor_plan_measurements, samplePayload().floor_plan_measurements);
  assert.equal(requestBody.input[0].content[1].detail, 'high');
  assert.deepEqual(result, sampleFloorPlan());
});

test('creates and caches a Layer 2 profile', async () => {
  const cacheDir = await tempCacheDir();
  let scrapeCalls = 0;
  let aestheticCalls = 0;
  let floorPlanCalls = 0;

  const options = {
    cacheDir,
    profileId: '22222222-2222-4222-8222-222222222222',
    now: () => '2026-05-08T13:00:00.000Z',
    apifyPinterestActorId: 'owner~pinterest-scraper',
    pinterestScraper: async () => {
      scrapeCalls += 1;
      return samplePins();
    },
    aestheticExtractor: async () => {
      aestheticCalls += 1;
      return sampleAesthetic();
    },
    floorPlanStructureExtractor: async () => {
      floorPlanCalls += 1;
      return sampleFloorPlan();
    }
  };

  const first = await createLayer2Profile(samplePayload(), options);
  const second = await createLayer2Profile(samplePayload(), options);

  assert.equal(first.profile_id, '22222222-2222-4222-8222-222222222222');
  assert.equal(first.aesthetic_profile.style_era, 'japandi');
  assert.equal(first.pins[0].cluster_label, 'low oak furniture');
  assert.deepEqual(first.floor_plan.rooms[0].measured_dimensions, { width: 12, length: 16, area: 192 });
  assert.deepEqual(second, first);
  assert.equal(scrapeCalls, 1);
  assert.equal(aestheticCalls, 1);
  assert.equal(floorPlanCalls, 1);

  const persisted = JSON.parse(
    await readFile(path.join(cacheDir, 'layer2-profiles', `${samplePayload().session_id}.json`), 'utf8')
  );
  assert.deepEqual(persisted, first);
});
