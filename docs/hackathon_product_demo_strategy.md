# Hackathon Product Demo Strategy

## Core Product Flow

Haus should feel like a real property portal experience, not just a generation
script. The demo flow should be:

1. User lands on a mock property portal for a real-feeling property.
   Example: `Springmarc at San Marcos`.
2. User browses floor plans.
   Each floor plan card should include:
   - floor plan image
   - unit name, for example `Unit B2`
   - beds and baths
   - square footage
   - rent range or starting price
   - availability
   - CTA: `Visualize this floor plan`
3. User chooses a floor plan.
4. User enters a Pinterest board URL.
5. User optionally adds:
   - short lifestyle brief
   - personal objects, such as crib, standing desk, bookshelf, yoga mat
6. App shows progress states:
   - Reading floor plan
   - Extracting Pinterest style
   - Building vibe report
   - Generating room scenes
   - Creating video
7. App shows intermediate outputs:
   - structured vibe report
   - color palette
   - mood words
   - generated room images
   - final video
8. Final output page shows:
   - video preview
   - room-by-room stills
   - captions
   - share/download actions
   - mood board summary

## Winning Demo Story

The story should not be "we generate a video." It should be:

> Pinterest turns into a personalized interior style profile. A floor plan turns
> into room-aware staging. Haus combines both to create a cinematic preview of
> what living there could feel like.

The core value proposition:

> Haus personalizes leasing visualization from a renter's own taste.

## Important Demo Ingredients

### Before And After

Show the original floor plan and the final lifestyle video side by side. Judges
should understand the transformation immediately.

### Structured Vibe Report

This is a differentiator. Most demos jump straight to media generation. Haus
should show that it understands the user's taste first.

The vibe report should include:
- aesthetic name
- short summary
- palette rationale
- lighting mood
- materials
- textures
- furniture language
- styling rules
- what to avoid
- room-by-room guidance
- confidence and warnings

### Progress Timeline

Generation takes time. The waiting experience should feel intentional and
trustworthy. Show each layer as it completes.

### Demo Mode

Have cached sample outputs for one property, one floor plan, and one Pinterest
board. External APIs can be slow or fail during live judging, so the demo must
have a reliable path.

### Property Portal Realism

Use real estate language:
- `Unit A1`
- `Studio / 1 Bath`
- `682 sq ft`
- `Starting at $1,890`
- `Available now`
- `Schedule a tour`

This makes the product feel commercially credible.

## fal Contract Update

The pipeline should use fal for video generation, not AutoHDR.

Rename downstream contract fields before Layer 3.5-5 build against them:

- `autohdr` -> `video_generation`
- `autohdr_prompt` -> `video_prompt`
- `approved_video_clips` can remain generic, or become `approved_fal_video_clips`
- `camera_motion` can stay
- add `provider: "fal"`
- add `model` for the selected fal model
- add `aspect_ratio`
- keep `duration_seconds`
- pass the staged room image URL into fal as the source image

Recommended Layer 3.5 job shape:

```typescript
interface RoomGenerationJob {
  job_id: string;
  room_id: string;
  room_name: string;
  room_type: RoomType;
  sequence_index: number;
  dalle: DalleImageSpec;
  video_generation: FalVideoGenerationSpec;
  staging: StagingSpec;
  quality_gate: RoomQualityGate;
}

interface FalVideoGenerationSpec {
  provider: 'fal';
  model: string;
  prompt: string;
  camera_motion: 'slow_dolly' | 'orbital_pan' | 'aerial_drift' | 'static_zoom';
  duration_seconds: number;
  aspect_ratio: '16:9' | '9:16' | '1:1';
}
```

## Frontend Recommendation

Build the actual usable experience as the first screen. Avoid a marketing
landing page for the hackathon demo.

Suggested screens:

1. Property portal / floor plan selection
2. Personalization form
3. Generation progress
4. Vibe report and generated room stills
5. Final video result
6. AI edit agent for post-video room-specific changes

## Post-Video Edit Agent

After the user watches the generated video, they should be able to ask for a
specific change, for example:

> Add a tall whiteboard in the living room.

The interface should then:

1. Identify the affected room.
2. Bring up the current generated room image.
3. Ask the user where the object should go.
4. Let the user click the desired placement area.
5. Regenerate only the affected room image and video segment.
6. Reassemble the final video with cached unchanged segments.

This keeps iteration fast and makes the product feel controllable. The UI should
make it clear that the previous full video is cached and only the changed room
section is being regenerated.

The mock portal should look like a quiet, professional leasing site. It should
not feel like an AI toy. The more real the leasing workflow feels, the easier it
is for judges to imagine the product being used by apartment communities,
leasing teams, and renters.
