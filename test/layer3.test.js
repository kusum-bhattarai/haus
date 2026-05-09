import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildLayer3Handoff, createCreativePlan, createLayer3Handoff } from '../src/layer3/index.js';

function sampleProfile() {
  return {
    schema_version: '1.0',
    profile_id: '22222222-2222-4222-8222-222222222222',
    session_id: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-05-08T13:00:00.000Z',
    source_payload: {
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
        rooms: [],
        notes: null
      },
      pinterest_board_url: 'https://www.pinterest.com/example/board/',
      brief: 'Warm family condo',
      objects: ['crib', 'bookshelf'],
      platform: 'all',
      timestamp: '2026-05-08T12:00:00.000Z',
      session_id: '11111111-1111-4111-8111-111111111111'
    },
    aesthetic_profile: {
      palette: 'warm_neutral',
      lighting: 'golden_hour',
      density: 'minimal',
      style_era: 'japandi',
      dominant_colors: ['#F2E8DA', '#B89B72', '#4A4037'],
      mood_words: ['calm', 'warm', 'natural'],
      pinterest_cluster_labels: ['low oak furniture'],
      confidence: 0.88
    },
    pins: [
      {
        pin_id: 'pin_001',
        source_url: 'https://www.pinterest.com/pin/1',
        image_url: 'https://cdn.example.com/pin-1.jpg',
        title: 'Warm Japandi living room',
        description: 'Cream sofa and oak table',
        save_count: 42,
        hashtags: ['japandi'],
        cluster_label: 'low oak furniture',
        selected_for_mood_board: true
      }
    ],
    cluster_summary: [
      {
        label: 'low oak furniture',
        pin_ids: ['pin_001'],
        visual_notes: 'Low-profile oak tables with cream textiles.',
        weight: 1
      }
    ],
    floor_plan: {
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
          adjoins: ['bedroom_1'],
          generation_priority: 1
        },
        {
          room_id: 'bedroom_1',
          name: 'bedroom',
          room_type: 'bedroom',
          area_estimate: 'medium',
          measured_dimensions: { width: 10, length: 11, area: 110 },
          measured_unit: 'ft',
          windows: 'east-facing',
          natural_light: 'medium',
          adjoins: ['living_room_1'],
          generation_priority: 2
        }
      ],
      total_rooms: 2,
      layout_type: 'open_plan',
      confidence: 0.84,
      notes: null
    },
    provenance: {
      pinterest: {
        provider: 'apify',
        requested_limit: 20,
        returned_count: 1,
        actor_id: 'owner~pinterest-scraper'
      },
      models: {
        aesthetic_extraction: 'aesthetic-model',
        floor_plan_parsing: 'floor-model'
      }
    },
    warnings: []
  };
}

function sampleCreativePlan() {
  return {
    vibe_report: {
      aesthetic_name: 'Warm Japandi Family Calm',
      summary: 'A calm warm-neutral Japandi direction with oak, linen, and soft golden light.',
      palette_rationale: 'Cream and oak tones support a calm residential feel.',
      lighting_mood: 'Golden natural light softened with warm ambient fill.',
      materials: ['oak', 'linen', 'ceramic'],
      textures: ['woven linen', 'matte plaster'],
      furniture_language: ['low profile', 'clean lines'],
      styling_rules: ['keep surfaces sparse', 'use natural materials'],
      avoid: ['glossy black furniture', 'busy patterns'],
      room_guidance: [
        {
          room_id: 'living_room_1',
          headline: 'Low oak gathering space',
          guidance: 'Anchor the room with cream seating and low oak furniture.',
          must_include: ['cream linen sofa'],
          must_avoid: ['oversized sectional']
        },
        {
          room_id: 'bedroom_1',
          headline: 'Quiet nursery bedroom',
          guidance: 'Keep the crib integrated with soft neutral textiles.',
          must_include: ['soft neutral bedding'],
          must_avoid: ['bright plastic furniture']
        }
      ],
      confidence: 0.9,
      warnings: []
    },
    overall_mood: 'Warm Japandi calm for a luxury family condo.',
    global_style_notes: ['cream linen', 'oak wood', 'minimal decor'],
    negative_prompt: 'no people, no clutter, no visible brand logos',
    room_plans: [
      {
        room_id: 'living_room_1',
        lighting_instruction: 'golden natural light through south-facing windows',
        dalle_scene_details: 'cream linen sofa, low oak coffee table, ceramic vase',
        autohdr_prompt: 'Slow cinematic move through a calm Japandi living room.',
        camera_motion: 'orbital_pan',
        duration_seconds: 5,
        must_include: ['low oak coffee table'],
        must_avoid: ['television as focal point']
      },
      {
        room_id: 'bedroom_1',
        lighting_instruction: 'soft warm morning light',
        dalle_scene_details: 'neutral crib, oak side table, linen curtains',
        autohdr_prompt: 'Gentle push into a warm neutral bedroom.',
        camera_motion: 'slow_dolly',
        duration_seconds: 5,
        must_include: ['neutral crib'],
        must_avoid: ['toy clutter']
      }
    ],
    warnings: []
  };
}

async function tempCacheDir() {
  return mkdtemp(path.join(os.tmpdir(), 'haus-layer3-'));
}

test('creative planner sends structured Layer 2 profile context', async () => {
  let requestBody;
  const result = await createCreativePlan({
    profile: sampleProfile(),
    apiKey: 'key',
    model: 'creative-model',
    fetchImpl: async (_url, request) => {
      requestBody = JSON.parse(request.body);
      return {
        ok: true,
        async json() {
          return { output_text: JSON.stringify(sampleCreativePlan()) };
        }
      };
    }
  });

  const context = JSON.parse(requestBody.input[0].content[0].text);
  assert.equal(requestBody.model, 'creative-model');
  assert.equal(requestBody.text.format.type, 'json_schema');
  assert.equal(context.aesthetic_profile.style_era, 'japandi');
  assert.equal(context.floor_plan.rooms.length, 2);
  assert.deepEqual(result, sampleCreativePlan());
});

test('builds Layer 3 handoff with vibe report and generation jobs', () => {
  const handoff = buildLayer3Handoff(sampleProfile(), sampleCreativePlan(), {
    handoffId: '33333333-3333-4333-8333-333333333333',
    creativeModel: 'creative-model',
    now: () => '2026-05-08T14:00:00.000Z',
    jobIdFactory: (_roomId, index) => `44444444-4444-4444-8444-44444444444${index}`
  });

  assert.equal(handoff.vibe_report.aesthetic_name, 'Warm Japandi Family Calm');
  assert.equal(handoff.status, 'ready_for_room_images');
  assert.deepEqual(handoff.creative_spec.room_sequence, ['living_room_1', 'bedroom_1']);
  assert.equal(handoff.source_input.objects[0].object_type, 'crib');
  assert.equal(handoff.source_input.objects[0].room_id, 'bedroom_1');
  assert.equal(handoff.source_input.objects[1].room_id, 'living_room_1');
  assert.match(handoff.room_generation_jobs[0].dalle.prompt, /12 by 16 ft living room/);
  assert.match(handoff.room_generation_jobs[1].dalle.prompt, /neutral crib/);
  assert.equal(handoff.delivery.video_formats.length, 3);
});

test('creates and caches Layer 3 handoff', async () => {
  const cacheDir = await tempCacheDir();
  let plannerCalls = 0;

  const options = {
    cacheDir,
    handoffId: '33333333-3333-4333-8333-333333333333',
    now: () => '2026-05-08T14:00:00.000Z',
    jobIdFactory: (_roomId, index) => `44444444-4444-4444-8444-44444444444${index}`,
    creativePlanner: async () => {
      plannerCalls += 1;
      return sampleCreativePlan();
    },
    openAiCreativeModel: 'creative-model'
  };

  const first = await createLayer3Handoff(sampleProfile(), options);
  const second = await createLayer3Handoff(sampleProfile(), options);

  assert.deepEqual(second, first);
  assert.equal(plannerCalls, 1);

  const persisted = JSON.parse(
    await readFile(path.join(cacheDir, 'layer3-handoffs', `${sampleProfile().session_id}.json`), 'utf8')
  );
  assert.deepEqual(persisted, first);
});
