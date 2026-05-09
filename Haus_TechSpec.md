# Haus — Technical Specification
**Version:** 1.0 | **Hackathon:** AITX × Codex | **Date:** May 2026

> *See yourself living there — before you ever visit.*

---

## Table of Contents
1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Layer Specifications](#3-layer-specifications)
4. [API Reference](#4-api-reference)
5. [Data Schemas](#5-data-schemas)
6. [Frontend Spec](#6-frontend-spec)
7. [Prompt Engineering](#7-prompt-engineering)
8. [Eval Agent Spec](#8-eval-agent-spec)
9. [Error Handling & Fallbacks](#9-error-handling--fallbacks)
10. [48-Hour Build Plan](#10-48-hour-build-plan)
11. [Demo Runbook](#11-demo-runbook)

---

## 1. System Overview

### What Haus Does
A user selects a property floor plan on a listing portal, connects their Pinterest inspiration board, optionally adds personal objects to specific rooms, and Haus generates a cinematic lifestyle video of the space styled to their aesthetic — in under 2 minutes.

### The Core Pipeline
```
Floor Plan + Pinterest Board + Brief + Objects
        ↓
[Layer 1]  Input Collection & Validation
        ↓
[Layer 2]  Aesthetic Extraction Agent
        ↓   aesthetic_profile.json
[Layer 3]  Creative Spec Agent
        ↓   generation_spec.json + per-room DALL-E prompts
[Layer 3.5] Room Image Agent (DALL-E 3)
        ↓   staged_room_photos[]
[Layer 4]  AutoHDR Generation + Eval Loop
        ↓   approved_video_clips[]
[Layer 5]  Output Packaging Agent
        ↓
Final Output: Lifestyle Video + Captions + Miro Mood Board
```

### Key Architectural Insight
AutoHDR never receives a floor plan. It only ever receives a photorealistic staged room image. This is the design decision that makes the quality defensible — each tool in the chain receives the input format it is optimized for.

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    HAUS PIPELINE                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  INPUT                                                  │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │Floor Plan│  │Pinterest URL │  │Brief + Objects   │  │
│  └────┬─────┘  └──────┬───────┘  └────────┬─────────┘  │
│       └───────────────┼──────────────────┘            │
│                       ↓                               │
│  LAYER 1 ─────────────────────────────────────────    │
│  Input Validation → payload.json                      │
│                       ↓                               │
│  LAYER 2 ─────────────────────────────────────────    │
│  Apify MCP → 20 pins → GPT-4o Vision                  │
│  → aesthetic_profile.json                             │
│                       ↓                               │
│  LAYER 3 ─────────────────────────────────────────    │
│  Codex Agent synthesises spec                         │
│  → generation_spec.json                               │
│  → per_room_dalle_prompts[]                           │
│                       ↓                               │
│  LAYER 3.5 ────────────────────────────────────────   │
│  DALL-E 3 × N rooms → staged_room_photos[]            │
│  (shown to user as intermediate step)                 │
│                       ↓                               │
│  LAYER 4 ─────────────────────────────────────────    │
│  AutoHDR → video clip                                 │
│  Eval Agent scores 0-10                               │
│  < 7 → refine prompt → retry (max 3)                  │
│  ≥ 7 → pass                                           │
│                       ↓                               │
│  LAYER 5 ─────────────────────────────────────────    │
│  FFmpeg: 16:9 + 9:16 + 1:1                            │
│  Caption generation                                   │
│  Miro MCP → mood board population                     │
│                       ↓                               │
│  OUTPUT: Video bundle + captions + Miro link          │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Layer Specifications

### Layer 1 — Input Collection

**Responsibility:** Collect, validate, cache, and package user inputs. Layer 1
also extracts structured floor plan measurements with a vision model so later
layers do not need to infer architectural dimensions from raw image pixels.

**Inputs:**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `floor_plan_image` | File (PNG/JPG) | Yes | Max 10MB. Pre-validated for hackathon demo. |
| `pinterest_board_url` | String (URL) | Yes | Must be public board. Fallback: keyword search. |
| `brief` | String | No | Max 200 chars. Parsed by Layer 3. |
| `objects` | String[] | No | From predefined list. Max 3 objects per room. |
| `platform` | Enum | No | `instagram` / `tiktok` / `listing` / `portfolio`. Defaults to all. |
| `floor_plan_measurements` | Object | No | Optional structured measurements. If omitted, Layer 1 extracts them with vision. |

**Output schema:** `payload.json`
```json
{
  "floor_plan_url": "string",
  "floor_plan_metadata": {
    "source": "local_upload",
    "mime_type": "image/png",
    "size_bytes": 123456,
    "width_px": 2400,
    "height_px": 1600,
    "sha256": "string",
    "cache_key": "string"
  },
  "floor_plan_measurements": {
    "source": "ml_parser",
    "unit": "ft",
    "scale": null,
    "rooms": [
      {
        "room_id": null,
        "name": "Living Room",
        "dimensions": { "width": 12, "length": 16, "area": 192 },
        "unit": "ft",
        "confidence": 0.86
      }
    ],
    "notes": "Visible dimensions extracted from floor plan."
  },
  "pinterest_board_url": "string",
  "brief": "string | null",
  "objects": ["standing_desk", "crib"],
  "platform": "all",
  "timestamp": "ISO8601",
  "session_id": "uuid"
}
```

**Validation rules:**
- Floor plan must be an image file (reject PDFs)
- Local floor plan image metadata is extracted deterministically
- If measurements are not supplied, call the configured OpenAI vision model and
  cache the result by floor plan cache key
- Pinterest URL must match `pinterest.com/*/` pattern
- Objects list must only contain items from the predefined catalogue
- If Pinterest URL fails, fall back to keyword search using the brief

---

### Layer 2 — Aesthetic Extraction Agent

**Responsibility:** Pull Pinterest pins and extract a structured aesthetic profile.

**Tools used:** Apify Pinterest Scraper MCP, GPT-4o Vision

**Step 1 — Pinterest scrape (Apify MCP)**
```
Input:  pinterest_board_url
Output: pins[] (top 20 by save count)
Each pin: { image_url, title, description, save_count, hashtags }
```

**Step 2 — Vision extraction (GPT-4o)**

Send all 20 pin images in a single GPT-4o Vision call with this system prompt:
```
You are an interior design aesthetic analyst. Analyse these Pinterest pins and return a JSON 
aesthetic profile. Be precise and consistent. Return ONLY valid JSON, no markdown.
```

User message structure:
```
[image_1][image_2]...[image_20]
Extract the aesthetic profile from these Pinterest pins. Return JSON matching this schema exactly:
{
  "palette": "warm_neutral | cool_neutral | earthy | monochrome | bold",
  "lighting": "golden_hour | soft_ambient | bright_natural | dramatic | artificial",
  "density": "minimal | balanced | layered | maximalist",
  "style_era": "japandi | mid_century | scandinavian | coastal | industrial | maximalist | traditional",
  "dominant_colors": ["hex1", "hex2", "hex3"],
  "mood_words": ["cozy", "airy", "sophisticated"],
  "pinterest_cluster_labels": ["string"]
}
```

**Step 3 — Floor plan parsing (GPT-4o Vision)**
```
System: You are an architectural floor plan parser. Extract room data as JSON only.
User:   [floor_plan_image]
        Parse this floor plan. Return JSON:
        {
          "rooms": [
            {
              "name": "living_room",
              "area_estimate": "large|medium|small",
              "windows": "south-facing|east-facing|none|unknown",
              "natural_light": "high|medium|low",
              "adjoins": ["kitchen", "hallway"]
            }
          ],
          "total_rooms": number,
          "layout_type": "open_plan|traditional|studio"
        }
```

**Output:** `aesthetic_profile.json` — the contract between Layer 2 and Layer 3.

---

### Layer 3 — Creative Spec Agent

**Responsibility:** Synthesise aesthetic profile + floor plan data + brief into a complete generation spec and per-room DALL-E 3 prompts.

**Tools used:** OpenAI Codex (reasoning), prompt templates

**System prompt:**
```
You are a creative director for a luxury property visualization studio. 
Given an aesthetic profile and floor plan data, produce a precise generation spec.
You make decisions about camera movement, lighting mood, room sequencing, and 
translate object additions into natural room descriptions.
Return ONLY valid JSON.
```

**Output:** `generation_spec.json`
```json
{
  "room_sequence": ["living_room", "bedroom_1", "bedroom_2", "kitchen"],
  "rooms": [
    {
      "name": "living_room",
      "dalle_prompt": "string",
      "autohdr_prompt": "string",
      "camera_motion": "slow_dolly | orbital_pan | aerial_drift | static_zoom",
      "lighting_instruction": "string",
      "duration_seconds": 5
    }
  ],
  "export_formats": ["16:9", "9:16", "1:1"],
  "overall_mood": "string"
}
```

**Downstream handoff:** Layers 1-3 should emit a single `Layer3Handoff` bundle
for Layers 3.5-5. See
[docs/layer_3_handoff_data_model.md](docs/layer_3_handoff_data_model.md).

**Camera motion selection logic:**
| Room Type | Default Motion | Luxury Override |
|-----------|---------------|-----------------|
| Living room | slow_dolly | orbital_pan |
| Bedroom | static_zoom | slow_dolly |
| Kitchen | aerial_drift | slow_dolly |
| Bathroom | static_zoom | static_zoom |
| Home office | slow_dolly | slow_dolly |

---

### Layer 3.5 — Room Image Agent

**Responsibility:** Generate a photorealistic staged room image per room using DALL-E 3. This image becomes the direct input to AutoHDR.

**Tools used:** OpenAI DALL-E 3

**DALL-E 3 prompt construction (per room):**

The spec agent builds this prompt template:
```
Photorealistic interior photograph of a {area_estimate} {room_name}, 
{window_description}, {lighting_description},
{style_era} aesthetic, {palette} color palette, {density} furnishing,
{object_descriptions},
architectural photography style, Canon 5D, 35mm lens, 
professional staging, no people, high resolution, sharp focus,
photo taken for a luxury property listing
```

**Example output prompt (living room, Japandi, standing desk):**
```
Photorealistic interior photograph of a large living room, south-facing windows 
with warm afternoon light, Japandi aesthetic, warm neutral color palette, minimal 
furnishing, low wooden coffee table, linen sofa in cream, a standing desk with 
dual monitors in the corner near the window, bamboo floor lamp, architectural 
photography style, Canon 5D, 35mm lens, professional staging, no people, high 
resolution, sharp focus, photo taken for a luxury property listing
```

**DALL-E 3 call parameters:**
```json
{
  "model": "dall-e-3",
  "prompt": "string (constructed above)",
  "size": "1792x1024",
  "quality": "hd",
  "style": "natural"
}
```

**Quality gate:**
- If the returned image contains visible people, re-generate (max 1 retry)
- Images displayed to user immediately as an intermediate demo step
- Do not proceed to Layer 4 until all rooms have generated images

**Output:** `staged_photos[]` — one URL per room, shown to user before video generation begins.

---

### Layer 4 — Generation + Eval Loop

**Responsibility:** Animate staged room photos via AutoHDR, evaluate output quality, retry with refined prompts if below threshold.

**Tools used:** AutoHDR API, GPT-4o Vision (eval judge)

**Step 1 — AutoHDR call (per room)**
```
Input:  staged_room_photo (from Layer 3.5)
        autohdr_prompt (from generation_spec.json)
        camera_motion instruction
Output: video_clip (5-second .mp4)
```

**Step 2 — Eval Agent scoring**

System prompt:
```
You are a video quality evaluator for a luxury property visualization tool.
Score this video clip against the target aesthetic profile.
Return ONLY valid JSON with scores 0-10.
```

Scoring rubric:
```json
{
  "palette_match": 0-10,
  "lighting_match": 0-10,
  "motion_appropriateness": 0-10,
  "aesthetic_coherence": 0-10,
  "composite_score": "weighted average"
}
```

**Weights:**
- Palette match: 30%
- Lighting match: 25%
- Motion appropriateness: 25%
- Aesthetic coherence: 20%

**Retry logic:**
```
if composite_score >= 7.0:
    pass → Layer 5

if composite_score < 7.0 and attempts < 3:
    adjust prompt:
      - If palette_match low: increase color descriptor specificity
      - If lighting_match low: add explicit lighting instruction
      - If motion low: change camera_motion type
    retry AutoHDR call

if attempts == 3 and score < 7.0:
    accept best result, flag for user review
    log: { room, scores[], final_prompt }
```

**Demo mode:** For live demo, set threshold to 6.5 and max retries to 2 to ensure speed.

---

### Layer 5 — Output Packaging Agent

**Responsibility:** Format, export, and deliver final assets.

**Tools used:** FFmpeg, OpenAI (captions), Miro MCP

**Step 1 — Video assembly**
```bash
# Concatenate room clips in sequence order
ffmpeg -i room1.mp4 -i room2.mp4 -i room3.mp4 \
  -filter_complex "[0:v][1:v][2:v]concat=n=3:v=1[out]" \
  -map "[out]" output_16x9.mp4

# Crop for 9:16 (center crop)
ffmpeg -i output_16x9.mp4 \
  -vf "crop=ih*9/16:ih:(iw-ih*9/16)/2:0" \
  output_9x16.mp4

# Crop for 1:1
ffmpeg -i output_16x9.mp4 \
  -vf "crop=ih:ih:(iw-ih)/2:0" \
  output_1x1.mp4
```

**Step 2 — Caption generation**

Prompt:
```
Write 3 social media captions for a property listing video.
Property: {brief}
Aesthetic: {style_era}, {mood_words}
Objects featured: {objects}

Return JSON:
{
  "instagram": "caption with hashtags, max 150 chars",
  "tiktok": "caption with trending hashtags, max 100 chars",
  "listing": "professional property description, max 200 chars"
}
```

**Step 3 — Miro MCP mood board**

Populate in this order:
1. Header: property address + aesthetic profile summary
2. Pinterest pin cluster (top 9 pins arranged by visual similarity)
3. Generated room images (staged photos from Layer 3.5)
4. Generation spec annotation (camera moves, palette, style era)
5. Final video embed (link)

---

## 4. API Reference

### OpenAI APIs
| Endpoint | Usage | Est. Cost per Run |
|----------|-------|-------------------|
| `gpt-4o` vision | Aesthetic extraction (20 pins) | ~$0.08 |
| `gpt-4o` vision | Floor plan parsing | ~$0.02 |
| `gpt-4o` text | Spec synthesis | ~$0.01 |
| `gpt-4o` vision | Eval scoring (per clip) | ~$0.03 |
| `dall-e-3` | Room image gen (per room, HD) | ~$0.08 |
| **Total per run (3 rooms)** | | **~$0.45** |

$50 OpenAI credit = ~110 full pipeline runs. Well within hackathon budget.

### Apify Pinterest Scraper MCP
```javascript
// MCP tool call
const pins = await mcp.call('apify/pinterest-scraper', {
  boardUrl: payload.pinterest_board_url,
  maxItems: 20,
  sortBy: 'save_count'
});
// Returns: pins[{ imageUrl, title, description, saveCount, hashtags }]
```

Cost: ~$0.03 per scrape. $50 Apify credit = 1,600+ scrapes.

### AutoHDR API
```javascript
const video = await autohdr.generate({
  image_url: staged_room_photo_url,
  prompt: generation_spec.rooms[i].autohdr_prompt,
  motion: generation_spec.rooms[i].camera_motion,
  duration: 5,
  format: '16:9'
});
// Returns: { video_url, processing_time_ms }
```

### Miro MCP
```javascript
// Populate mood board
await mcp.call('miro/create-board-items', {
  boardId: HACKATHON_BOARD_ID,
  items: [
    { type: 'image', url: pin.imageUrl, x, y },
    { type: 'sticky_note', content: aesthetic_profile.style_era, x, y },
    { type: 'image', url: staged_photo_url, x, y }
  ]
});
```

---

## 5. Data Schemas

### `payload.json`
```typescript
interface Payload {
  floor_plan_url: string;
  floor_plan_metadata: FloorPlanMetadata;
  floor_plan_measurements: FloorPlanMeasurements;
  pinterest_board_url: string;
  brief: string | null;
  objects: ObjectType[];
  platform: 'all' | 'instagram' | 'tiktok' | 'listing' | 'portfolio';
  timestamp: string; // ISO8601
  session_id: string; // uuid
}

interface FloorPlanMetadata {
  source: 'local_upload' | 'remote_url';
  mime_type: 'image/png' | 'image/jpeg' | null;
  size_bytes: number | null;
  width_px: number | null;
  height_px: number | null;
  sha256: string | null;
  cache_key: string | null;
}

interface FloorPlanMeasurements {
  source: 'user_provided' | 'ocr' | 'ml_parser' | 'not_provided';
  unit: 'ft' | 'm' | null;
  scale: { pixels: number; units: number } | null;
  rooms: MeasuredRoom[];
  notes: string | null;
}

interface MeasuredRoom {
  room_id: string | null;
  name: string;
  dimensions: {
    width: number;
    length: number;
    area: number;
  };
  unit: 'ft' | 'm' | null;
  confidence: number | null;
}

type ObjectType = 
  | 'standing_desk' | 'crib' | 'wine_rack' | 'bookshelf'
  | 'yoga_mat' | 'home_studio' | 'dining_table' | 'home_gym';
```

### `aesthetic_profile.json`
```typescript
interface AestheticProfile {
  palette: 'warm_neutral' | 'cool_neutral' | 'earthy' | 'monochrome' | 'bold';
  lighting: 'golden_hour' | 'soft_ambient' | 'bright_natural' | 'dramatic' | 'artificial';
  density: 'minimal' | 'balanced' | 'layered' | 'maximalist';
  style_era: 'japandi' | 'mid_century' | 'scandinavian' | 'coastal' | 'industrial' | 'maximalist' | 'traditional';
  dominant_colors: string[]; // hex codes
  mood_words: string[];
  pinterest_cluster_labels: string[];
  floor_plan: FloorPlanData;
}

interface FloorPlanData {
  rooms: Room[];
  total_rooms: number;
  layout_type: 'open_plan' | 'traditional' | 'studio';
}

interface Room {
  name: string;
  area_estimate: 'large' | 'medium' | 'small';
  windows: string;
  natural_light: 'high' | 'medium' | 'low';
  adjoins: string[];
}
```

### `generation_spec.json`
```typescript
interface GenerationSpec {
  room_sequence: string[];
  rooms: RoomSpec[];
  export_formats: ('16:9' | '9:16' | '1:1')[];
  overall_mood: string;
}

interface RoomSpec {
  name: string;
  dalle_prompt: string;
  autohdr_prompt: string;
  camera_motion: 'slow_dolly' | 'orbital_pan' | 'aerial_drift' | 'static_zoom';
  lighting_instruction: string;
  duration_seconds: number;
  objects_to_include: string[];
}
```

### `eval_result.json`
```typescript
interface EvalResult {
  room: string;
  attempt: number;
  scores: {
    palette_match: number;      // 0-10
    lighting_match: number;     // 0-10
    motion_appropriateness: number; // 0-10
    aesthetic_coherence: number; // 0-10
    composite: number;          // weighted average
  };
  passed: boolean;
  prompt_used: string;
}
```

---

## 6. Frontend Spec

### Tech Stack
- **Framework:** Next.js 14 (App Router)
- **Styling:** Tailwind CSS
- **Deployment:** Vercel
- **State:** React useState / useReducer (no Redux needed)
- **File upload:** react-dropzone

### Page Structure
```
/                    → Mock property portal (3 listings)
/listing/[id]        → Property detail page with Haus panel
/session/[id]        → Generation progress + result page
```

### Mock Property Portal (`/`)
Three pre-loaded listing cards:
```
Property 1: "The Aldgate" — 2BR/1BA, 750sqft, £2,400/mo
Property 2: "The Shoreditch" — 1BR/1BA, 520sqft, £1,850/mo  
Property 3: "The Mayfair" — 3BR/2BA, 1,200sqft, £5,200/mo
```

Each card: address, hero photo, price, sqft, "Visualize with Haus" CTA button.

### Listing Page (`/listing/[id]`)

**Layout:** Two-column. Left: floor plan display. Right: Haus sidebar panel.

**Haus Sidebar Panel — three states:**

**State 1 — Input collection**
```
[ Floor plan shown automatically from listing data ]

Pinterest inspiration
[ Paste your board URL _________________ ]
or [ Search: _________________________ ]

Tell us the vibe (optional)
[ __________________________________ ]

Add to your space
[ ] Standing desk    [ ] Crib
[ ] Wine rack        [ ] Bookshelf
[ ] Yoga mat         [ ] Home studio

[ Generate my space → ]
```

**State 2 — Generation progress (live agent status)**
```
Haus is imagining your space...

✓ Pulling your Pinterest inspiration   (0:03)
✓ Extracting your aesthetic            (0:08)
✓ Reading the floor plan               (0:12)
◉ Generating your rooms...             (0:24)
○ Creating your lifestyle video
○ Packaging your bundle

[ ████████░░░░░░░░░░░░ 45% ]
```

**State 3 — Result**
```
Your space is ready

[ Video player — 16:9 ]

Format: [ 16:9 ] [ 9:16 ] [ 1:1 ]

[ Download video ]  [ View mood board → ]

Generated rooms:
[ Living room photo ] [ Bedroom photo ] [ Kitchen photo ]

Your caption:
"Warm, minimal, and entirely yours. 
#JapandiHome #MinimalistLiving"
[ Copy ]
```

### Agent Status Panel — Implementation
```typescript
type AgentStep = {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'retrying';
  detail?: string; // shown when running or retrying
}

const steps: AgentStep[] = [
  { id: 'pinterest', label: 'Pulling your Pinterest inspiration' },
  { id: 'aesthetic', label: 'Extracting your aesthetic' },
  { id: 'floorplan', label: 'Reading the floor plan' },
  { id: 'rooms', label: 'Generating your rooms' },
  { id: 'video', label: 'Creating your lifestyle video' },
  { id: 'packaging', label: 'Packaging your bundle' }
];

// Retrying step shows detail:
// { status: 'retrying', detail: 'Score: 6.2 — adjusting lighting...' }
```

The retry state is the key demo moment — judges visibly see the agent evaluating and improving.

---

## 7. Prompt Engineering

### DALL-E 3 Prompt Templates

**Base template:**
```
Photorealistic interior photograph of a {size} {room_type},
{window_desc} with {light_desc},
{style_era} aesthetic, {palette} color palette, {density} furnishing,
{furniture_desc},
{object_descs},
architectural photography style, Canon 5D, 35mm lens,
professional real estate staging, no people, no text,
sharp focus, high resolution, photo taken for a luxury property listing
```

**Style era descriptors:**
| Era | Furniture descriptor |
|-----|---------------------|
| Japandi | low wooden furniture, natural textures, bamboo accents, neutral linen textiles |
| Mid-century | walnut credenza, tulip table, Eames-style chairs, geometric rugs |
| Scandinavian | white walls, light oak floors, hygge textiles, simple clean lines |
| Coastal | rattan furniture, white and blue palette, driftwood accents, linen curtains |
| Industrial | exposed brick, metal accents, leather sofa, Edison bulb pendant lights |
| Maximalist | layered patterns, rich jewel tones, eclectic art, abundant plants |

**Object descriptors:**
| Object | DALL-E description |
|--------|-------------------|
| standing_desk | a height-adjustable standing desk with dual monitors in the corner near the window |
| crib | a white wooden crib with a soft grey mobile, nursery corner setup |
| wine_rack | a built-in wine rack with a marble countertop bar cart beside it |
| bookshelf | floor-to-ceiling built-in bookshelves lined with books and plants |
| yoga_mat | a rolled-out yoga mat in a clear open area with a meditation cushion |
| home_studio | a microphone setup on a desk arm, acoustic foam panels on one wall |

### AutoHDR Prompt Templates

**Per camera motion type:**
```
slow_dolly:     "Camera slowly dollies forward into the room, 
                 revealing the space with smooth, deliberate movement"

orbital_pan:    "Camera orbits gently around the focal point of the room, 
                 360-degree smooth rotation, cinematic real estate style"

aerial_drift:   "Camera drifts forward from a slightly elevated angle, 
                 surveying the full room before settling"

static_zoom:    "Very subtle slow zoom into the focal point of the room, 
                 breathing parallax effect, intimate and warm"
```

**Lighting additions by aesthetic:**
```
golden_hour:    "warm golden light streaming through windows, 
                 long soft shadows, late afternoon feel"

soft_ambient:   "even soft diffused lighting, no harsh shadows, 
                 editorial interior photography feel"

bright_natural: "bright natural daylight, clean crisp light, 
                 airy and open atmosphere"
```

---

## 8. Eval Agent Spec

### System Prompt
```
You are a quality evaluator for an AI property visualization tool.
You receive a video frame (first frame of a generated video clip) and 
an aesthetic target profile. Score the output honestly.
The scores directly control whether the system retries — be accurate, not generous.
Return ONLY valid JSON.
```

### Scoring Prompt
```
Target aesthetic profile:
{aesthetic_profile_json}

Evaluate this video frame against the target. Return:
{
  "palette_match": <0-10, how well do the colors match the target palette>,
  "lighting_match": <0-10, how well does the lighting match the target>,
  "motion_appropriateness": <0-10, does the camera motion suit the room and aesthetic>,
  "aesthetic_coherence": <0-10, overall how well does this match the Pinterest board feel>,
  "composite": <weighted average: palette×0.3 + lighting×0.25 + motion×0.25 + coherence×0.2>,
  "retry_reason": "<if composite < 7, one sentence on what to fix>"
}
```

### Prompt Refinement on Retry
```typescript
function refinePrompt(spec: RoomSpec, evalResult: EvalResult): RoomSpec {
  const { scores } = evalResult;
  let refined = { ...spec };

  if (scores.palette_match < 6) {
    // Add explicit color instruction
    refined.autohdr_prompt += ` Emphasize ${aesthetic.dominant_colors.join(', ')} color tones throughout.`;
  }

  if (scores.lighting_match < 6) {
    // Strengthen lighting instruction
    refined.lighting_instruction = `Strong ${aesthetic.lighting} lighting. ${refined.lighting_instruction}`;
  }

  if (scores.motion_appropriateness < 6) {
    // Switch camera motion type
    refined.camera_motion = getAlternativeMotion(spec.camera_motion);
  }

  return refined;
}

function getAlternativeMotion(current: CameraMotion): CameraMotion {
  const alternatives = {
    'slow_dolly': 'static_zoom',
    'orbital_pan': 'slow_dolly',
    'aerial_drift': 'slow_dolly',
    'static_zoom': 'slow_dolly'
  };
  return alternatives[current];
}
```

---

## 9. Error Handling & Fallbacks

### Pinterest Scraping Fails
```
Primary:  Apify MCP scrape
Fallback: Pre-cached board JSONs for 5 common aesthetics
          (japandi, coastal, maximalist, mid-century, scandinavian)
User sees: No error. Agent uses nearest cached aesthetic silently.
```

### DALL-E 3 Generation Fails
```
Primary:  DALL-E 3 HD
Fallback: DALL-E 3 standard quality (faster, cheaper)
Fallback 2: Pre-generated room images from aesthetic library
            (curated set of 50 real room photos per aesthetic)
User sees: "Using curated reference for this room"
```

### AutoHDR Fails or Times Out
```
Primary:  AutoHDR API
Fallback: Display DALL-E 3 staged photo with Ken Burns effect (CSS animation)
          as a "still lifestyle image" — not ideal but demo-safe
User sees: "Lifestyle image ready" (not "video") — honest framing
```

### Eval Loop Never Passes (3 retries, still < 7)
```
Action:   Accept best result. Flag with amber indicator.
User sees: "Best match — 6.8/10 aesthetic fit"
           Option to "Try a different aesthetic" or "Accept"
```

### Rate Limits
```
OpenAI:   Implement exponential backoff (1s, 2s, 4s)
Apify:    Pre-cache all demo scrapes before taking stage
AutoHDR:  One request at a time (no parallel room generation)
          Sequential generation: room 1 → room 2 → room 3
```

---

## 10. 48-Hour Build Plan

### Phase 1 — Foundation (Hours 1–4, Thu 7:30 PM)
```
[ ] Next.js project init, push to GitHub, deploy to Vercel
[ ] Mock property portal UI — 3 listings with floor plans preloaded
[ ] Haus sidebar panel shell — input state only
[ ] Environment variables: OPENAI_KEY, APIFY_KEY, AUTOHDR_KEY, MIRO_KEY
[ ] Test Apify MCP: scrape one Pinterest board end to end
[ ] Test AutoHDR API: one call with a real photo
```

**Checkpoint:** Portal renders, Apify returns pins, AutoHDR returns a clip.

### Phase 2 — Core Pipeline (Hours 5–16, Fri 8:30 AM)
```
[ ] Layer 2: GPT-4o aesthetic extraction from 20 pins → aesthetic_profile.json
[ ] Layer 2: GPT-4o floor plan parser → room list
[ ] Layer 3: Creative spec agent → generation_spec.json + DALL-E prompts
[ ] Layer 3.5: DALL-E 3 room image generation (one room first)
[ ] Layer 3.5: Scale to all rooms, display intermediate results in UI
[ ] Layer 4: AutoHDR call with staged photo input
[ ] Layer 4: Eval agent scoring
[ ] Layer 4: Retry loop (refinePrompt function)
[ ] Wire Layers 2–4 end to end with one test property + one Pinterest board
```

**Checkpoint:** Full pipeline runs on one property. Video generates from floor plan.

### Phase 3 — Features + Polish (Hours 17–22, Fri 6 PM)
```
[ ] Agent status panel — live step updates in UI
[ ] Layer 5: FFmpeg multi-format export
[ ] Layer 5: Caption generation
[ ] Layer 5: Miro MCP mood board population
[ ] Object addition UI — checkbox panel, wire to DALL-E prompt builder
[ ] Error handling + fallbacks (critical path only)
[ ] Pre-cache Pinterest scrapes for 3 demo boards
```

**Checkpoint:** Full demo flow works for both personas. Miro board populates.

### Phase 4 — Demo Hardening (Hours 23–36, Fri night – Sat morning)
```
[ ] Run full demo flow 10 times. Fix everything that breaks.
[ ] DALL-E prompt tuning — get room image quality to listing-photo standard
[ ] Pre-generate demo videos for both personas as backup
[ ] Calibrate eval threshold: 6.5 for demo mode, max 2 retries
[ ] Polish UI — loading states, transitions, typography
[ ] Prepare Miro board manually as fallback if MCP integration is fragile
[ ] Write 3-sentence pitch for each bounty (AutoHDR, Miro, DeepInvent)
```

**Checkpoint:** Demo runs perfectly 5 times in a row. Videos are beautiful.

### MVP Scope (If Behind)
The non-negotiable core:
```
✓ Pinterest board → aesthetic extraction
✓ Floor plan → room parsing
✓ DALL-E 3 room image generation (at least 1 room)
✓ AutoHDR video from DALL-E image
✓ Eval loop with one retry
✓ Video displayed to user
```

Cut if needed (in this order):
1. Miro MCP integration → show mood board as static collage instead
2. Multi-format FFmpeg export → 16:9 only
3. Caption generation → hardcode for demo
4. Object injection → keep UI but pre-generate with objects already in DALL-E

---

## 11. Demo Runbook

### Setup (30 mins before presenting)
```
[ ] Open Haus on laptop, connect to venue WiFi + personal hotspot as backup
[ ] Pre-load both demo property pages in separate browser tabs
[ ] Have backup videos ready in a local folder (in case of API failure)
[ ] Open Miro board in a third tab, pre-positioned
[ ] Silence all notifications
[ ] Test AutoHDR and DALL-E APIs with one live call each — confirm working
[ ] Brief teammate on fallback: if API fails mid-demo, switch to pre-recorded video smoothly
```

### Demo Flow (4 minutes)

**[0:00–0:20] The hook**
> "Every time someone finds a listing they love, they face the same moment — they look at someone else's grey couch in someone else's living room and try to imagine their life there. They almost never can. Haus solves that."

**[0:20–0:45] Persona 1 setup — Remote worker**
- Select "The Aldgate" (2BR)
- Paste pre-loaded Pinterest board URL (warm minimalist home office — already scraped)
- Check: Standing desk + monitor
- Brief: "home office feel, warm and minimal"
- Hit Generate

**[0:45–1:30] Narrate the agent live**
> "Pulling 20 pins from your board... extracting the aesthetic — warm neutral palette, Japandi era, minimal density... reading the floor plan — living room, home office, bedroom... now generating what each room looks like in your style..."

Point at the staged room photos appearing: *"Look — the agent just placed your standing desk in the second bedroom. That's your home office, before you've even booked a tour."*

**[1:30–2:00] Eval loop moment**
> "Score: 6.2 — slightly too cool-toned. Refining the lighting instruction and retrying..."
> "Score: 8.1 — passes. Here's your space."

Play the video. Let it breathe for 5 seconds. Don't talk over it.

**[2:00–2:30] Miro moment**
Switch to Miro: *"The agent also built you a mood board — your Pinterest inspiration, your generated rooms, and the full aesthetic spec. This is what your taste looks like as a system."*

**[2:30–3:00] Persona 2 — New parents**
Same property. Pinterest board: "scandinavian nursery." Object: crib. Hit generate.
> "Same apartment. Same pipeline. Completely different life."

Play 10 seconds of the nursery bedroom video. Done.

**[3:00–3:30] The close**
> "Decisions about home are not rational — they're emotional. Nobody has ever signed a lease because of a floor plan. They sign because they could feel it. Haus is the first tool that gives people that feeling before they ever walk through the door."

### Fallback Protocol
| Failure | Action |
|---------|--------|
| API timeout during demo | "While that processes, let me show you the output from our earlier test run" → play pre-recorded video |
| DALL-E images look poor | Skip the intermediate step, go straight to video |
| AutoHDR fails | "Here's the lifestyle image version" → show DALL-E room photo with Ken Burns CSS animation |
| Miro MCP fails | Switch to pre-built static Miro board screenshot |
| Total internet failure | Full pre-recorded demo video ready to play |

---

*Haus — Built at AITX × Codex Hackathon, Austin TX, May 2026*
*Questions: team@aitxcommunity.com*
