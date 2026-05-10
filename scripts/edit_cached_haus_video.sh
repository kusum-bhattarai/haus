#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

WORKDIR="${WORKDIR:-$ROOT_DIR/output/cached_edit_demo}"
RESTAGE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --restage) RESTAGE=1; shift ;;
    --workdir) WORKDIR="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

: "${FAL_KEY:?Missing FAL_KEY. Put it in .env or export it first.}"

readonly FAL_QUEUE_BASE="https://queue.fal.run"
readonly FAL_STORAGE_INIT="https://rest.alpha.fal.ai/storage/upload/initiate"
readonly THUMBNAIL_MODEL="${THUMBNAIL_MODEL:-fal-ai/gemini-3.1-flash-image-preview/edit}"
readonly FLOORPLAN_SRC="frontend/floor_plans/3b2.png"

mkdir -p \
  "$WORKDIR/assets/stills" \
  "$WORKDIR/assets/clips" \
  "$WORKDIR/assets/broll" \
  "$WORKDIR/runtime"

copy_if_needed() {
  local src="$1"
  local dest="$2"
  if [[ "$RESTAGE" == "1" || ! -f "$dest" ]]; then
    cp "$src" "$dest"
  fi
}

stage_asset() {
  local src="$1"
  local dest="$2"
  if [[ ! -f "$src" ]]; then
    echo "Missing cache asset: $src" >&2
    exit 1
  fi
  copy_if_needed "$src" "$dest"
}

stage_asset ".haus-cache/agent/generations/6685cee912a034cc22334dc6d53de7e288cc56931b980283e446a09419e1725e/still-0.png" "$WORKDIR/assets/stills/nest.png"
stage_asset ".haus-cache/agent/generations/4adcfbb3bdd59f1782dbdcea320d5e59317a3aca9530489704f13edcf482c4ce/video-0.mp4" "$WORKDIR/assets/clips/nest.mp4"
stage_asset ".haus-cache/agent/generations/6694cce30f96ab687bfddbf271948211275dfe8966f9c1f5bfd65a8a1d9aec8f/still-0.png" "$WORKDIR/assets/stills/dream.png"
stage_asset ".haus-cache/agent/generations/c2d4e897a391f6ebccea9ed83cf02b4960a8fdfeb8541f31c911abc31d723916/video-0.mp4" "$WORKDIR/assets/clips/dream.mp4"
stage_asset ".haus-cache/agent/generations/3449c4b2d2676bffd004215e504bea6f5b664a08c7d7651c8c8bf63e959217f9/still-0.png" "$WORKDIR/assets/stills/dine.png"
stage_asset ".haus-cache/agent/generations/c3054c1aa5d01bf8e6bb8699a0feb185faf09903bb713e7ed24ce9dde326c32f/video-0.mp4" "$WORKDIR/assets/clips/dine.mp4"
stage_asset ".haus-cache/agent/generations/09da03bab0ff70c2d1a6c084ddf64d50e42ae59850b8232198cd434576172abc/still-0.png" "$WORKDIR/assets/stills/relax.png"
stage_asset ".haus-cache/agent/generations/9b1f44ce4035bafec22ac4912c918567b09e42f375f04b10fb117a59993845fa/video-0.mp4" "$WORKDIR/assets/clips/relax.mp4"
stage_asset ".haus-cache/agent/generations/b4d068972f9e7eab825434a4fd33fec35e5dd18b12ec6cf275fac85bfd9d7d3e/still-0.png" "$WORKDIR/assets/stills/revive.png"
stage_asset ".haus-cache/agent/generations/1fbb8bdda230e176e5222e1aca53a3f2524a15e6040b8f0f3217f82ae4d99bfe/video-0.mp4" "$WORKDIR/assets/clips/revive.mp4"
stage_asset "$FLOORPLAN_SRC" "$WORKDIR/image_0.png"

cat > "$WORKDIR/thumbnail_prompt.json" <<'JSON'
{
  "type": "split architectural visualization",
  "objective": "Create a 3:4 vertical architectural visualization with an exact 50/50 horizontal split: the top half is a precise top-down blueprint of the compact apartment layout, and the bottom half is a photorealistic modern single-story apartment render that matches the blueprint footprint exactly, respecting the apartment scale and the interior reference.",
  "aspect_ratio": "3:4",
  "composition": {
    "layout": "two stacked panels, exact vertical 50/50 split",
    "top_half": "true top-down orthographic architectural blueprint based strictly on image_0.png",
    "bottom_half": "elevated photorealistic exterior and open-roof view render of the same apartment unit, showing the internal layout",
    "alignment": "the footprint, room divisions, and furniture placement must align one-to-one between the blueprint and the render"
  },
  "top_section": {
    "style": "dark luxury architectural blueprint on deep navy charcoal background",
    "linework": "thin glowing beige and gold technical lines with clean wall outlines, door swings, window symbols, plumbing fixtures, and cabinetry",
    "labels": {
      "count": 12,
      "items": [
        "DREAM",
        "DRESS",
        "REVIVE",
        "WASH",
        "STORE",
        "SURF",
        "ENTRY",
        "DISPLAY",
        "NEST",
        "TASTE",
        "DINE",
        "RELAX"
      ]
    },
    "layout_details": "precisely replicate the wall layout and room arrangement of image_0.png. The top half must include all verbatim dimensions: '12'6\" x 11'7\"' (DREAM), '11'11\" x 11'8\"' (NEST), and '7'10\" x 8'' (DINE). Include all specific text labels verbatim ('DREAM', 'DRESS', 'REVIVE', etc.). Show all symbols: entry arrow and text, 'STORE' closet, 'WASH' (W/D units), 'SURF' (WH unit), 'TASTE' (sink, range, counter), and bathroom fixtures.",
    "visual_mood": "precise, premium, softly glowing, minimal sans-serif labels"
  },
  "bottom_section": {
    "render_style": "photorealistic modern residential architecture, golden-hour daylight, clean commercial architectural visualization - create similar prompt template for the given interior style.",
    "house": "a single-story compact modern apartment unit with a complex footprint. Exterior walls are smooth white stucco with warm vertical wood accents. The render is an open-roof view looking down, with the exterior walls and some surrounding context (sidewalk and low landscaping). The unit's interior layout matches the blueprint exactly.",
    "interior_layout": "The render shows an open-roof view revealing the interior: 'DREAM' is a bedroom, 'DRESS' is a walk-in closet, 'REVIVE' is a complete bathroom, 'WASH' is a utility closet with a stacked W/D, 'STORE' is a storage closet, 'SURF' is a small utility area with a water heater (WH) symbol. The main space (NEST) is an open-plan living area. 'TASTE' is a fully fitted L-shaped kitchen, 'DINE' is a dining area, and 'RELAX' is a large open-air balcony/terrace (this area is not roofed, but clearly open to the sky). The entry (ENTRY) is a front door leading into the main space.",
    "site": "a paved sidewalk leading to the recessed entry door, small landscape beds with low shrubs, and a paved/wood-decked terrace for the 'RELAX' area.",
    "camera": "front elevated three-quarter view looking slightly downward, wide angle, centered on the unit",
    "lighting": "soft golden-hour light, long gentle shadows, realistic reflections in windows and fixtures",
    "materials": "smooth white stucco, limestone pavers, black metal window frames, warm vertical wood slats, and composite wood decking for the balcony. Interior finishes (viewable from above) include dark wood floors, modern furniture, stainless steel appliances, and a tiled bathroom."
  },
  "constraints": [
    "must replicate the specific complex footprint of image_0.png",
    "all rooms labeled in the plan must be present and correctly located in the render",
    "labels (verbatim text and dimensions) must be legible and accurate in the top half",
    "The 'RELAX' area is an open-air balcony/terrace and must not be fully covered by a solid roof, matching its placement on the plan.",
    "no extra floors, no mismatched room functions"
  ],
  "customization": {
    "architectural style": "modern compact apartment unit",
    "blueprint background": "deep navy charcoal",
    "blueprint line color": "glowing beige gold",
    "exterior wall material": "smooth white stucco and warm wood slats",
    "time of day": "golden hour"
  },
  "verbatim_text": {
    "rendered_text": "the specific room labels 'DREAM', 'DRESS', 'REVIVE', 'WASH', 'STORE', 'SURF', 'ENTRY', 'DISPLAY', 'NEST', 'TASTE', 'DINE', and 'RELAX' are rendered in uppercase sans-serif font"
  }
}
JSON

upload_file() {
  local file_path="$1"
  local file_name content_type init_json upload_url file_url
  file_name="$(basename "$file_path")"
  case "${file_name##*.}" in
    png) content_type="image/png" ;;
    jpg|jpeg) content_type="image/jpeg" ;;
    webp) content_type="image/webp" ;;
    mp4) content_type="video/mp4" ;;
    *) content_type="application/octet-stream" ;;
  esac

  init_json="$(
    curl -fsSL \
      -H "Authorization: Key $FAL_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"file_name\":\"$file_name\",\"content_type\":\"$content_type\"}" \
      "$FAL_STORAGE_INIT"
  )"

  upload_url="$(python3 - <<'PY' "$init_json"
import json, sys
print(json.loads(sys.argv[1])["upload_url"])
PY
)"
  file_url="$(python3 - <<'PY' "$init_json"
import json, sys
print(json.loads(sys.argv[1])["file_url"])
PY
)"

  curl -fsSL -X PUT -H "Content-Type: $content_type" --data-binary @"$file_path" "$upload_url" >/dev/null
  printf '%s\n' "$file_url"
}

fal_run() {
  local model_id="$1"
  local payload="$2"
  local submit_json request_id status_url response_url status_json status

  submit_json="$(
    curl -fsSL \
      -H "Authorization: Key $FAL_KEY" \
      -H "Content-Type: application/json" \
      -d "$payload" \
      "$FAL_QUEUE_BASE/$model_id"
  )"

  request_id="$(python3 - <<'PY' "$submit_json"
import json, sys
print((json.loads(sys.argv[1]).get("request_id") or "").strip())
PY
)"
  if [[ -z "$request_id" ]]; then
    printf '%s\n' "$submit_json"
    return
  fi

  status_url="$(python3 - <<'PY' "$submit_json" "$FAL_QUEUE_BASE/$model_id"
import json, sys
body=json.loads(sys.argv[1]); base=sys.argv[2]
print(body.get("status_url") or f"{base}/requests/{body['request_id']}/status")
PY
)"
  response_url="$(python3 - <<'PY' "$submit_json" "$FAL_QUEUE_BASE/$model_id"
import json, sys
body=json.loads(sys.argv[1]); base=sys.argv[2]
print(body.get("response_url") or f"{base}/requests/{body['request_id']}")
PY
)"

  while true; do
    status_json="$(curl -fsSL -H "Authorization: Key $FAL_KEY" "$status_url?logs=1")"
    status="$(python3 - <<'PY' "$status_json"
import json, sys
print(json.loads(sys.argv[1]).get("status", "UNKNOWN"))
PY
)"
    case "$status" in
      COMPLETED)
        curl -fsSL -H "Authorization: Key $FAL_KEY" "$response_url"
        return
        ;;
      FAILED|CANCELLED)
        echo "$status_json" >&2
        return 1
        ;;
      *)
        sleep 5
        ;;
    esac
  done
}

prompt_text="$(
  python3 - <<'PY' "$WORKDIR/thumbnail_prompt.json"
import json, sys
print(json.dumps(json.load(open(sys.argv[1])), ensure_ascii=True))
PY
)"

echo "Generating thumbnail from image_0.png via fal..."
floorplan_url="$(upload_file "$WORKDIR/image_0.png")"
thumbnail_payload="$(
  python3 - <<'PY' "$floorplan_url" "$prompt_text"
import json, sys
image_url, prompt = sys.argv[1], sys.argv[2]
print(json.dumps({
  "image_urls": [image_url],
  "prompt": prompt,
  "resolution": "2K",
  "aspect_ratio": "3:4",
  "output_format": "png",
  "num_images": 1
}))
PY
)"

thumbnail_result="$(fal_run "$THUMBNAIL_MODEL" "$thumbnail_payload")"
thumbnail_url="$(python3 - <<'PY' "$thumbnail_result"
import json, sys
body=json.loads(sys.argv[1])
images=body.get("images") or body.get("output") or []
if not images:
    raise SystemExit("No thumbnail image returned from fal")
first=images[0]
print(first["url"] if isinstance(first, dict) else first)
PY
)"

curl -fsSL "$thumbnail_url" -o "$WORKDIR/assets/broll/thumbnail.png"

cat > "$WORKDIR/video_edit_manifest.json" <<'JSON'
{
  "job_id": "cached-edit-demo",
  "floor_plan_id": "3b2",
  "property_brief": "Edit-only pass from cached Haus generations.",
  "aesthetic_name": "Warm Japandi Family Calm",
  "aesthetic_summary": "Room-first cut from cached stills and approved room clips plus a generated split-architecture thumbnail.",
  "rooms": [
    {
      "room_id": "nest",
      "room_name": "Nest",
      "still_path": "assets/stills/nest.png",
      "clip_path": "assets/clips/nest.mp4",
      "duration_seconds": 5,
      "motion_preset": "slow_dolly"
    },
    {
      "room_id": "dream",
      "room_name": "Dream",
      "still_path": "assets/stills/dream.png",
      "clip_path": "assets/clips/dream.mp4",
      "duration_seconds": 5,
      "motion_preset": "static_zoom"
    },
    {
      "room_id": "dine",
      "room_name": "Dine",
      "still_path": "assets/stills/dine.png",
      "clip_path": "assets/clips/dine.mp4",
      "duration_seconds": 5,
      "motion_preset": "lateral_pan"
    },
    {
      "room_id": "relax",
      "room_name": "Relax",
      "still_path": "assets/stills/relax.png",
      "clip_path": "assets/clips/relax.mp4",
      "duration_seconds": 5,
      "motion_preset": "slow_hold"
    },
    {
      "room_id": "revive",
      "room_name": "Revive",
      "still_path": "assets/stills/revive.png",
      "clip_path": "assets/clips/revive.mp4",
      "duration_seconds": 5,
      "motion_preset": "slow_hold"
    }
  ],
  "assets": [
    {
      "id": "split-arch-thumbnail",
      "type": "broll",
      "label": "Split architectural visualization",
      "path": "assets/broll/thumbnail.png",
      "duration_seconds": 4
    }
  ]
}
JSON

echo "Running edit from staged assets..."
npm run video:edit -- --manifest "$WORKDIR/video_edit_manifest.json" --output-dir "$WORKDIR/runtime"

cat <<EOF

Workspace ready: $WORKDIR

Editable staged assets:
  $WORKDIR/assets/stills
  $WORKDIR/assets/clips
  $WORKDIR/assets/broll/thumbnail.png

Editable manifest:
  $WORKDIR/video_edit_manifest.json

Thumbnail prompt:
  $WORKDIR/thumbnail_prompt.json

Final edit outputs:
  $WORKDIR/runtime

Re-run after edits:
  bash scripts/edit_cached_haus_video.sh --workdir "$WORKDIR"

Re-copy original caches first:
  bash scripts/edit_cached_haus_video.sh --workdir "$WORKDIR" --restage
EOF
