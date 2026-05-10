const MIN_DURATION = 20;
const MAX_DURATION = 40;
const TARGET_DURATION = 30;

export function buildDirectedTimeline(job, shotManifest) {
  const shots = shotManifest.shots ?? [];
  const roomSequence = job.handoff?.creative_spec?.room_sequence ?? [];
  const footageByRoom = new Map();
  const stillByRoom = new Map();
  const droneShots = [];
  const brollShots = [];
  const talkingHeadShots = [];

  for (const shot of shots) {
    if (shot.shot_type === 'drone') droneShots.push(shot);
    else if (shot.shot_type === 'broll') brollShots.push(shot);
    else if (shot.shot_type === 'talking_head') talkingHeadShots.push(shot);
    else if (shot.room_id && shot.kind === 'approved_room_clip' && !footageByRoom.has(shot.room_id)) footageByRoom.set(shot.room_id, shot);
    else if (shot.room_id && !stillByRoom.has(shot.room_id)) stillByRoom.set(shot.room_id, shot);
  }

  const segments = [];
  let cursor = 0;
  let seq = 0;
  const usedRoomIds = new Set();
  const hook = talkingHeadShots[0] ?? droneShots[0] ?? brollShots[0] ?? pickFirstCoverage(roomSequence, footageByRoom, stillByRoom);
  if (hook) {
    const duration = hook.shot_type === 'talking_head' ? 3 : Math.min(hook.duration_seconds ?? 4, 4);
    segments.push(createSegment(hook, {
      sequence_index: seq++,
      output_duration: duration,
      start_time: cursor,
      transition_in: 'hard_cut',
      audio_role: hook.shot_type === 'talking_head' ? 'hook' : 'music',
      caption_text: hook.shot_type === 'talking_head' ? 'See yourself living there.' : 'A property preview, cut with intent.'
    }));
    if (hook.room_id) usedRoomIds.add(hook.room_id);
    cursor += duration;
  }

  for (const roomId of roomSequence) {
    if (usedRoomIds.has(roomId)) continue;
    const shot = footageByRoom.get(roomId) ?? stillByRoom.get(roomId);
    if (!shot) continue;
    const duration = clamp(shot.duration_seconds ?? (shot.media_type === 'image' ? 4 : 5), 3, 6);
    const roomName = shot.room_name ?? roomId.replaceAll('_', ' ');
    segments.push(createSegment(shot, {
      sequence_index: seq++,
      output_duration: duration,
      start_time: cursor,
      transition_in: shot.shot_type === 'footage' ? 'hard_cut' : 'dissolve',
      audio_role: 'narration',
      caption_text: `Move through the ${roomName}.`
    }));
    usedRoomIds.add(roomId);
    cursor += duration;
  }

  const amenity = pickUnique(brollShots, segments);
  if (amenity) {
    const duration = clamp(amenity.duration_seconds ?? 3, 2.5, 4);
    segments.push(createSegment(amenity, {
      sequence_index: seq++,
      output_duration: duration,
      start_time: cursor,
      transition_in: 'dissolve',
      audio_role: 'music',
      caption_text: `Details that sell the feeling.`
    }));
    cursor += duration;
  }

  const scale = pickUnique(droneShots, segments);
  if (scale) {
    const duration = clamp(scale.duration_seconds ?? 4, 3, 5);
    segments.push(createSegment(scale, {
      sequence_index: seq++,
      output_duration: duration,
      start_time: cursor,
      transition_in: 'dissolve',
      audio_role: 'music',
      caption_text: `Property scale, exterior confidence.`
    }));
    cursor += duration;
  }

  const cta = talkingHeadShots[1] ?? talkingHeadShots[0] ?? pickClosingShot(droneShots, brollShots, roomSequence, footageByRoom, stillByRoom);
  if (cta) {
    const duration = cta.shot_type === 'talking_head' ? 3 : Math.min(cta.duration_seconds ?? 4, 4);
    const segment = createSegment(cta, {
      sequence_index: seq++,
      output_duration: duration,
      start_time: cursor,
      transition_in: 'hard_cut',
      audio_role: cta.shot_type === 'talking_head' ? 'cta' : 'music',
      caption_text: 'Book the tour. Keep the vision.'
    });
    if (cta.shot_type !== 'talking_head') segment.motion_preset = 'slow_hold';
    segments.push(segment);
    cursor += duration;
  }

  const normalized = dedupeAdjacent(segments);
  const totalDuration = round(normalized.reduce((sum, segment) => sum + segment.output_duration, 0));

  return {
    target_duration: TARGET_DURATION,
    min_duration: MIN_DURATION,
    max_duration: MAX_DURATION,
    total_duration: totalDuration,
    segments: normalized.map((segment, index) => ({
      ...segment,
      sequence_index: index,
      start_time: round(normalized.slice(0, index).reduce((sum, current) => sum + current.output_duration, 0))
    }))
  };
}

function createSegment(shot, overrides) {
  return {
    asset_id: shot.asset_id,
    path: shot.path ?? null,
    url: shot.url ?? null,
    label: shot.label,
    shot_type: shot.shot_type,
    room_id: shot.room_id ?? null,
    media_type: shot.media_type,
    motion_preset: shot.motion_preset ?? defaultMotion(shot.shot_type),
    source_in: 0,
    source_out: round(overrides.output_duration),
    output_duration: round(overrides.output_duration),
    crop: null,
    zoom_keyframes: shot.media_type === 'image' ? [{ t: 0, scale: 1 }, { t: round(overrides.output_duration), scale: 1.08 }] : [],
    pan_keyframes: [],
    transition_in: overrides.transition_in,
    transition_out: 'cut',
    audio_role: overrides.audio_role,
    caption_text: overrides.caption_text,
    start_time: round(overrides.start_time)
  };
}

function pickFirstCoverage(roomSequence, footageByRoom, stillByRoom) {
  for (const roomId of roomSequence) {
    const shot = footageByRoom.get(roomId) ?? stillByRoom.get(roomId);
    if (shot) return shot;
  }
  return null;
}

function pickClosingShot(droneShots, brollShots, roomSequence, footageByRoom, stillByRoom) {
  return droneShots.at(-1) ?? brollShots.at(-1) ?? pickFirstCoverage([...roomSequence].reverse(), footageByRoom, stillByRoom);
}

function pickUnique(candidates, segments) {
  const used = new Set(segments.map((segment) => segment.asset_id));
  return candidates.find((candidate) => !used.has(candidate.asset_id)) ?? null;
}

function dedupeAdjacent(segments) {
  const result = [];
  for (const segment of segments) {
    const prev = result.at(-1);
    if (prev && prev.shot_type === segment.shot_type && prev.motion_preset === segment.motion_preset) {
      if (segment.motion_preset === 'lateral_pan') segment.motion_preset = 'push_in';
      else if (segment.motion_preset === 'push_in') segment.motion_preset = 'slow_hold';
    }
    result.push(segment);
  }
  return result;
}

function defaultMotion(shotType) {
  if (shotType === 'drone') return 'drone_descend';
  if (shotType === 'broll') return 'orbit';
  if (shotType === 'talking_head') return 'slow_hold';
  return 'lateral_pan';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function round(value) {
  return Number(value.toFixed(3));
}
