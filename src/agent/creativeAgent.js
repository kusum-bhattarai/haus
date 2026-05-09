import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SKILL_PATH = '.agents/skills/autohdr-fal/SKILL.md';
const PROMPTS_PATH = '.agents/skills/autohdr-fal/references/prompts.md';

const MOTION_PROMPTS = {
  slow_dolly: 'Wide interior shot with a slow and smooth dolly in. Dramatic shadows crawl and shift across walls, furnishings, and architectural surfaces. Neutral white balance, balanced exposure, stable motion. Atmospheric architectural cinematography.',
  orbital_pan: 'Super smooth camera travels in a slow arc around the main room feature, subject stays centered, parallax remains natural, consistent exposure, stable motion, cinematic, photorealistic.',
  aerial_drift: 'Super smooth camera rises gently through the space in a straight vertical path, revealing the room layout, consistent exposure, stable motion, cinematic, photorealistic.',
  static_zoom: 'Nearly locked-off architectural shot with a subtle slow push, stable vertical lines, natural daylight drift, consistent exposure, cinematic, photorealistic.'
};

const AUTOHDR_NEGATIVE = 'blur, distort, low quality, warped architecture, flicker, unstable camera, unrealistic lighting, muddy shadows, layout drift';

export async function createCreativeAgent(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const skill = await loadAutohdrSkill(rootDir);
  const fastMode = options.fastMode ?? process.env.HAUS_FAST_MODE !== 'false';

  return {
    skill,
    fastMode,

    buildStillPlan({ handoff, roomJob, roomRuntime = null, failureContext = null }) {
      const prompt = buildStillPrompt({ handoff, roomJob, failureContext });
      const priorStill = roomRuntime?.artifacts?.styled_image_url ?? roomRuntime?.artifacts?.styled_image_path;
      const shouldRefine = Boolean(priorStill && failureContext?.failure_classes?.length);

      return {
        kind: 'still_plan',
        strategy: shouldRefine ? 'refine_existing_still' : 'generate_staged_still',
        provider: 'fal',
        model: shouldRefine ? 'fal-ai/gemini-3.1-flash-image-preview/edit' : stillModel(fastMode),
        prompt,
        negative_prompt: buildNegativePrompt(handoff),
        preserve_layout: true,
        skill_version: skill.version,
        fast_mode: fastMode,
        params: shouldRefine
          ? {
              image_urls: [priorStill],
              prompt: buildEditPrompt({ handoff, roomJob, failureContext }),
              resolution: '2K',
              aspect_ratio: '16:9',
              output_format: 'png',
              num_images: 1
            }
          : stillParams(prompt, fastMode)
      };
    },

    buildImageEditPlan({ handoff, roomJob, sourceImageUrl, failureContext = null }) {
      const prompt = buildEditPrompt({ handoff, roomJob, failureContext });
      return {
        kind: 'image_edit_plan',
        provider: 'fal',
        model: 'fal-ai/gemini-3.1-flash-image-preview/edit',
        prompt,
        negative_prompt: buildNegativePrompt(handoff),
        preserve_layout: true,
        skill_version: skill.version,
        fast_mode: fastMode,
        params: {
          image_urls: [sourceImageUrl],
          prompt,
          resolution: '2K',
          aspect_ratio: '16:9',
          output_format: 'png',
          num_images: 1
        }
      };
    },

    buildVideoPlan({ handoff, roomJob, sourceStillUrl, failureContext = null }) {
      const motion = fallbackMotion(roomJob.video_generation?.camera_motion, failureContext);
      const prompt = buildVideoPrompt({ handoff, roomJob, motion, failureContext });
      const model = process.env.HAUS_VIDEO_MODEL ?? (fastMode
        ? 'bytedance/seedance-2.0/image-to-video'
        : 'fal-ai/kling-video/v3/pro/image-to-video');
      const isSeedance = model.includes('seedance');

      return {
        kind: 'video_plan',
        provider: 'fal',
        model,
        prompt,
        negative_prompt: buildNegativePrompt(handoff),
        camera_motion: motion,
        duration_seconds: roomJob.video_generation?.duration_seconds ?? 5,
        aspect_ratio: '16:9',
        source_still_url: sourceStillUrl,
        skill_version: skill.version,
        fast_mode: fastMode,
        params: isSeedance
          ? {
              image_url: sourceStillUrl,
              prompt,
              duration: String(roomJob.video_generation?.duration_seconds ?? 5),
              aspect_ratio: '16:9',
              resolution: '720p',
              generate_audio: false
            }
          : {
              start_image_url: sourceStillUrl,
              prompt,
              negative_prompt: buildNegativePrompt(handoff),
              duration: String(roomJob.video_generation?.duration_seconds ?? 5),
              generate_audio: false,
              cfg_scale: 0.5
            }
      };
    },

    buildRetryPatch({ failureContext }) {
      const failureClasses = failureContext?.failure_classes ?? [];
      return {
        reduce_motion: failureClasses.includes('motion_unstable') || failureClasses.includes('camera_instability'),
        restyle_still: failureClasses.includes('geometry_warp') || failureClasses.includes('style_mismatch'),
        lighting_anchor: failureClasses.includes('lighting_drift') || failureClasses.includes('lighting_unrealistic')
      };
    }
  };
}

export async function loadAutohdrSkill(rootDir = process.cwd()) {
  const [skillText, promptsText] = await Promise.all([
    readFile(path.join(rootDir, SKILL_PATH), 'utf8'),
    readFile(path.join(rootDir, PROMPTS_PATH), 'utf8')
  ]);
  const version = createHash('sha256').update(`${skillText}\n${promptsText}`).digest('hex');
  return { skillText, promptsText, version, paths: { skill: SKILL_PATH, prompts: PROMPTS_PATH } };
}

function buildStillPrompt({ handoff, roomJob, failureContext }) {
  const profile = handoff.pinterest_intelligence?.aesthetic_profile ?? {};
  const vibe = handoff.vibe_report ?? {};
  const staging = roomJob.staging ?? {};
  const retry = retryText(failureContext);
  const references = selectedReferenceText(handoff, failureContext);
  const roomScale = dimensionInstruction(handoff, roomJob);

  return [
    roomJob.dalle?.prompt,
    `Create one photorealistic staged ${roomJob.room_name} still for a premium real-estate listing.`,
    roomScale,
    `Use ${profile.style_era} styling, ${profile.palette} palette, ${profile.lighting} lighting, and ${profile.density} furnishing density.`,
    vibe.summary,
    staging.lighting_instruction,
    staging.must_include?.length ? `Must include: ${staging.must_include.join(', ')}.` : null,
    staging.must_avoid?.length ? `Must avoid: ${staging.must_avoid.join(', ')}.` : null,
    references,
    'Preserve real architectural scale, straight vertical lines, believable furniture proportions, and visible-light-source logic.',
    'No people, no pets, no visible brand logos, no impossible window or wall geometry.',
    retry
  ].filter(Boolean).join(' ');
}

function buildEditPrompt({ handoff, roomJob, failureContext }) {
  const roomScale = dimensionInstruction(handoff, roomJob);

  return [
    'Transform this room image into a cinematic editorial real-estate still.',
    'Preserve exact architecture, perspective, walls, windows, door openings, furniture layout, lens realism, and room scale.',
    roomScale,
    roomJob.staging?.lighting_instruction,
    handoff.vibe_report?.summary,
    selectedReferenceText(handoff, failureContext),
    'Correct perspective distortion so verticals are vertical and horizontals are level.',
    'Derive lighting strictly from visible windows, doors, and practical fixtures.',
    'Keep highlights controlled, shadows sculpted, exposure balanced, and detail sharp.',
    retryText(failureContext)
  ].filter(Boolean).join(' ');
}

function buildVideoPrompt({ handoff, roomJob, motion, failureContext }) {
  const roomScale = dimensionInstruction(handoff, roomJob);

  return [
    MOTION_PROMPTS[motion] ?? MOTION_PROMPTS.slow_dolly,
    roomJob.video_generation?.prompt,
    `${roomJob.room_name}, ${handoff.creative_spec?.overall_mood}`,
    roomScale,
    'Plausible light drift from visible sources only, consistent exposure, straight architecture, stable walls and windows, premium real-estate cinematography.',
    retryText(failureContext)
  ].filter(Boolean).join(' ');
}

function buildNegativePrompt(handoff) {
  return [...new Set([
    handoff.creative_spec?.negative_prompt,
    AUTOHDR_NEGATIVE
  ].filter(Boolean).join(', ').split(',').map((item) => item.trim()).filter(Boolean))].join(', ');
}

function fallbackMotion(motion, failureContext) {
  const failures = failureContext?.failure_classes ?? [];
  if (failures.includes('motion_unstable') || failures.includes('camera_instability')) return 'static_zoom';
  return motion ?? 'slow_dolly';
}

function retryText(failureContext) {
  const failures = failureContext?.failure_classes ?? [];
  if (!failures.length) return null;
  return `Previous failure modes to correct: ${failures.join(', ')}.`;
}

function selectedReferenceText(handoff, failureContext) {
  const selectedIds = failureContext?.reference_pin_ids ?? [];
  if (!selectedIds.length) return null;

  const pinsById = new Map((handoff.pinterest_intelligence?.pins ?? []).map((pin) => [pin.pin_id, pin]));
  const refs = selectedIds
    .map((pinId) => pinsById.get(pinId))
    .filter(Boolean)
    .map((pin) => {
      const parts = [pin.title, pin.description, pin.cluster_label, pin.hashtags?.length ? `hashtags: ${pin.hashtags.join(', ')}` : null].filter(Boolean);
      return parts.join(' | ');
    });

  if (!refs.length) return null;
  return `Use styling cues from these selected Pinterest references: ${refs.join(' ; ')}.`;
}

function dimensionInstruction(handoff, roomJob) {
  const room = floorPlanRoom(handoff, roomJob);
  if (!room) return null;

  if (room.measured_dimensions?.width && room.measured_dimensions?.length && room.measured_unit) {
    return `Maintain believable residential scale for a ${room.measured_dimensions.width} by ${room.measured_dimensions.length} ${room.measured_unit} ${room.name}.`;
  }

  if (room.area_estimate) {
    return `Maintain believable residential scale for ${room.name} at roughly ${room.area_estimate}.`;
  }

  return null;
}

function floorPlanRoom(handoff, roomJob) {
  return handoff.floor_plan?.rooms?.find((room) => room.room_id === roomJob.room_id) ?? null;
}

function stillModel(fastMode = false) {
  if (process.env.HAUS_STILL_MODEL === 'fast') return 'fal-ai/nano-banana-2';
  if (process.env.HAUS_STILL_MODEL) return process.env.HAUS_STILL_MODEL;
  return fastMode ? 'fal-ai/nano-banana-2' : 'openai/gpt-image-2';
}

function stillParams(prompt, fastMode = false) {
  if (stillModel(fastMode) === 'fal-ai/nano-banana-2') {
    return {
      prompt,
      aspect_ratio: '16:9',
      resolution: '2K',
      num_images: 1,
      output_format: 'png'
    };
  }

  return {
    prompt,
    image_size: 'landscape_4_3',
    quality: 'high',
    num_images: 1,
    output_format: 'png'
  };
}
