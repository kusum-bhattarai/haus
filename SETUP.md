# Haus Setup

## Install

Required:

```bash
brew install node ffmpeg
```

Install `genmedia` in the environment you use to run Haus.

Check installs:

```bash
node -v
ffmpeg -version
genmedia --help
```

## Repo

Clone the repo and move into it:

```bash
cd /path/to/haus
```

## Environment

Create a `.env` file in the repo root:

```bash
OPENAI_API_KEY=...
APIFY_TOKEN=...
APIFY_PINTEREST_ACTOR_ID=...
FAL_KEY=...
```

Optional runtime flags:

```bash
HAUS_FAST_MODE=true
HAUS_AUTO_APPROVE_STILLS=false
HAUS_STILL_MODEL=fal-ai/nano-banana-2
HAUS_VIDEO_MODEL=bytedance/seedance-2.0/image-to-video
OPENAI_EVAL_MODEL=gpt-5-mini
HOST=127.0.0.1
PORT=3000
```

## What Each Key Does

- `OPENAI_API_KEY`
  - Layer 1 floor plan dimension extraction
  - Layer 2 aesthetic extraction and floor plan parsing
  - Layer 3 creative planning
  - optional eval agent vision review

- `APIFY_TOKEN`
  - authenticates Pinterest scraping

- `APIFY_PINTEREST_ACTOR_ID`
  - identifies the Apify Pinterest actor

- `FAL_KEY`
  - authenticates fal/genmedia generation

## Run

Start with tests:

```bash
npm test
```

Start the app:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

## In-Flight Job Inspection

Newest job id:

```bash
ls -1t .haus-cache/agent/jobs | head -1
```

Inspect job state:

```bash
jq '{job_id,status,current_state,updated_at,rooms:[.rooms[]?|{room_id,state,still_approved:.review.still_approved,video_approved:.review.video_approved}]}' .haus-cache/agent/jobs/<job_id>/job.json
```

Watch events:

```bash
tail -f .haus-cache/agent/jobs/<job_id>/events.jsonl
```

Inspect over HTTP:

```bash
curl http://127.0.0.1:3000/api/jobs/<job_id> | jq
```

Watch SSE:

```bash
curl -N http://127.0.0.1:3000/api/jobs/<job_id>/events
```

## Cache

Job state:

```text
.haus-cache/agent/jobs/<job_id>/
```

Generation cache:

```text
.haus-cache/agent/generations/<cache_key>/
```

Uploads cache:

```text
.haus-cache/agent/uploads/
```

## Current Architecture Notes

- After Layer 3, room stills are generated in parallel.
- Humans review the still set before video generation begins.
- Videos start only after all stills are approved.
- `ffmpeg` is installed now for final packaging work, even though the current pass does not yet depend on it heavily.

## Troubleshooting

If Pinterest scraping fails:

- confirm `APIFY_TOKEN`
- confirm `APIFY_PINTEREST_ACTOR_ID`
- confirm the board is public

If generation fails:

- confirm `FAL_KEY`
- confirm `genmedia` is installed and on `PATH`

If Layer 1-3 fails:

- confirm `OPENAI_API_KEY`

If the UI loads but jobs do not progress:

- inspect `.haus-cache/agent/jobs/<job_id>/events.jsonl`
- check server output from `npm run dev`
