# Integrated Layers 1-3

The local demo server connects the frontend to Layers 1-3.

Run:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

## Frontend Flow

1. User chooses one of the real floor plan images:
   - `1b1`: 1 Bedroom / 1 Bath, 689 sq ft
   - `2b2`: 2 Bedroom / 2 Bath, 988 sq ft
   - `3b2`: 3 Bedroom / 2 Bath, 1,250 sq ft
2. User enters a public Pinterest board URL.
3. User optionally enters a lifestyle brief and object preferences.
4. Frontend calls:

```http
POST /api/pipeline/layers-1-3
```

## Backend Flow

The server maps `floor_plan_id` to the local floor plan image and runs:

```text
Layer 1 payload
  -> Layer 2 profile
  -> Layer 3 handoff
```

The response includes:

- selected floor plan metadata
- Layer 1 payload
- Layer 2 Pinterest/floor-plan profile
- Layer 3 vibe report and handoff

## Live Smoke Test

The integrated endpoint was tested with:

```json
{
  "floor_plan_id": "1b1",
  "pinterest_board_url": "https://www.pinterest.com/tarive22/japandi-interior-design/",
  "brief": "Warm calm home for a young renter who works from home.",
  "objects": ["standing_desk", "bookshelf"],
  "platform": "all"
}
```

Result:

```json
{
  "ok": true,
  "pins": 3,
  "vibe": "Warm Japandi Home — Calm Work-From-Home Retreat",
  "jobs": 6,
  "firstVideoProvider": "fal",
  "firstVideoModel": "fal-ai/kling-video/v1.6/pro/image-to-video"
}
```

## Model Defaults

OpenAI defaults are set to `gpt-5-mini` for Layers 1-3 because it supports image
input and Structured Outputs while fitting this pipeline's well-defined
extraction and planning tasks.

```bash
OPENAI_VISION_MODEL=gpt-5-mini
OPENAI_AESTHETIC_MODEL=gpt-5-mini
OPENAI_FLOOR_PLAN_MODEL=gpt-5-mini
OPENAI_CREATIVE_MODEL=gpt-5-mini
```

The Layer 3 handoff targets fal for downstream video generation:

```bash
FAL_VIDEO_MODEL=fal-ai/kling-video/v1.6/pro/image-to-video
```
