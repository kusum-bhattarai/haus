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

### Wide dolly in

`Wide interior shot with a slow and smooth dolly in. Dramatic shadows crawl and shift across walls, furnishings, and architectural surfaces. Crisp shadow edges in motion. Editorial film style. Neutral white balance, balanced exposure, stable motion. Atmospheric architectural cinematography.`

### Wide slide

`Wide interior shot with slow trucking movement side to side as harsh directional light moves and expands across walls, furnishings, and architectural surfaces. Crisp shadow edges in motion. Camera tracks laterally through scene while light travels. Editorial film style. Neutral white balance, balanced exposure, smooth parallel motion. Atmospheric architectural cinematography.`

### Crane up

`Very slow crane up, time-lapse light progression, camera rises vertically while directional light shifts down through the space, shadows gradually move and lengthen across floors and surfaces, parallax effect, consistent exposure, stable vertical motion, cinematic, photorealistic`

### Slider

`Very slow truck right, time-lapse light progression, camera slides laterally while light shifts across the space, shadows gradually move and lengthen, parallax effect, consistent exposure, stable motion, cinematic, photorealistic`

### Tight truck

`Extreme close-up detail shot with smooth tracking camera following harsh directional light as it grows and spreads across textured surface. Crisp shadow edges crawl and shift in real time. Camera moves with the light's path revealing texture in wood grain, fabric weave, architectural detail. Editorial film style. Neutral white balance, balanced exposure — deep dramatic shadows without underexposure. Shallow depth of field.`

## Image pass prompts

### Editorial interior correction

`Transform this photo into a cinematic editorial image with harsh, directional shadows and crisp light shaping. Correct perspective distortion — ensure vertical lines are truly vertical and horizontal lines are level. Maintain the exact scene composition after correction and preserve the original white balance. Balance overall exposure with intention: raise interior midtones subtly for improved readability and presence, while preserving deep, sculpted shadow structure and strong contrast. The interior should feel brighter and more intentional, not flat or evenly lit — shadows must remain graphic, directional, and editorial. Highlights should stay controlled and natural. Apply intentional, filmic window pulls that reveal deep, rich exterior views — preserve sky density, environmental color, and contrast beyond the glass. Exterior scenes should feel dimensional and weighty, never washed out or pastel. Window highlights must roll off smoothly with realistic falloff; avoid haloing, edge glow, or global tonal compression. Do not flatten contrast or lift blacks globally. Window recovery should feel localized, natural, and optically believable — similar to a well-exposed negative rather than HDR processing. Preserve all architectural and interior details. The scene should feel well-lit yet moody, polished and cinematic. Derive all lighting direction strictly from visible sources in the frame — windows, doors, architectural openings, and practical fixtures (lamps, sconces, pendants). Do not introduce light from walls or areas without logical entry points. Maintain strong tonal separation between interior shadows and exterior highlights; window views should read clear, saturated, and contrast-rich, while the interior retains depth, drama, and editorial punch.`

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
