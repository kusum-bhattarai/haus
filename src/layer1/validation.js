import { randomUUID } from 'node:crypto';

import { DEFAULT_PLATFORM, OBJECT_CATALOG, PLATFORMS } from './constants.js';
import { Layer1ValidationError, validationIssue } from './errors.js';
import {
  createFloorPlanVisionCacheKey,
  extractFloorPlanMeasurementsWithVision
} from './floorPlanVision.js';
import { isRemoteUrl, validateLocalImage, validateRemoteImageUrl } from './image.js';
import { createLayer1Storage } from './storage.js';

export function validatePinterestBoardUrl(value) {
  const issues = [];

  if (typeof value !== 'string' || value.trim() === '') {
    issues.push(validationIssue('pinterest_board_url', 'required', 'Pinterest board URL is required.'));
    return { ok: false, issues };
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    issues.push(validationIssue('pinterest_board_url', 'invalid_url', 'Pinterest board URL must be a valid URL.'));
    return { ok: false, issues };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'pinterest.com' && host !== 'pin.it') {
    issues.push(validationIssue('pinterest_board_url', 'invalid_host', 'Pinterest board URL must point to pinterest.com or pin.it.'));
  }

  if (host === 'pinterest.com') {
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length < 2) {
      issues.push(validationIssue('pinterest_board_url', 'not_board_url', 'Pinterest URL should point to a public board.'));
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    normalized_url: url?.toString()
  };
}

export function validateBrief(value) {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null, issues: [] };
  }

  if (typeof value !== 'string') {
    return {
      ok: false,
      value: null,
      issues: [validationIssue('brief', 'invalid_type', 'Brief must be a string.')]
    };
  }

  const trimmed = value.trim();
  if (trimmed.length > 200) {
    return {
      ok: false,
      value: trimmed,
      issues: [validationIssue('brief', 'too_long', 'Brief must be 200 characters or fewer.')]
    };
  }

  return { ok: true, value: trimmed || null, issues: [] };
}

export function validateObjects(value = []) {
  const issues = [];

  if (!Array.isArray(value)) {
    return {
      ok: false,
      value: [],
      issues: [validationIssue('objects', 'invalid_type', 'Objects must be an array.')]
    };
  }

  if (value.length > 3) {
    issues.push(validationIssue('objects', 'too_many', 'Layer 1 currently accepts up to 3 global objects.'));
  }

  const normalized = [];
  const seen = new Set();
  for (const objectType of value) {
    if (typeof objectType !== 'string') {
      issues.push(validationIssue('objects', 'invalid_item_type', 'Every object must be a string object type.'));
      continue;
    }

    const normalizedObject = objectType.trim();
    if (!OBJECT_CATALOG.has(normalizedObject)) {
      issues.push(validationIssue('objects', 'unknown_object', `Unknown object type: ${objectType}`));
      continue;
    }

    if (!seen.has(normalizedObject)) {
      seen.add(normalizedObject);
      normalized.push(normalizedObject);
    }
  }

  return {
    ok: issues.length === 0,
    value: normalized,
    issues
  };
}

export function validatePlatform(value = DEFAULT_PLATFORM) {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: DEFAULT_PLATFORM, issues: [] };
  }

  if (!PLATFORMS.has(value)) {
    return {
      ok: false,
      value,
      issues: [validationIssue('platform', 'unknown_platform', `Unknown platform: ${value}`)]
    };
  }

  return { ok: true, value, issues: [] };
}

export function validateFloorPlanMeasurements(value = null) {
  if (value === undefined || value === null) {
    return {
      ok: true,
      value: {
        source: 'not_provided',
        unit: null,
        scale: null,
        rooms: [],
        notes: null
      },
      issues: []
    };
  }

  const issues = [];
  if (typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      value: null,
      issues: [validationIssue('floor_plan_measurements', 'invalid_type', 'Floor plan measurements must be an object.')]
    };
  }

  const source = value.source ?? 'user_provided';
  if (!['user_provided', 'ocr', 'ml_parser', 'not_provided'].includes(source)) {
    issues.push(validationIssue('floor_plan_measurements.source', 'invalid_source', 'Measurement source is not supported.'));
  }

  const unit = value.unit ?? null;
  if (unit !== null && !['ft', 'm'].includes(unit)) {
    issues.push(validationIssue('floor_plan_measurements.unit', 'invalid_unit', 'Measurement unit must be ft or m.'));
  }

  const scale = value.scale ?? null;
  if (scale !== null) {
    if (typeof scale !== 'object' || Array.isArray(scale)) {
      issues.push(validationIssue('floor_plan_measurements.scale', 'invalid_type', 'Scale must be an object when provided.'));
    } else {
      if (!isPositiveNumber(scale.pixels) || !isPositiveNumber(scale.units)) {
        issues.push(validationIssue('floor_plan_measurements.scale', 'invalid_value', 'Scale requires positive pixels and units.'));
      }
    }
  }

  if (!Array.isArray(value.rooms)) {
    issues.push(validationIssue('floor_plan_measurements.rooms', 'invalid_type', 'Measured rooms must be an array.'));
  }

  const rooms = Array.isArray(value.rooms)
    ? value.rooms.map((room, index) => normalizeMeasuredRoom(room, index, unit, issues)).filter(Boolean)
    : [];

  return {
    ok: issues.length === 0,
    value: {
      source,
      unit,
      scale: scale === null ? null : {
        pixels: scale.pixels,
        units: scale.units
      },
      rooms,
      notes: typeof value.notes === 'string' && value.notes.trim() !== ''
        ? value.notes.trim()
        : null
    },
    issues
  };
}

function normalizeMeasuredRoom(room, index, defaultUnit, issues) {
  const fieldPrefix = `floor_plan_measurements.rooms[${index}]`;

  if (typeof room !== 'object' || room === null || Array.isArray(room)) {
    issues.push(validationIssue(fieldPrefix, 'invalid_type', 'Measured room must be an object.'));
    return null;
  }

  if (typeof room.name !== 'string' || room.name.trim() === '') {
    issues.push(validationIssue(`${fieldPrefix}.name`, 'required', 'Measured room name is required.'));
  }

  const unit = room.unit ?? defaultUnit;
  if (unit !== null && !['ft', 'm'].includes(unit)) {
    issues.push(validationIssue(`${fieldPrefix}.unit`, 'invalid_unit', 'Measured room unit must be ft or m.'));
  }

  const dimensions = room.dimensions;
  if (typeof dimensions !== 'object' || dimensions === null || Array.isArray(dimensions)) {
    issues.push(validationIssue(`${fieldPrefix}.dimensions`, 'required', 'Measured room dimensions are required.'));
  } else {
    if (!isPositiveNumber(dimensions.width) || !isPositiveNumber(dimensions.length)) {
      issues.push(validationIssue(`${fieldPrefix}.dimensions`, 'invalid_value', 'Measured room width and length must be positive numbers.'));
    }
  }

  return {
    room_id: typeof room.room_id === 'string' && room.room_id.trim() !== '' ? room.room_id.trim() : null,
    name: typeof room.name === 'string' ? room.name.trim() : '',
    dimensions: {
      width: dimensions?.width,
      length: dimensions?.length,
      area: isPositiveNumber(dimensions?.area)
        ? dimensions.area
        : dimensions?.width * dimensions?.length
    },
    unit,
    confidence: typeof room.confidence === 'number' ? Math.max(0, Math.min(1, room.confidence)) : null
  };
}

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export async function createLayer1Payload(input, options = {}) {
  const issues = [];
  const storage = createLayer1Storage(options);
  const floorPlanInput = input?.floor_plan_image ?? input?.floor_plan_url;

  if (typeof floorPlanInput !== 'string' || floorPlanInput.trim() === '') {
    issues.push(validationIssue('floor_plan_image', 'required', 'Floor plan image is required.'));
  }

  const pinterest = validatePinterestBoardUrl(input?.pinterest_board_url);
  issues.push(...pinterest.issues);

  const brief = validateBrief(input?.brief);
  issues.push(...brief.issues);

  const objects = validateObjects(input?.objects ?? []);
  issues.push(...objects.issues);

  const platform = validatePlatform(input?.platform);
  issues.push(...platform.issues);

  const providedMeasurements = validateFloorPlanMeasurements(input?.floor_plan_measurements);
  issues.push(...providedMeasurements.issues);

  let floorPlanUrl = null;
  let floorPlanMetadata = null;
  let localImageForVision = null;
  if (typeof floorPlanInput === 'string' && floorPlanInput.trim() !== '') {
    if (isRemoteUrl(floorPlanInput)) {
      const remoteImage = validateRemoteImageUrl(floorPlanInput);
      issues.push(...remoteImage.issues);
      floorPlanUrl = remoteImage.ok ? floorPlanInput : null;
      floorPlanMetadata = remoteImage.ok ? {
        source: 'remote_url',
        mime_type: null,
        size_bytes: null,
        width_px: null,
        height_px: null,
        sha256: null,
        cache_key: null
      } : null;
    } else {
      const localImage = await validateLocalImage(floorPlanInput);
      issues.push(...localImage.issues);
      if (localImage.ok) {
        const cached = await storage.cacheFloorPlan(localImage.image);
        floorPlanUrl = cached.floor_plan_url;
        localImageForVision = localImage.image;
        floorPlanMetadata = {
          source: 'local_upload',
          mime_type: localImage.image.mime_type,
          size_bytes: localImage.image.size_bytes,
          width_px: localImage.image.dimensions.width_px,
          height_px: localImage.image.dimensions.height_px,
          sha256: localImage.image.sha256,
          cache_key: cached.cache_key
        };
      }
    }
  }

  if (issues.length > 0) {
    throw new Layer1ValidationError('Layer 1 input validation failed.', issues);
  }

  let floorPlanMeasurements = providedMeasurements.value;
  const needsVisionMeasurements = input?.floor_plan_measurements === undefined || input?.floor_plan_measurements === null;
  if (needsVisionMeasurements) {
    const visionCacheKey = createFloorPlanVisionCacheKey(floorPlanUrl, floorPlanMetadata);
    const cachedMeasurements = await storage.readFloorPlanVision(visionCacheKey);

    if (cachedMeasurements) {
      floorPlanMeasurements = cachedMeasurements;
    } else {
      const extractor = options.floorPlanMeasurementExtractor ?? extractFloorPlanMeasurementsWithVision;
      const extractedMeasurements = await extractor({
        floorPlanUrl,
        floorPlanMetadata,
        localImage: localImageForVision,
        apiKey: options.openAiApiKey,
        model: options.openAiVisionModel,
        fetchImpl: options.fetchImpl
      });
      const validatedExtraction = validateFloorPlanMeasurements(extractedMeasurements);
      if (!validatedExtraction.ok) {
        throw new Layer1ValidationError('Layer 1 floor plan dimension extraction returned invalid data.', validatedExtraction.issues);
      }
      floorPlanMeasurements = validatedExtraction.value;
      await storage.writeFloorPlanVision(visionCacheKey, floorPlanMeasurements);
    }
  }

  const payload = {
    floor_plan_url: floorPlanUrl,
    floor_plan_metadata: floorPlanMetadata,
    floor_plan_measurements: floorPlanMeasurements,
    pinterest_board_url: pinterest.normalized_url,
    brief: brief.value,
    objects: objects.value,
    platform: platform.value,
    timestamp: options.now?.() ?? new Date().toISOString(),
    session_id: options.sessionId ?? randomUUID()
  };

  if (options.persist !== false) {
    await storage.writePayload(payload);
  }

  return payload;
}
