import { Layer3ValidationError, validationIssue } from './errors.js';

export function validateCreativePlan(plan, profile) {
  const issues = [];

  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Layer3ValidationError('Layer 3 creative plan must be an object.', [
      validationIssue('creative_plan', 'invalid_type', 'Creative plan must be an object.')
    ]);
  }

  if (!plan.vibe_report?.summary) {
    issues.push(validationIssue('vibe_report.summary', 'required', 'Vibe report summary is required.'));
  }

  if (!Array.isArray(plan.room_plans) || plan.room_plans.length === 0) {
    issues.push(validationIssue('room_plans', 'required', 'At least one room plan is required.'));
  }

  const profileRoomIds = new Set(profile.floor_plan.rooms.map((room) => room.room_id));
  for (const roomPlan of plan.room_plans ?? []) {
    if (!profileRoomIds.has(roomPlan.room_id)) {
      issues.push(validationIssue('room_plans.room_id', 'unknown_room', `Unknown room id: ${roomPlan.room_id}`));
    }
  }

  if (issues.length > 0) {
    throw new Layer3ValidationError('Layer 3 creative plan validation failed.', issues);
  }

  return plan;
}

export function validateLayer3Handoff(handoff) {
  const issues = [];

  if (handoff?.schema_version !== '1.0') {
    issues.push(validationIssue('schema_version', 'invalid', 'Layer 3 handoff schema_version must be 1.0.'));
  }

  if (!handoff?.vibe_report) {
    issues.push(validationIssue('vibe_report', 'required', 'Layer 3 handoff requires vibe_report.'));
  }

  if (!Array.isArray(handoff?.room_generation_jobs) || handoff.room_generation_jobs.length === 0) {
    issues.push(validationIssue('room_generation_jobs', 'required', 'At least one room generation job is required.'));
  }

  if (issues.length > 0) {
    throw new Layer3ValidationError('Layer 3 handoff validation failed.', issues);
  }

  return handoff;
}
