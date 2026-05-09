---
name: autohdr-fal
description: Use when the task is to turn real-estate photos into professional-looking fal.ai videos using the AutoHDR-style workflow: start from a source photo, optionally run 1-2 cinematic image-refinement passes, choose a physically plausible camera move, then generate and evaluate a short video clip. Best for interior/exterior property shots, style-template work, movement prompt design, and keeping architecture, lighting logic, and composition consistent.
---

# AutoHDR Fal Flow

Use this skill for real-estate photo-to-video work where the output should feel like pro videography, not generic AI motion.

## Goal

The output should:

- preserve the actual house
- keep architecture and room layout stable
- use realistic camera motion
- use lighting that comes from plausible sources
- feel like a reproducible style, not a one-off prompt

## Core flow

1. Start from an edited property photo.
2. Decide if the photo is already video-ready.
3. If not, do `1-2` image-refinement passes before video.
4. Choose one clear shot intent:
   `dolly in`, `dolly out`, `truck`, `orbit`, `crane`, `detail`
5. Write a motion prompt that describes:
   camera path, speed, lighting change, exposure stability, and mood.
6. Generate a short fal clip first, usually `5s`.
7. Evaluate for drift, warped architecture, fake lighting, and unstable motion.
8. Retry with tighter prompts if the clip fails.

## Decision rule: image pass before video

Do an image-to-image pass first if the source photo is:

- flat or too HDR-looking
- missing directional light
- too wide and visually weak
- compositionally ordinary
- not yet matching the target editorial vibe

Skip image refinement if the source image already has:

- strong composition
- believable light direction
- good verticals
- clean windows and exterior view
- enough detail for motion generation

## AutoHDR pattern

The reference flow is:

1. Start with the normal edited real-estate photo.
2. Prompt an image model to convert it into a more cinematic editorial frame.
3. Optionally prompt the result again for a second refinement pass.
4. Use the final refined image as the basis for video generation.

This means the video prompt should usually operate on an already-styled frame, not on the raw photo.

## Required invariants

Keep these fixed unless the user explicitly wants transformation:

- exact architecture
- room geometry
- furniture layout
- lens realism
- vertical line integrity
- believable scale
- light entering from visible sources only

## Prompt shape

Prompts should be short and structured, not poetic.

Use this order:

1. shot type and speed
2. camera path
3. lighting behavior
4. exposure behavior
5. realism/style tag

Example shape:

`Very slow truck right, camera slides laterally through the space, directional sunlight shifts across surfaces, shadows move gradually, consistent exposure, stable motion, cinematic, photorealistic`

## Negative prompt priorities

Always suppress:

- warped architecture
- flicker
- unstable camera
- muddy exposure
- surreal lighting
- soft detail
- layout drift

## Fal defaults

For first-pass tests:

- duration: `5`
- aspect ratio: `16:9`
- audio: `false`
- one motion idea per clip

Use async submission for expensive models. Save outputs locally and evaluate before expanding to more rooms.

## Evaluation checklist

Reject clips if any of these happen:

- walls, windows, or furniture bend or drift
- motion path changes mid-shot
- light comes from impossible directions
- shadows pulse or flicker
- image becomes muddy or over-HDR
- the result looks like AI instead of real cinematography

## Working modes

Use one of these modes:

- `raw-photo -> video`
  Only when the source frame is already strong.
- `raw-photo -> image pass -> video`
  Default mode.
- `raw-photo -> image pass -> image pass -> video`
  Use when the user wants a stronger style transformation.

## Reference prompts

Read [references/prompts.md](/Users/tarive/haus/haus/.agents/skills/autohdr-fal/references/prompts.md) for:

- motion prompt bank
- cinematic image-pass prompts
- a compact JSON shape for storing reusable style templates
