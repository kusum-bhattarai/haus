import { DENSITY_TYPES, LIGHTING_TYPES, PALETTES, ROOM_TYPES, STYLE_ERAS } from './constants.js';
import { Layer2ValidationError, validationIssue } from './errors.js';

export function validateLayer2Profile(profile) {
  const issues = [];

  if (profile?.schema_version !== '1.0') {
    issues.push(validationIssue('schema_version', 'invalid', 'Layer 2 profile schema_version must be 1.0.'));
  }

  validateAestheticProfile(profile?.aesthetic_profile, issues);
  validatePins(profile?.pins, issues);
  validateFloorPlan(profile?.floor_plan, issues);

  if (issues.length > 0) {
    throw new Layer2ValidationError('Layer 2 profile validation failed.', issues);
  }

  return profile;
}

export function validateAestheticExtraction(value) {
  const issues = [];
  validateAestheticProfile(value, issues);
  if (!Array.isArray(value?.cluster_summary)) {
    issues.push(validationIssue('cluster_summary', 'invalid_type', 'cluster_summary must be an array.'));
  }

  if (issues.length > 0) {
    throw new Layer2ValidationError('Layer 2 aesthetic extraction returned invalid data.', issues);
  }

  return value;
}

export function validateFloorPlanStructure(value) {
  const issues = [];
  validateFloorPlan(value, issues);

  if (issues.length > 0) {
    throw new Layer2ValidationError('Layer 2 floor plan parser returned invalid data.', issues);
  }

  return value;
}

function validateAestheticProfile(value, issues) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push(validationIssue('aesthetic_profile', 'invalid_type', 'aesthetic_profile must be an object.'));
    return;
  }

  enumIssue(value.palette, PALETTES, 'aesthetic_profile.palette', issues);
  enumIssue(value.lighting, LIGHTING_TYPES, 'aesthetic_profile.lighting', issues);
  enumIssue(value.density, DENSITY_TYPES, 'aesthetic_profile.density', issues);
  enumIssue(value.style_era, STYLE_ERAS, 'aesthetic_profile.style_era', issues);

  if (!Array.isArray(value.dominant_colors) || value.dominant_colors.length < 3) {
    issues.push(validationIssue('aesthetic_profile.dominant_colors', 'invalid', 'At least 3 dominant colors are required.'));
  }

  if (!Array.isArray(value.mood_words) || value.mood_words.length === 0) {
    issues.push(validationIssue('aesthetic_profile.mood_words', 'invalid', 'At least one mood word is required.'));
  }

  if (!Array.isArray(value.pinterest_cluster_labels)) {
    issues.push(validationIssue('aesthetic_profile.pinterest_cluster_labels', 'invalid_type', 'Cluster labels must be an array.'));
  }

  if (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1) {
    issues.push(validationIssue('aesthetic_profile.confidence', 'invalid', 'Confidence must be between 0 and 1.'));
  }
}

function validatePins(value, issues) {
  if (!Array.isArray(value)) {
    issues.push(validationIssue('pins', 'invalid_type', 'pins must be an array.'));
    return;
  }

  if (value.length === 0) {
    issues.push(validationIssue('pins', 'empty', 'At least one pin is required.'));
  }
}

function validateFloorPlan(value, issues) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push(validationIssue('floor_plan', 'invalid_type', 'floor_plan must be an object.'));
    return;
  }

  if (!['open_plan', 'traditional', 'studio'].includes(value.layout_type)) {
    issues.push(validationIssue('floor_plan.layout_type', 'invalid', 'Unknown layout type.'));
  }

  if (!Number.isInteger(value.total_rooms) || value.total_rooms < 1) {
    issues.push(validationIssue('floor_plan.total_rooms', 'invalid', 'total_rooms must be a positive integer.'));
  }

  if (!Array.isArray(value.rooms) || value.rooms.length === 0) {
    issues.push(validationIssue('floor_plan.rooms', 'invalid', 'At least one room is required.'));
    return;
  }

  for (const [index, room] of value.rooms.entries()) {
    const prefix = `floor_plan.rooms[${index}]`;
    if (!room.room_id) issues.push(validationIssue(`${prefix}.room_id`, 'required', 'room_id is required.'));
    enumIssue(room.room_type, ROOM_TYPES, `${prefix}.room_type`, issues);
    if (!['large', 'medium', 'small'].includes(room.area_estimate)) {
      issues.push(validationIssue(`${prefix}.area_estimate`, 'invalid', 'Unknown area estimate.'));
    }
    if (!['high', 'medium', 'low', 'unknown'].includes(room.natural_light)) {
      issues.push(validationIssue(`${prefix}.natural_light`, 'invalid', 'Unknown natural light value.'));
    }
  }
}

function enumIssue(value, allowed, field, issues) {
  if (!allowed.includes(value)) {
    issues.push(validationIssue(field, 'invalid_enum', `${field} must be one of: ${allowed.join(', ')}.`));
  }
}
