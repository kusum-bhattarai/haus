import { DEFAULT_CREATIVE_MODEL, DEFAULT_FAL_VIDEO_MODEL } from './constants.js';
import { createCreativePlan } from './creativePlanner.js';
import { layer3CreativePlanCacheKey } from './cacheKeys.js';
import { buildLayer3Handoff } from './handoffBuilder.js';
import { createLayer3Storage } from './storage.js';
import { validateCreativePlan, validateLayer3Handoff } from './validation.js';

export async function createLayer3Handoff(profile, options = {}) {
  const storage = createLayer3Storage(options);
  const creativeModel = options.openAiCreativeModel ?? process.env.OPENAI_CREATIVE_MODEL ?? DEFAULT_CREATIVE_MODEL;
  const falVideoModel = options.falVideoModel ?? process.env.FAL_VIDEO_MODEL ?? DEFAULT_FAL_VIDEO_MODEL;
  const cacheKey = layer3CreativePlanCacheKey(profile, creativeModel);

  let creativePlan = await storage.readCreativePlan(cacheKey);
  if (!creativePlan) {
    const planner = options.creativePlanner ?? createCreativePlan;
    creativePlan = await planner({
      profile,
      model: creativeModel,
      apiKey: options.openAiApiKey,
      fetchImpl: options.fetchImpl
    });
    validateCreativePlan(creativePlan, profile);
    await storage.writeCreativePlan(cacheKey, creativePlan);
  } else {
    validateCreativePlan(creativePlan, profile);
  }

  const handoff = validateLayer3Handoff(buildLayer3Handoff(profile, creativePlan, {
    handoffId: options.handoffId,
    jobIdFactory: options.jobIdFactory,
    now: options.now,
    demoMode: options.demoMode,
    creativeModel,
    falVideoModel
  }));

  if (options.persist !== false) {
    await storage.writeHandoff(profile.session_id, handoff);
  }

  return handoff;
}
