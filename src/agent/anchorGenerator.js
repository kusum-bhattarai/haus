import { ROOM_SIGHTLINES } from '../layer3/constants.js';

export function extractAnchorSpecs(handoff) {
  const roomJobs = handoff.room_generation_jobs ?? [];
  const vibe = handoff.vibe_report ?? {};
  const profile = handoff.pinterest_intelligence?.aesthetic_profile ?? {};
  // Map room_type → first room of that type (lower sequence_index wins)
  const roomsByType = new Map();
  for (const r of [...roomJobs].sort((a, b) => (a.sequence_index ?? 0) - (b.sequence_index ?? 0))) {
    if (!roomsByType.has(r.room_type)) roomsByType.set(r.room_type, r);
  }

  // One anchor per room type that appears in at least one sightline's "to" side
  // and whose room type is actually present in this floor plan.
  const anchorMap = new Map();

  for (const sl of ROOM_SIGHTLINES) {
    const sourceJob = roomsByType.get(sl.to); // the room whose objects need to be consistent
    if (!sourceJob) continue;

    const anchorId = `anchor_${sl.to}`;
    if (anchorMap.has(anchorId)) continue;

    // Build the visible_objects list: sightline shared objects + the source room's must_include
    const visibleObjects = uniqueStrings([
      ...sl.shared_objects,
      ...(sourceJob.staging?.must_include ?? [])
    ]);

    const anchorPrompt = buildAnchorPrompt({
      roomName: sourceJob.room_name,
      visibleObjects,
      vibe,
      profile
    });

    anchorMap.set(anchorId, {
      anchor_id: anchorId,
      room_type: sl.to,
      room_name: sourceJob.room_name,
      visible_objects: visibleObjects,
      prompt: anchorPrompt,
      appears_in: [] // populated below
    });
  }

  // appears_in = the source room itself + every room that has a background constraint pointing to it
  for (const roomJob of roomJobs) {
    // The primary room for this anchor type includes itself
    const selfAnchorId = `anchor_${roomJob.room_type}`;
    if (anchorMap.has(selfAnchorId)) {
      const spec = anchorMap.get(selfAnchorId);
      if (!spec.appears_in.includes(roomJob.room_id)) {
        spec.appears_in.push(roomJob.room_id);
      }
    }

    // Any room that has background constraints pointing to an anchor source
    for (const constraint of (roomJob.staging?.background_constraints ?? [])) {
      const anchorId = `anchor_${constraint.adjacent_room_type}`;
      if (anchorMap.has(anchorId)) {
        const spec = anchorMap.get(anchorId);
        if (!spec.appears_in.includes(roomJob.room_id)) {
          spec.appears_in.push(roomJob.room_id);
        }
      }
    }
  }

  // Only return anchors that appear in at least 2 rooms (otherwise no cross-room consistency problem)
  return [...anchorMap.values()].filter((spec) => spec.appears_in.length >= 2);
}

export async function generateAnchors(anchorSpecs, { genmedia, skillVersion }) {
  if (!anchorSpecs.length) return [];

  const results = await Promise.allSettled(
    anchorSpecs.map((spec) => generateOneAnchor(spec, { genmedia, skillVersion }))
  );

  return results
    .map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      console.warn(`[anchorGenerator] Failed to generate anchor ${anchorSpecs[index].anchor_id}:`, result.reason?.message);
      return null;
    })
    .filter(Boolean);
}

async function generateOneAnchor(spec, { genmedia, skillVersion }) {
  const artifact = await genmedia.executeCached({
    endpointId: 'fal-ai/nano-banana-2',
    params: {
      prompt: spec.prompt,
      aspect_ratio: '16:9',
      resolution: '1K',
      num_images: 1,
      output_format: 'png'
    },
    skillVersion,
    artifactName: spec.anchor_id
  });

  return {
    anchor_id: spec.anchor_id,
    room_type: spec.room_type,
    room_name: spec.room_name,
    visible_objects: spec.visible_objects,
    path: artifact.path,
    url: artifact.url,
    cache_hit: artifact.cache_hit,
    appears_in: spec.appears_in
  };
}

function buildAnchorPrompt({ roomName, visibleObjects, vibe, profile }) {
  return [
    `Photorealistic editorial interior reference photograph of a ${roomName}.`,
    `Focus tightly on: ${visibleObjects.join(', ')}.`,
    `Styled in ${profile.style_era ?? 'contemporary'} aesthetic, ${profile.palette ?? 'neutral'} palette, ${profile.lighting ?? 'soft natural'} lighting.`,
    vibe.summary,
    'This image is a visual consistency reference — every detail of the featured furniture and fixtures must be clearly visible and precisely rendered.',
    'No people. No visible brand logos. Sharp architectural photography. Luxury real estate staging.'
  ].filter(Boolean).join(' ');
}

// Exported for use in creativeAgent prompt building
export function buildAnchorConstraintText(roomJob, anchors) {
  const relevant = anchors.filter((a) => a.appears_in.includes(roomJob.room_id));
  if (!relevant.length) return null;

  const lines = relevant.map((anchor) => {
    const isPrimaryRoom = anchor.room_type === roomJob.room_type;
    if (isPrimaryRoom) {
      return `The ${anchor.visible_objects.join(', ')} in this room must exactly match the style, materials, and form shown in reference image — treat it as the definitive source of truth for these pieces.`;
    }
    const constraint = (roomJob.staging?.background_constraints ?? []).find(
      (c) => c.adjacent_room_type === anchor.room_type
    );
    const direction = constraint?.direction ?? `through the ${anchor.room_name.toLowerCase()} doorway`;
    return `The ${anchor.room_name} visible ${direction} must show exactly the same ${anchor.visible_objects.join(', ')} as in the reference image — do not invent different furniture.`;
  });

  return `VISUAL CONSISTENCY REQUIREMENT (reference image provided): ${lines.join(' ')}`;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim()))];
}
