import { randomUUID } from 'node:crypto';

import { aestheticCacheKey, floorPlanStructureCacheKey, pinterestCacheKey } from './cacheKeys.js';
import { DEFAULT_AESTHETIC_MODEL, DEFAULT_FLOOR_PLAN_MODEL, DEFAULT_PIN_LIMIT } from './constants.js';
import { extractAestheticProfile } from './aestheticVision.js';
import { extractFloorPlanStructure } from './floorPlanVision.js';
import { scrapePinterestBoard } from './pinterest.js';
import { createLayer2Storage } from './storage.js';
import {
  validateAestheticExtraction,
  validateFloorPlanStructure,
  validateLayer2Profile
} from './validation.js';

export async function createLayer2Profile(payload, options = {}) {
  const storage = createLayer2Storage(options);
  const pinLimit = options.pinLimit ?? DEFAULT_PIN_LIMIT;
  const aestheticModel = options.openAiAestheticModel ?? process.env.OPENAI_AESTHETIC_MODEL ?? DEFAULT_AESTHETIC_MODEL;
  const floorPlanModel = options.openAiFloorPlanModel ?? process.env.OPENAI_FLOOR_PLAN_MODEL ?? DEFAULT_FLOOR_PLAN_MODEL;

  const pins = await getCachedOrCreate({
    storage,
    kind: 'pinterest',
    key: pinterestCacheKey(payload.pinterest_board_url, pinLimit),
    create: async () => {
      const scraper = options.pinterestScraper ?? scrapePinterestBoard;
      return scraper({
        boardUrl: payload.pinterest_board_url,
        limit: pinLimit,
        actorId: options.apifyPinterestActorId,
        token: options.apifyToken,
        fetchImpl: options.fetchImpl
      });
    }
  });

  const aestheticExtraction = validateAestheticExtraction(await getCachedOrCreate({
    storage,
    kind: 'aesthetic',
    key: aestheticCacheKey(pins, aestheticModel),
    create: async () => {
      const extractor = options.aestheticExtractor ?? extractAestheticProfile;
      return extractor({
        pins,
        model: aestheticModel,
        apiKey: options.openAiApiKey,
        fetchImpl: options.fetchImpl
      });
    }
  }));

  const floorPlan = validateFloorPlanStructure(await getCachedOrCreate({
    storage,
    kind: 'floor_plan',
    key: floorPlanStructureCacheKey(payload, floorPlanModel),
    create: async () => {
      const extractor = options.floorPlanStructureExtractor ?? extractFloorPlanStructure;
      return extractor({
        payload,
        model: floorPlanModel,
        apiKey: options.openAiApiKey,
        fetchImpl: options.fetchImpl
      });
    }
  }));

  const pinsWithClusters = assignClusterLabels(pins, aestheticExtraction.cluster_summary);

  const profile = validateLayer2Profile({
    schema_version: '1.0',
    profile_id: options.profileId ?? randomUUID(),
    session_id: payload.session_id,
    created_at: options.now?.() ?? new Date().toISOString(),
    source_payload: payload,
    aesthetic_profile: {
      palette: aestheticExtraction.palette,
      lighting: aestheticExtraction.lighting,
      density: aestheticExtraction.density,
      style_era: aestheticExtraction.style_era,
      dominant_colors: aestheticExtraction.dominant_colors,
      mood_words: aestheticExtraction.mood_words,
      pinterest_cluster_labels: aestheticExtraction.pinterest_cluster_labels,
      confidence: aestheticExtraction.confidence
    },
    pins: pinsWithClusters,
    cluster_summary: aestheticExtraction.cluster_summary,
    floor_plan: floorPlan,
    provenance: {
      pinterest: {
        provider: 'apify',
        requested_limit: pinLimit,
        returned_count: pins.length,
        actor_id: options.apifyPinterestActorId ?? process.env.APIFY_PINTEREST_ACTOR_ID ?? null
      },
      models: {
        aesthetic_extraction: aestheticModel,
        floor_plan_parsing: floorPlanModel
      }
    },
    warnings: []
  });

  if (options.persist !== false) {
    await storage.writeJson('profile', payload.session_id, profile);
  }

  return profile;
}

async function getCachedOrCreate({ storage, kind, key, create }) {
  const cached = await storage.readJson(kind, key);
  if (cached) return cached;

  const value = await create();
  await storage.writeJson(kind, key, value);
  return value;
}

function assignClusterLabels(pins, clusters) {
  const labelsByPinId = new Map();

  for (const cluster of clusters ?? []) {
    for (const pinId of cluster.pin_ids ?? []) {
      labelsByPinId.set(pinId, cluster.label);
    }
  }

  return pins.map((pin, index) => ({
    ...pin,
    cluster_label: labelsByPinId.get(pin.pin_id) ?? pin.cluster_label,
    selected_for_mood_board: pin.selected_for_mood_board || index < 9
  }));
}
