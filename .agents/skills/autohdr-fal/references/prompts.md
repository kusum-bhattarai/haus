# AutoHDR Prompts

## Flow summary

The AutoHDR brief implies this workflow:

1. Start from a normal edited property photo.
2. Use an image model to make it cinematic and editorial.
3. Optionally run a second image pass to push composition, lighting, or mood.
4. Feed that refined image into a video model with a precise camera-move prompt.
5. Evaluate and retry until the clip feels like pro real-estate videography.

## Motion prompt bank

### Dolly in

`Super smooth camera moves forward in straight line through space, cinematic`

### Dolly in timelapse

`Super smooth camera moves forward in straight line through space, time-lapse light progression, shadows gradually move and lengthen, parallax effect, consistent exposure, stable motion, cinematic, photorealistic`

### Dolly out

`Super smooth camera moves backward in straight line revealing space, cinematic`

### Truck left to right

`Super smooth camera glides horizontally from left to right, parallel path, cinematic`

### Truck right to left

`Super smooth camera glides horizontally from right to left, parallel path, cinematic`

### Parallax orbit

`Super smooth camera travels in arc around subject, subject stays centered, cinematic`

### Crane up

`Super smooth camera rises vertically upward, straight vertical path, cinematic`

### Crane down

`Super smooth camera descends vertically downward, straight vertical path, cinematic`

### Hyperlapse orbit

`Super smooth camera travels in arc around subject, subject stays centered, sky hyperlapses naturally in the background, cinematic`

## Kling-tuned examples

### Slider prompt

`Very slow truck right, time-lapse light progression, camera slides laterally while light shifts across the space, shadows gradually move and lengthen, parallax effect, consistent exposure, stable motion, cinematic, photorealistic`

### Wide slide

`Wide interior shot with slow trucking movement side to side as harsh directional light moves and expands across walls, furnishings, and architectural surfaces. Crisp shadow edges in motion. Camera tracks laterally through scene while light travels. Editorial film style. Neutral white balance, balanced exposure, smooth parallel motion. Atmospheric architectural cinematography.`

### Wide dolly in

`Wide interior shot with a slow and smooth dolly in. Dramatic shadows crawl and shift across walls, furnishings, and architectural surfaces. Crisp shadow edges in motion. Editorial film style. Neutral white balance, balanced exposure, stable motion. Atmospheric architectural cinematography.`

### Tight truck

`Tight interior shot with slow trucking movement side to side as harsh directional light moves and expands across textured interior surfaces. Crisp shadow edges in motion. Editorial film style. Neutral white balance, balanced exposure, stable motion.`

## Image pass prompts

### Editorial interior correction

`Transform this photo into a cinematic editorial image with harsh, directional shadows and crisp light shaping. Correct perspective distortion so verticals are vertical and horizontals are level. Maintain the exact scene composition after correction and preserve the original white balance. Raise interior midtones subtly while preserving deep sculpted shadows and strong contrast. Keep highlights controlled and natural. Preserve all architectural and interior details. Derive lighting strictly from visible sources such as windows, doors, and practical fixtures. Do not introduce light from impossible directions.`

### Brighter airy variant

`Transform this photo into a cinematic editorial image with controlled directional shadows. Correct perspective distortion, preserve exact composition, preserve original white balance, and keep the image bright and airy while retaining depth and dimension. Preserve all architectural and interior details. Derive lighting only from visible sources in frame.`

### Detail shot variant

`Generate a 50mm architectural detail shot with sharp edges, clean composition, and preserved building materials. Keep the exact architecture believable and realistic.`

## Negative prompt

Use a compact negative prompt like:

`blur, distort, low quality, warped architecture, flicker, unstable camera, unrealistic lighting, muddy shadows, layout drift`

## Style template shape

Use this JSON shape to make a reusable style:

```json
{
  "style_name": "jt_visuals_ski_house",
  "image_passes": [
    {
      "goal": "editorial correction",
      "prompt": "..."
    },
    {
      "goal": "mood push",
      "prompt": "..."
    }
  ],
  "video_shots": [
    {
      "shot_type": "truck_right",
      "duration_sec": 5,
      "prompt": "..."
    }
  ],
  "constraints": {
    "preserve_architecture": true,
    "preserve_layout": true,
    "visible_light_sources_only": true,
    "stable_motion": true
  },
  "negative_prompt": "..."
}
```
