export function reviewTimeline(job, assetBank, timeline) {
  const issues = [];
  const warnings = [...(assetBank.warnings ?? [])];
  const roomSequence = job.handoff?.creative_spec?.room_sequence ?? [];
  const segments = timeline.segments ?? [];
  const coveredRooms = new Set(segments.map((segment) => segment.room_id).filter(Boolean));

  for (const roomId of roomSequence) {
    if (!coveredRooms.has(roomId)) issues.push(`Missing room coverage for ${roomId}.`);
  }

  for (let i = 1; i < segments.length; i += 1) {
    const prev = segments[i - 1];
    const current = segments[i];
    if (prev.shot_type === current.shot_type && prev.motion_preset === current.motion_preset) {
      issues.push(`Repeated adjacent motion pattern at segment ${i}.`);
      break;
    }
  }

  const totalDuration = Number(timeline.total_duration ?? 0);
  if (totalDuration < timeline.min_duration) warnings.push(`Timeline is short at ${totalDuration}s.`);
  if (totalDuration > timeline.max_duration) issues.push(`Timeline exceeds max duration at ${totalDuration}s.`);

  const talkingHeadSegments = segments.filter((segment) => segment.shot_type === 'talking_head');
  if (talkingHeadSegments.length > 1) {
    const avatarIds = new Set(talkingHeadSegments.map((segment) => segment.asset_id));
    if (avatarIds.size > 1) issues.push('Talking-head assets are inconsistent.');
  }

  const intro = segments[0];
  const outro = segments.at(-1);
  if (!intro) issues.push('Timeline is empty.');
  if (!outro) issues.push('Timeline is missing an ending segment.');

  return {
    pass: issues.length === 0,
    issues,
    warnings,
    metrics: {
      total_duration: totalDuration,
      total_segments: segments.length,
      covered_rooms: [...coveredRooms]
    }
  };
}
