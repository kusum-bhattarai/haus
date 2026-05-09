import { createHash } from 'node:crypto';

export function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function pinterestCacheKey(boardUrl, limit) {
  return hashJson({ boardUrl, limit });
}

export function aestheticCacheKey(pins, model) {
  return hashJson({
    model,
    pins: pins.map((pin) => ({
      image_url: pin.image_url,
      title: pin.title,
      description: pin.description
    }))
  });
}

export function floorPlanStructureCacheKey(payload, model) {
  return hashJson({
    model,
    floor_plan_url: payload.floor_plan_url,
    floor_plan_metadata: payload.floor_plan_metadata,
    floor_plan_measurements: payload.floor_plan_measurements
  });
}
