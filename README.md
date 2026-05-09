# haus

Haus generates styled property lifestyle videos from a floor plan, Pinterest
board, brief, and optional room objects.

## Docs

- [Technical specification](Haus_TechSpec.md)
- [Layer 1 payload JSON Schema](schemas/layer1_payload.schema.json)
- [Layer 3 handoff data model](docs/layer_3_handoff_data_model.md)
- [Layer 3 handoff JSON Schema](schemas/layer_3_handoff.schema.json)

## Layer 1

Create a Layer 1 payload from a JSON input file:

```bash
export OPENAI_API_KEY="..."
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
