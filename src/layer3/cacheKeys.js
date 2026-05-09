import { createHash } from 'node:crypto';

export function layer3CreativePlanCacheKey(profile, model) {
  return createHash('sha256').update(JSON.stringify({
    model,
    profile_id: profile.profile_id,
    source_payload: profile.source_payload,
    aesthetic_profile: profile.aesthetic_profile,
    cluster_summary: profile.cluster_summary,
    floor_plan: profile.floor_plan
  })).digest('hex');
}
