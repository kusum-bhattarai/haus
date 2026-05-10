import { randomUUID } from 'node:crypto';

import {
  CAMERA_MOTION_BY_ROOM_TYPE,
  DEFAULT_NEGATIVE_PROMPT,
  LUXURY_CAMERA_MOTION_BY_ROOM_TYPE,
  OBJECT_LABELS,
  OBJECT_ROOM_PREFERENCES,
  ROOM_SIGHTLINES,
  DEFAULT_FAL_VIDEO_MODEL
} from './constants.js';

export function buildLayer3Handoff(profile, creativePlan, options = {}) {
  const roomSequence = createRoomSequence(profile.floor_plan.rooms, creativePlan.room_plans);
  const objectSelections = createObjectSelections(profile.source_payload.objects ?? [], profile.floor_plan.rooms);
  const roomPlansById = new Map(creativePlan.room_plans.map((plan) => [plan.room_id, plan]));
  const roomGuidanceById = new Map(
    creativePlan.vibe_report.room_guidance.map((guidance) => [guidance.room_id, guidance])
  );

  const roomGenerationJobs = roomSequence.map((roomId, sequenceIndex) => {
    const room = profile.floor_plan.rooms.find((candidate) => candidate.room_id === roomId);
    const roomPlan = roomPlansById.get(roomId) ?? {};
    const roomGuidance = roomGuidanceById.get(roomId);
    const objectsForRoom = objectSelections.filter((object) => object.room_id === roomId);
    const cameraMotion = roomPlan.camera_motion ?? selectCameraMotion(room, creativePlan);
    const lightingInstruction = roomPlan.lighting_instruction ?? lightingFromProfile(profile, room);
    const mustInclude = uniqueStrings([
      ...(roomPlan.must_include ?? []),
      ...(roomGuidance?.must_include ?? []),
      ...objectsForRoom.map((object) => object.label)
    ]);
    const mustAvoid = uniqueStrings([
      ...(creativePlan.vibe_report.avoid ?? []),
      ...(roomPlan.must_avoid ?? []),
      ...(roomGuidance?.must_avoid ?? []),
      'people',
      'visible brand logos'
    ]);

    return {
      job_id: options.jobIdFactory?.(roomId, sequenceIndex) ?? randomUUID(),
      room_id: room.room_id,
      room_name: room.name,
      room_type: room.room_type,
      sequence_index: sequenceIndex,
      dalle: {
        prompt: buildDallePrompt({
          profile,
          creativePlan,
          room,
          roomPlan,
          lightingInstruction,
          mustInclude,
          mustAvoid
        }),
        size: '1792x1024',
        quality: 'hd',
        style: 'natural',
        expected_aspect_ratio: '16:9'
      },
      video_generation: {
        provider: 'fal',
        model: options.falVideoModel ?? DEFAULT_FAL_VIDEO_MODEL,
        prompt: roomPlan.video_prompt ?? buildVideoPrompt(profile, room, cameraMotion),
        camera_motion: cameraMotion,
        duration_seconds: roomPlan.duration_seconds ?? 5,
        aspect_ratio: '16:9'
      },
      staging: {
        lighting_instruction: lightingInstruction,
        objects_to_include: objectsForRoom,
        must_include: mustInclude,
        must_avoid: mustAvoid
      },
      quality_gate: {
        min_eval_score: options.demoMode ? 6.5 : 7,
        max_video_attempts: options.demoMode ? 2 : 3,
        regenerate_image_if: ['visible_people', 'wrong_room_type', 'major_style_mismatch', 'object_missing']
      }
    };
  });

  addBackgroundConstraints(roomGenerationJobs);

  const handoff = {
    schema_version: '1.0',
    handoff_id: options.handoffId ?? randomUUID(),
    session_id: profile.session_id,
    created_at: options.now?.() ?? new Date().toISOString(),
    status: roomGenerationJobs.length > 0 ? 'ready_for_room_images' : 'blocked',
    source_input: {
      floor_plan_url: profile.source_payload.floor_plan_url,
      floor_plan_metadata: profile.source_payload.floor_plan_metadata,
      floor_plan_measurements: profile.source_payload.floor_plan_measurements,
      pinterest_board_url: profile.source_payload.pinterest_board_url,
      brief: profile.source_payload.brief,
      objects: objectSelections,
      platform: profile.source_payload.platform
    },
    pinterest_intelligence: {
      aesthetic_profile: profile.aesthetic_profile,
      pins: profile.pins,
      cluster_summary: profile.cluster_summary
    },
    floor_plan: {
      layout_type: profile.floor_plan.layout_type,
      total_rooms: profile.floor_plan.total_rooms,
      rooms: profile.floor_plan.rooms
    },
    vibe_report: creativePlan.vibe_report,
    creative_spec: {
      overall_mood: creativePlan.overall_mood,
      room_sequence: roomSequence,
      global_style_notes: creativePlan.global_style_notes,
      negative_prompt: creativePlan.negative_prompt || DEFAULT_NEGATIVE_PROMPT,
      export_formats: exportFormatsForPlatform(profile.source_payload.platform)
    },
    room_generation_jobs: roomGenerationJobs,
    delivery: {
      requested_platforms: requestedPlatforms(profile.source_payload.platform),
      video_formats: exportFormatsForPlatform(profile.source_payload.platform),
      caption_context: {
        property_brief: profile.source_payload.brief,
        aesthetic_summary: creativePlan.vibe_report.summary,
        featured_objects: objectSelections.map((object) => object.label),
        tone: 'luxury_listing'
      },
      mood_board: {
        include_pin_ids: profile.pins.filter((pin) => pin.selected_for_mood_board).slice(0, 9).map((pin) => pin.pin_id),
        include_room_ids: roomSequence,
        annotations: [
          { label: 'Aesthetic', value: creativePlan.vibe_report.aesthetic_name },
          { label: 'Palette', value: profile.aesthetic_profile.palette },
          { label: 'Lighting', value: profile.aesthetic_profile.lighting },
          { label: 'Mood', value: creativePlan.overall_mood }
        ]
      }
    },
    provenance: {
      layer_1_payload_created_at: profile.source_payload.timestamp,
      pinterest_scrape: {
        provider: 'apify',
        item_count: profile.pins.length,
        fallback_used: false,
        fallback_reason: null
      },
      models: {
        aesthetic_extraction: profile.provenance.models.aesthetic_extraction,
        floor_plan_parsing: profile.provenance.models.floor_plan_parsing,
        creative_spec: options.creativeModel
      }
    },
    warnings: [
      ...(profile.warnings ?? []).map((warning) => ({
        code: warning.code,
        message: warning.message,
        severity: warning.severity,
        affected_room_ids: []
      })),
      ...(creativePlan.warnings ?? []).map((message) => ({
        code: 'creative_plan_warning',
        message,
        severity: 'warning',
        affected_room_ids: []
      })),
      ...(creativePlan.vibe_report.warnings ?? []).map((message) => ({
        code: 'vibe_report_warning',
        message,
        severity: 'warning',
        affected_room_ids: []
      }))
    ]
  };

  return handoff;
}

function createRoomSequence(rooms, roomPlans) {
  const plannedRoomIds = new Set(roomPlans.map((plan) => plan.room_id));
  return rooms
    .filter((room) => plannedRoomIds.has(room.room_id))
    .sort((left, right) => left.generation_priority - right.generation_priority)
    .map((room) => room.room_id);
}

function createObjectSelections(objectTypes, rooms) {
  return objectTypes.map((objectType) => {
    const room = selectRoomForObject(objectType, rooms);
    return {
      object_type: objectType,
      room_id: room?.room_id ?? null,
      label: OBJECT_LABELS[objectType] ?? objectType.replaceAll('_', ' ')
    };
  });
}

function selectRoomForObject(objectType, rooms) {
  const preferences = OBJECT_ROOM_PREFERENCES[objectType] ?? [];
  for (const roomType of preferences) {
    const match = rooms.find((room) => room.room_type === roomType);
    if (match) return match;
  }
  return rooms[0] ?? null;
}

function selectCameraMotion(room, creativePlan) {
  const mood = `${creativePlan.overall_mood} ${creativePlan.vibe_report.summary}`.toLowerCase();
  const table = mood.includes('luxury') || mood.includes('cinematic')
    ? LUXURY_CAMERA_MOTION_BY_ROOM_TYPE
    : CAMERA_MOTION_BY_ROOM_TYPE;
  return table[room.room_type] ?? 'slow_dolly';
}

function buildDallePrompt({ profile, creativePlan, room, roomPlan, lightingInstruction, mustInclude, mustAvoid }) {
  const dimensions = room.measured_dimensions && room.measured_unit
    ? `${room.measured_dimensions.width} by ${room.measured_dimensions.length} ${room.measured_unit}`
    : `${room.area_estimate}`;

  return [
    `Photorealistic interior photograph of a ${dimensions} ${room.name}`,
    room.windows ? `${room.windows} windows` : null,
    lightingInstruction,
    `${profile.aesthetic_profile.style_era} aesthetic`,
    `${profile.aesthetic_profile.palette} color palette`,
    `${profile.aesthetic_profile.density} furnishing`,
    creativePlan.vibe_report.summary,
    roomPlan.dalle_scene_details,
    mustInclude.length > 0 ? `must include ${mustInclude.join(', ')}` : null,
    `must avoid ${mustAvoid.join(', ')}`,
    'architectural photography style',
    'Canon 5D',
    '35mm lens',
    'professional staging',
    'high resolution',
    'sharp focus',
    'photo taken for a luxury property listing'
  ].filter(Boolean).join(', ');
}

function buildVideoPrompt(profile, room, cameraMotion) {
  return [
    `Cinematic ${cameraMotion.replaceAll('_', ' ')} through the ${room.name}`,
    `${profile.aesthetic_profile.style_era} interior styling`,
    `${profile.aesthetic_profile.lighting} lighting`,
    `${profile.aesthetic_profile.palette} palette`,
    'smooth realistic camera movement',
    'luxury property video'
  ].join(', ');
}

function lightingFromProfile(profile, room) {
  if (room.natural_light === 'high') {
    return `${profile.aesthetic_profile.lighting} with strong natural light`;
  }
  if (room.natural_light === 'low') {
    return `${profile.aesthetic_profile.lighting} with soft supplemented interior lighting`;
  }
  return `${profile.aesthetic_profile.lighting} balanced interior lighting`;
}

function requestedPlatforms(platform) {
  if (platform === 'all') return ['instagram', 'tiktok', 'listing', 'portfolio'];
  return [platform];
}

function exportFormatsForPlatform(platform) {
  if (platform === 'instagram' || platform === 'tiktok') return ['9:16'];
  if (platform === 'listing' || platform === 'portfolio') return ['16:9'];
  return ['16:9', '9:16', '1:1'];
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim() !== '').map((value) => value.trim()))];
}

function addBackgroundConstraints(roomJobs) {
  const byType = new Map(roomJobs.map((job) => [job.room_type, job]));

  for (const job of roomJobs) {
    const constraints = ROOM_SIGHTLINES
      .filter((sightline) => sightline.from === job.room_type)
      .map((sightline) => {
        const adjacentJob = byType.get(sightline.to);
        if (!adjacentJob) return null;
        const visibleObjects = uniqueStrings([
          ...sightline.shared_objects,
          ...adjacentJob.staging.must_include
        ]);
        return {
          adjacent_room: adjacentJob.room_name,
          adjacent_room_type: sightline.to,
          direction: sightline.direction,
          visible_objects: visibleObjects
        };
      })
      .filter(Boolean);

    if (constraints.length) {
      job.staging.background_constraints = constraints;
    }
  }
}
