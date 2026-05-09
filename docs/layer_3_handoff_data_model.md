# Layer 3 Handoff Data Model

This is the contract emitted after Layers 1-3 and consumed by Layers 3.5-5.
It packages the validated user input, Pinterest intelligence, floor plan parse,
creative generation spec, and per-room work items into one downstream-safe object.

Machine-readable validation lives at
[`schemas/layer_3_handoff.schema.json`](../schemas/layer_3_handoff.schema.json).

The downstream services should treat this object as read-only source of truth.
Layer 3.5 can generate staged room images directly from `room_generation_jobs`.
Layer 4 can animate those images with the same room ids and AutoHDR prompts.
Layer 5 can package the final output using `delivery`.

## Top-Level Contract

```typescript
interface Layer3Handoff {
  schema_version: '1.0';
  handoff_id: string; // uuid
  session_id: string; // uuid from Layer 1 payload
  created_at: string; // ISO8601

  status: HandoffStatus;
  source_input: SourceInput;
  pinterest_intelligence: PinterestIntelligence;
  floor_plan: FloorPlanData;
  vibe_report: VibeReport;
  creative_spec: CreativeSpec;
  room_generation_jobs: RoomGenerationJob[];
  delivery: DeliverySpec;
  provenance: Provenance;
  warnings: HandoffWarning[];
}

type HandoffStatus =
  | 'ready_for_room_images'
  | 'partial_ready'
  | 'blocked';
```

## Source Input

Carries the normalized Layer 1 input so downstream jobs do not need to look up
the original request payload.

```typescript
interface SourceInput {
  floor_plan_url: string;
  floor_plan_metadata: FloorPlanMetadata;
  floor_plan_measurements: FloorPlanMeasurements;
  pinterest_board_url: string;
  brief: string | null;
  objects: ObjectSelection[];
  platform: DeliveryPlatform;
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
  scale: FloorPlanScale | null;
  rooms: MeasuredRoom[];
  notes: string | null;
}

interface FloorPlanScale {
  pixels: number;
  units: number;
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

interface ObjectSelection {
  object_type: ObjectType;
  room_id: string | null; // null means Layer 3 may place it where it fits best
  label: string;
}

type ObjectType =
  | 'standing_desk'
  | 'crib'
  | 'wine_rack'
  | 'bookshelf'
  | 'yoga_mat'
  | 'home_studio'
  | 'dining_table'
  | 'home_gym';

type DeliveryPlatform =
  | 'all'
  | 'instagram'
  | 'tiktok'
  | 'listing'
  | 'portfolio';
```

## Pinterest Intelligence

This contains both the synthesized aesthetic profile and the scrape metadata
needed for mood boards, captions, traceability, and retry/debug views.

```typescript
interface PinterestIntelligence {
  aesthetic_profile: AestheticProfile;
  pins: PinterestPin[];
  cluster_summary: PinterestCluster[];
}

interface AestheticProfile {
  palette: 'warm_neutral' | 'cool_neutral' | 'earthy' | 'monochrome' | 'bold';
  lighting: 'golden_hour' | 'soft_ambient' | 'bright_natural' | 'dramatic' | 'artificial';
  density: 'minimal' | 'balanced' | 'layered' | 'maximalist';
  style_era:
    | 'japandi'
    | 'mid_century'
    | 'scandinavian'
    | 'coastal'
    | 'industrial'
    | 'maximalist'
    | 'traditional';
  dominant_colors: string[]; // 3-6 hex colors
  mood_words: string[];
  pinterest_cluster_labels: string[];
  confidence: number; // 0-1
}

interface PinterestPin {
  pin_id: string;
  source_url: string;
  image_url: string;
  title: string | null;
  description: string | null;
  save_count: number | null;
  hashtags: string[];
  cluster_label: string | null;
  selected_for_mood_board: boolean;
}

interface PinterestCluster {
  label: string;
  pin_ids: string[];
  visual_notes: string;
  weight: number; // 0-1, relative influence on generated spec
}
```

## Floor Plan

Rooms must have stable ids. Downstream layers should key all generated assets by
`room_id`, not by display name, because names may be repeated or renamed.

```typescript
interface FloorPlanData {
  layout_type: 'open_plan' | 'traditional' | 'studio';
  total_rooms: number;
  rooms: FloorPlanRoom[];
}

interface FloorPlanRoom {
  room_id: string; // stable slug, for example "living_room_1"
  name: string; // display name, for example "living room"
  room_type: RoomType;
  area_estimate: 'large' | 'medium' | 'small';
  measured_dimensions: MeasuredRoom['dimensions'] | null;
  measured_unit: 'ft' | 'm' | null;
  windows: string;
  natural_light: 'high' | 'medium' | 'low' | 'unknown';
  adjoins: string[];
  generation_priority: number; // lower number renders earlier
}

type RoomType =
  | 'living_room'
  | 'bedroom'
  | 'kitchen'
  | 'bathroom'
  | 'office'
  | 'dining_room'
  | 'other';
```

## Creative Spec

Layer 3 emits both a structured vibe report and executable generation spec. The
vibe report explains the creative direction from Pinterest analysis; the
generation spec and room jobs are the machine contract for Layers 3.5-5.

```typescript
interface VibeReport {
  aesthetic_name: string;
  summary: string;
  palette_rationale: string;
  lighting_mood: string;
  materials: string[];
  textures: string[];
  furniture_language: string[];
  styling_rules: string[];
  avoid: string[];
  room_guidance: RoomVibeGuidance[];
  confidence: number;
  warnings: string[];
}

interface RoomVibeGuidance {
  room_id: string;
  headline: string;
  guidance: string;
  must_include: string[];
  must_avoid: string[];
}

interface CreativeSpec {
  overall_mood: string;
  room_sequence: string[]; // room_ids in render/order sequence
  global_style_notes: string[];
  negative_prompt: string;
  export_formats: ExportFormat[];
}

type ExportFormat = '16:9' | '9:16' | '1:1';
```

## Room Generation Jobs

Each item is a complete unit of work for Layer 3.5. After image generation,
Layers 3.5-4 should append outputs using the same `job_id` and `room_id`.

```typescript
interface RoomGenerationJob {
  job_id: string; // uuid
  room_id: string;
  room_name: string;
  room_type: RoomType;
  sequence_index: number;

  dalle: DalleImageSpec;
  autohdr: AutoHdrSpec;
  staging: StagingSpec;
  quality_gate: RoomQualityGate;
}

interface DalleImageSpec {
  prompt: string;
  size: '1792x1024';
  quality: 'hd' | 'standard';
  style: 'natural' | 'vivid';
  expected_aspect_ratio: '16:9';
}

interface AutoHdrSpec {
  prompt: string;
  camera_motion: 'slow_dolly' | 'orbital_pan' | 'aerial_drift' | 'static_zoom';
  duration_seconds: number;
  format: '16:9';
}

interface StagingSpec {
  lighting_instruction: string;
  objects_to_include: ObjectSelection[];
  must_include: string[];
  must_avoid: string[];
}

interface RoomQualityGate {
  min_eval_score: number; // default 7.0, demo default 6.5
  max_autohdr_attempts: number; // default 3, demo default 2
  regenerate_image_if: ImageRegenReason[];
}

type ImageRegenReason =
  | 'visible_people'
  | 'wrong_room_type'
  | 'major_style_mismatch'
  | 'object_missing';
```

## Delivery

Layer 5 should use this section for platform packaging, captions, and mood board
construction.

```typescript
interface DeliverySpec {
  requested_platforms: DeliveryPlatform[];
  video_formats: ExportFormat[];
  caption_context: CaptionContext;
  mood_board: MoodBoardSpec;
}

interface CaptionContext {
  property_brief: string | null;
  aesthetic_summary: string;
  featured_objects: string[];
  tone: 'luxury_listing' | 'social_shortform' | 'portfolio';
}

interface MoodBoardSpec {
  include_pin_ids: string[];
  include_room_ids: string[];
  annotations: MoodBoardAnnotation[];
}

interface MoodBoardAnnotation {
  label: string;
  value: string;
}
```

## Provenance And Warnings

The downstream layers should surface warnings in logs or operator UI, but can
still proceed when `status` is `ready_for_room_images`.

```typescript
interface Provenance {
  layer_1_payload_created_at: string;
  pinterest_scrape: {
    provider: 'apify';
    item_count: number;
    fallback_used: boolean;
    fallback_reason: string | null;
  };
  models: {
    aesthetic_extraction: string;
    floor_plan_parsing: string;
    creative_spec: string;
  };
}

interface HandoffWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  affected_room_ids: string[];
}
```

## Example

```json
{
  "schema_version": "1.0",
  "handoff_id": "32df18e7-3121-4148-b98c-f5c715bb20cf",
  "session_id": "984d21ac-8cb7-4f0f-bd78-28fb727ec4ad",
  "created_at": "2026-05-08T16:30:00-05:00",
  "status": "ready_for_room_images",
  "source_input": {
    "floor_plan_url": "https://cdn.example.com/floorplans/unit-4b.png",
    "floor_plan_metadata": {
      "source": "remote_url",
      "mime_type": null,
      "size_bytes": null,
      "width_px": null,
      "height_px": null,
      "sha256": null,
      "cache_key": null
    },
    "floor_plan_measurements": {
      "source": "user_provided",
      "unit": "ft",
      "scale": null,
      "rooms": [
        {
          "room_id": "living_room_1",
          "name": "living room",
          "dimensions": {
            "width": 14,
            "length": 18,
            "area": 252
          },
          "unit": "ft",
          "confidence": 1
        }
      ],
      "notes": null
    },
    "pinterest_board_url": "https://www.pinterest.com/example/warm-japandi-home/",
    "brief": "Two-bedroom downtown condo for a young family.",
    "objects": [
      {
        "object_type": "crib",
        "room_id": "bedroom_2",
        "label": "crib"
      }
    ],
    "platform": "all"
  },
  "pinterest_intelligence": {
    "aesthetic_profile": {
      "palette": "warm_neutral",
      "lighting": "golden_hour",
      "density": "minimal",
      "style_era": "japandi",
      "dominant_colors": ["#F2E8DA", "#B89B72", "#4A4037"],
      "mood_words": ["calm", "warm", "natural"],
      "pinterest_cluster_labels": ["linen textures", "low wood furniture"],
      "confidence": 0.86
    },
    "pins": [
      {
        "pin_id": "pin_001",
        "source_url": "https://www.pinterest.com/pin/123",
        "image_url": "https://i.pinimg.com/example.jpg",
        "title": "Japandi living room",
        "description": "Warm minimal living room",
        "save_count": 421,
        "hashtags": ["japandi", "interiordesign"],
        "cluster_label": "low wood furniture",
        "selected_for_mood_board": true
      }
    ],
    "cluster_summary": [
      {
        "label": "low wood furniture",
        "pin_ids": ["pin_001"],
        "visual_notes": "Low-profile oak furniture, cream textiles, sparse decor.",
        "weight": 0.42
      }
    ]
  },
  "floor_plan": {
    "layout_type": "open_plan",
    "total_rooms": 2,
    "rooms": [
      {
        "room_id": "living_room_1",
        "name": "living room",
        "room_type": "living_room",
        "area_estimate": "large",
        "measured_dimensions": {
          "width": 14,
          "length": 18,
          "area": 252
        },
        "measured_unit": "ft",
        "windows": "south-facing",
        "natural_light": "high",
        "adjoins": ["kitchen_1"],
        "generation_priority": 1
      }
    ]
  },
  "creative_spec": {
    "overall_mood": "Warm Japandi calm with soft afternoon light.",
    "room_sequence": ["living_room_1"],
    "global_style_notes": ["cream linen", "oak wood", "minimal decor"],
    "negative_prompt": "no people, no clutter, no visible brand logos, no warped furniture",
    "export_formats": ["16:9", "9:16", "1:1"]
  },
  "room_generation_jobs": [
    {
      "job_id": "f1c3fc06-02d3-4f22-8986-dd8d050b3cc1",
      "room_id": "living_room_1",
      "room_name": "living room",
      "room_type": "living_room",
      "sequence_index": 0,
      "dalle": {
        "prompt": "Photorealistic interior photograph of a large living room, south-facing windows with warm afternoon light, Japandi aesthetic, warm neutral color palette, minimal furnishing, low oak coffee table, cream linen sofa, architectural photography style, Canon 5D, 35mm lens, professional staging, no people, high resolution, sharp focus, photo taken for a luxury property listing",
        "size": "1792x1024",
        "quality": "hd",
        "style": "natural",
        "expected_aspect_ratio": "16:9"
      },
      "autohdr": {
        "prompt": "Slow cinematic dolly through a warm Japandi living room, emphasizing cream linen, oak textures, and golden natural light.",
        "camera_motion": "slow_dolly",
        "duration_seconds": 5,
        "format": "16:9"
      },
      "staging": {
        "lighting_instruction": "golden natural light from south-facing windows",
        "objects_to_include": [],
        "must_include": ["cream linen sofa", "low oak coffee table"],
        "must_avoid": ["people", "clutter", "visible logos"]
      },
      "quality_gate": {
        "min_eval_score": 7,
        "max_autohdr_attempts": 3,
        "regenerate_image_if": ["visible_people", "wrong_room_type", "major_style_mismatch"]
      }
    }
  ],
  "delivery": {
    "requested_platforms": ["instagram", "tiktok", "listing", "portfolio"],
    "video_formats": ["16:9", "9:16", "1:1"],
    "caption_context": {
      "property_brief": "Two-bedroom downtown condo for a young family.",
      "aesthetic_summary": "Warm Japandi calm with soft afternoon light.",
      "featured_objects": ["crib"],
      "tone": "luxury_listing"
    },
    "mood_board": {
      "include_pin_ids": ["pin_001"],
      "include_room_ids": ["living_room_1"],
      "annotations": [
        {
          "label": "Palette",
          "value": "warm_neutral"
        }
      ]
    }
  },
  "provenance": {
    "layer_1_payload_created_at": "2026-05-08T16:28:00-05:00",
    "pinterest_scrape": {
      "provider": "apify",
      "item_count": 20,
      "fallback_used": false,
      "fallback_reason": null
    },
    "models": {
      "aesthetic_extraction": "gpt-4o",
      "floor_plan_parsing": "gpt-4o",
      "creative_spec": "gpt-4o"
    }
  },
  "warnings": []
}
```

## Handoff Rules

- Emit `status: "ready_for_room_images"` only when every room in
  `creative_spec.room_sequence` has exactly one matching `room_generation_jobs`
  entry.
- Use stable `room_id` values everywhere after floor plan parsing. Human-facing
  names can change, ids should not.
- Keep raw Pinterest pins in the handoff because Layer 5 needs them for the Miro
  mood board and because they are useful for debugging aesthetic mismatches.
- Include prompts exactly as generated by Layer 3. Downstream layers may append
  retry refinements, but should store those as attempt records rather than
  mutating the original handoff.
- If Pinterest scraping falls back to keyword search, keep the original board
  URL in `source_input.pinterest_board_url` and set
  `provenance.pinterest_scrape.fallback_used` to `true`.
