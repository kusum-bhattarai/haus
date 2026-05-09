# haus

Haus generates styled property lifestyle videos from a floor plan, Pinterest
board, brief, and optional room objects.

## Docs

- [Technical specification](Haus_TechSpec.md)
- [Layer 1 payload JSON Schema](schemas/layer1_payload.schema.json)
- [Layer 2 profile JSON Schema](schemas/layer2_profile.schema.json)
- [Layer 3 creative plan JSON Schema](schemas/layer3_creative_plan.schema.json)
- [Layer 3 handoff data model](docs/layer_3_handoff_data_model.md)
- [Layer 3 handoff JSON Schema](schemas/layer_3_handoff.schema.json)
- [Hackathon product demo strategy](docs/hackathon_product_demo_strategy.md)
- [Business positioning](docs/business_positioning.md)
- [Integrated Layers 1-3](docs/integrated_layers_1_3.md)

## Frontend Demo

Run the local app server to use the integrated Springmarc at San Marcos demo:

```bash
npm run dev
```

Then open `http://localhost:3000`. The demo includes floor plan selection,
Pinterest personalization, a Layer 1-3 backend run, generation progress, vibe
report, final video preview shell, and an AI edit-agent interface for
room-specific regeneration.

Current floor plan assets:

- `1b1`: 1 Bedroom / 1 Bath, 689 sq ft
- `2b2`: 2 Bedroom / 2 Bath, 988 sq ft
- `3b2`: 3 Bedroom / 2 Bath, 1,250 sq ft

## Layer 1

Create a Layer 1 payload from a JSON input file:

```bash
npm run layer1:create-payload -- --input ./input.json
```

Example input:

```json
{
  "floor_plan_image": "./demo/floor-plan.png",
  "pinterest_board_url": "https://www.pinterest.com/example/warm-home/",
  "brief": "Warm family condo",
  "objects": ["crib", "bookshelf"],
  "platform": "instagram",
  "floor_plan_measurements": {
    "source": "user_provided",
    "unit": "ft",
    "rooms": [
      {
        "name": "Living Room",
        "dimensions": {
          "width": 12,
          "length": 16
        },
        "confidence": 1
      }
    ]
  }
}
```

Validated local floor plan images are cached by SHA-256 under `.haus-cache/`.
Payloads are written to `.haus-cache/payloads/{session_id}.json`.
Layer 1 also records image metadata like pixel width, pixel height, MIME type,
file size, and SHA-256.

If `floor_plan_measurements` is omitted, Layer 1 calls an OpenAI vision model to
extract visible architectural room dimensions from the floor plan and caches the
structured result under `.haus-cache/floor-plan-vision/`. Set
`OPENAI_VISION_MODEL` to override the default model.

## Layer 2

Create a Layer 2 profile from a Layer 1 payload:

```bash
npm run layer2:create-profile -- --payload ./.haus-cache/payloads/{session_id}.json
```

Layer 2 scrapes and normalizes Pinterest pins, extracts the aesthetic profile
from pin images, parses floor plan room structure using the Layer 1 measurement
context, and writes `.haus-cache/layer2-profiles/{session_id}.json`.

## Layer 3

Create a Layer 3 handoff from a Layer 2 profile:

```bash
npm run layer3:create-handoff -- --profile ./.haus-cache/layer2-profiles/{session_id}.json
```

Layer 3 creates a structured vibe report, generation spec, and per-room
generation jobs for Layers 3.5-5. The handoff is written to
`.haus-cache/layer3-handoffs/{session_id}.json`.
