import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { buildAnchorConstraintText } from './anchorGenerator.js';

const SKILL_PATH = '.agents/skills/autohdr-fal/SKILL.md';
const PROMPTS_PATH = '.agents/skills/autohdr-fal/references/prompts.md';

const FALLBACK_MOTION_PROMPTS = {
  slow_dolly: 'Wide interior shot with a slow and smooth dolly in. Dramatic shadows crawl and shift across walls, furnishings, and architectural surfaces. Neutral white balance, balanced exposure, stable motion. Atmospheric architectural cinematography.',
  orbital_pan: 'Super smooth camera travels in a slow arc around the main room feature, subject stays centered, parallax remains natural, consistent exposure, stable motion, cinematic, photorealistic.',
  aerial_drift: 'Super smooth camera rises gently through the space in a straight vertical path, revealing the room layout, consistent exposure, stable motion, cinematic, photorealistic.',
  static_zoom: 'Nearly locked-off architectural shot with a subtle slow push, stable vertical lines, natural daylight drift, consistent exposure, cinematic, photorealistic.'
};

const FALLBACK_NEGATIVE = 'blur, distort, low quality, warped architecture, flicker, unstable camera, unrealistic lighting, muddy shadows, layout drift';

// Section names in prompts.md that map to camera motion types.
const MOTION_SECTION_MAP = {
  slow_dolly: ['wide dolly in', 'dolly in'],
  orbital_pan: ['parallax orbit', 'wide slide', 'slider'],
  aerial_drift: ['crane up', 'drone'],
  static_zoom: ['tight truck', 'static']
};

export async function createCreativeAgent(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const skill = await loadAutohdrSkill(rootDir);
  const fastMode = options.fastMode ?? process.env.HAUS_FAST_MODE !== 'false';

  const motionPrompts = parseMotionPrompts(skill.promptsText);
  const autohdrNegative = parseNegativePrompt(skill.promptsText) ?? FALLBACK_NEGATIVE;
  const invariants = parseInvariants(skill.skillText);

  return {
    skill,
    fastMode,

    buildStillPlan({ handoff, roomJob, roomRuntime = null, failureContext = null, anchors = [] }) {
      const priorStill = roomRuntime?.artifacts?.styled_image_url ?? roomRuntime?.artifacts?.styled_image_path;
      const shouldRefine = Boolean(priorStill && failureContext?.failure_classes?.length);

      // Anchors for this room: reference images that shared objects must visually match.
      const anchorUrls = anchors
        .filter((a) => a.url && a.appears_in.includes(roomJob.room_id))
        .map((a) => a.url);
      const hasAnchors = anchorUrls.length > 0;
      const useEditModel = shouldRefine || hasAnchors;

      if (useEditModel) {
        // Image list: prior still (if refining) + anchor references
        const imageUrls = [
          ...(shouldRefine ? [priorStill] : []),
          ...anchorUrls
        ].filter(Boolean);

        const editPrompt = shouldRefine
          ? buildEditPrompt({ handoff, roomJob, failureContext, invariants, anchorText: hasAnchors ? buildAnchorConstraintText(roomJob, anchors) : null })
          : buildAnchoredStillPrompt({ handoff, roomJob, invariants, anchors });

        return {
          kind: 'still_plan',
          strategy: shouldRefine ? 'refine_existing_still' : 'anchor_referenced_still',
          provider: 'fal',
          model: 'fal-ai/gemini-3.1-flash-image-preview/edit',
          prompt: editPrompt,
          negative_prompt: buildNegativePrompt(handoff, autohdrNegative),
          preserve_layout: true,
          skill_version: skill.version,
          fast_mode: fastMode,
          params: {
            image_urls: imageUrls,
            prompt: editPrompt,
            resolution: '2K',
            aspect_ratio: '16:9',
            output_format: 'png',
            num_images: 1
          }
        };
      }

      const prompt = buildStillPrompt({ handoff, roomJob, failureContext, invariants });
      return {
        kind: 'still_plan',
        strategy: 'generate_staged_still',
        provider: 'fal',
        model: stillModel(fastMode),
        prompt,
        negative_prompt: buildNegativePrompt(handoff, autohdrNegative),
        preserve_layout: true,
        skill_version: skill.version,
        fast_mode: fastMode,
        params: stillParams(prompt, fastMode)
      };
    },

    buildImageEditPlan({ handoff, roomJob, sourceImageUrl, failureContext = null }) {
      const prompt = buildEditPrompt({ handoff, roomJob, failureContext, invariants });
      return {
        kind: 'image_edit_plan',
        provider: 'fal',
        model: 'fal-ai/gemini-3.1-flash-image-preview/edit',
        prompt,
        negative_prompt: buildNegativePrompt(handoff, autohdrNegative),
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
      const prompt = buildVideoPrompt({ handoff, roomJob, motion, failureContext, motionPrompts });
      const model = process.env.HAUS_VIDEO_MODEL ?? (fastMode
        ? 'bytedance/seedance-2.0/image-to-video'
        : 'fal-ai/kling-video/v3/pro/image-to-video');
      const isSeedance = model.includes('seedance');

      return {
        kind: 'video_plan',
        provider: 'fal',
        model,
        prompt,
        negative_prompt: buildNegativePrompt(handoff, autohdrNegative),
        camera_motion: motion,
        duration_seconds: Number(process.env.HAUS_VIDEO_DURATION_SECONDS ?? roomJob.video_generation?.duration_seconds ?? 4),
        aspect_ratio: '16:9',
        source_still_url: sourceStillUrl,
        skill_version: skill.version,
        fast_mode: fastMode,
        params: isSeedance
          ? {
              image_url: sourceStillUrl,
              prompt,
              duration: String(Number(process.env.HAUS_VIDEO_DURATION_SECONDS ?? roomJob.video_generation?.duration_seconds ?? 4)),
              aspect_ratio: '16:9',
              resolution: '720p',
              generate_audio: false
            }
          : {
              start_image_url: sourceStillUrl,
              prompt,
              negative_prompt: buildNegativePrompt(handoff, autohdrNegative),
              duration: String(Number(process.env.HAUS_VIDEO_DURATION_SECONDS ?? roomJob.video_generation?.duration_seconds ?? 4)),
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

function buildStillPrompt({ handoff, roomJob, failureContext, invariants = null }) {
  const profile = handoff.pinterest_intelligence?.aesthetic_profile ?? {};
  const vibe = handoff.vibe_report ?? {};
  const staging = roomJob.staging ?? {};
  const retry = retryText(failureContext);
  const references = selectedReferenceText(handoff, failureContext);
  const roomScale = dimensionInstruction(handoff, roomJob);

  const architecturalConstraints = invariants?.length
    ? invariants.join(' ')
    : 'Preserve real architectural scale, straight vertical lines, believable furniture proportions, and visible-light-source logic. No people, no pets, no visible brand logos, no impossible window or wall geometry.';

  const backgroundConstraintText = backgroundConstraints(staging);

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
    architecturalConstraints,
    backgroundConstraintText,
    retry
  ].filter(Boolean).join(' ');
}

function backgroundConstraints(staging) {
  const constraints = staging?.background_constraints ?? [];
  if (!constraints.length) return null;
  return constraints.map((c) =>
    `${c.direction}, the ${c.adjacent_room} is partially visible — it must show exactly: ${c.visible_objects.join(', ')}. These must match the adjacent room clip precisely for cross-room consistency.`
  ).join(' ');
}

function buildAnchoredStillPrompt({ handoff, roomJob, invariants, anchors }) {
  const basePrompt = buildStillPrompt({ handoff, roomJob, failureContext: null, invariants });
  const anchorText = buildAnchorConstraintText(roomJob, anchors);
  return [basePrompt, anchorText].filter(Boolean).join(' ');
}

function buildEditPrompt({ handoff, roomJob, failureContext, invariants = null, anchorText = null }) {
  const roomScale = dimensionInstruction(handoff, roomJob);

  const architecturalConstraints = invariants?.length
    ? invariants.join(' ')
    : 'Correct perspective distortion so verticals are vertical and horizontals are level. Derive lighting strictly from visible windows, doors, and practical fixtures. Keep highlights controlled, shadows sculpted, exposure balanced, and detail sharp.';

  return [
    'Transform this room image into a cinematic editorial real-estate still.',
    'Preserve exact architecture, perspective, walls, windows, door openings, furniture layout, lens realism, and room scale.',
    roomScale,
    roomJob.staging?.lighting_instruction,
    handoff.vibe_report?.summary,
    selectedReferenceText(handoff, failureContext),
    architecturalConstraints,
    anchorText,
    retryText(failureContext)
  ].filter(Boolean).join(' ');
}

function buildVideoPrompt({ handoff, roomJob, motion, failureContext, motionPrompts = null }) {
  const prompts = motionPrompts ?? FALLBACK_MOTION_PROMPTS;
  const roomScale = dimensionInstruction(handoff, roomJob);

  return [
    prompts[motion] ?? prompts.slow_dolly,
    roomJob.video_generation?.prompt,
    `${roomJob.room_name}, ${handoff.creative_spec?.overall_mood}`,
    roomScale,
    'Plausible light drift from visible sources only, consistent exposure, straight architecture, stable walls and windows, premium real-estate cinematography.',
    retryText(failureContext)
  ].filter(Boolean).join(' ');
}

function buildNegativePrompt(handoff, autohdrNeg) {
  return [...new Set([
    handoff.creative_spec?.negative_prompt,
    autohdrNeg
  ].filter(Boolean).join(', ').split(',').map((item) => item.trim()).filter(Boolean))].join(', ');
}

function fallbackMotion(motion, failureContext) {
  const failures = failureContext?.failure_classes ?? [];
  if (failures.includes('motion_unstable') || failures.includes('camera_instability')) return 'static_zoom';
  return motion ?? 'slow_dolly';
}

function retryText(failureContext) {
  const parts = [];
  const failures = (failureContext?.failure_classes ?? []).filter((f) => f !== 'user_edit_request');
  if (failures.length) parts.push(`Previous failure modes to correct: ${failures.join(', ')}.`);
  if (failureContext?.message) parts.push(failureContext.message);
  return parts.length ? parts.join(' ') : null;
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

// Parse the motion prompt bank from prompts.md into the motion type map.
// Falls back gracefully to FALLBACK_MOTION_PROMPTS if parsing fails.
function parseMotionPrompts(promptsText) {
  if (!promptsText) return null;
  try {
    const result = { ...FALLBACK_MOTION_PROMPTS };

    // Extract inline code blocks (backtick-delimited) following each ### heading.
    const sections = promptsText.split(/^###\s+/m).slice(1);
    for (const section of sections) {
      const heading = section.split('\n')[0].trim().toLowerCase();
      const match = section.match(/`([^`]+)`/);
      if (!match) continue;
      const prompt = match[1].trim();

      for (const [motionKey, keywords] of Object.entries(MOTION_SECTION_MAP)) {
        if (keywords.some((kw) => heading.includes(kw))) {
          // Prefer the first match; Kling-tuned prompts appear later and are better.
          result[motionKey] = prompt;
        }
      }
    }
    return result;
  } catch {
    return null;
  }
}

// Extract the negative prompt from the skill's prompts.md.
function parseNegativePrompt(promptsText) {
  if (!promptsText) return null;
  try {
    const match = promptsText.match(/##\s+Negative prompt[\s\S]*?`([^`]+)`/i);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

// Extract required invariants list from SKILL.md to use as constraints in still prompts.
function parseInvariants(skillText) {
  if (!skillText) return null;
  try {
    const section = skillText.match(/##\s+Required invariants([\s\S]*?)(?=^##\s)/m)?.[1] ?? '';
    const lines = section.split('\n')
      .map((l) => l.replace(/^-\s*/, '').trim())
      .filter((l) => l.length > 0);
    return lines.length > 0 ? lines : null;
  } catch {
    return null;
  }
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
