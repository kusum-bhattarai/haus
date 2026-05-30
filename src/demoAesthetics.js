/**
 * Discovers the best completed generation run for each aesthetic in the style library.
 *
 * Style library is the source of truth for aesthetics. Jobs are matched by their
 * pinterest_board_url. "Best" job = most rooms with video × average overall score.
 * When a new aesthetic is run, it auto-appears here with no code changes.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function buildDemoAesthetics({ cacheDir }) {
  const [styles, jobs] = await Promise.all([
    loadStyleLibrary(cacheDir),
    loadJobsIndex(cacheDir),
  ]);

  // One card per unique Pinterest URL — pick the style entry with the highest-scoring job
  const seenUrls = new Map();
  for (const style of styles) {
    const url = normalizeUrl(style.pinterest_board_url);
    const best = pickBestJob(style.pinterest_board_url, jobs);
    const score = best?.score ?? -1;
    const existing = seenUrls.get(url);
    if (!existing || score > existing.score) {
      seenUrls.set(url, { style, best, score });
    }
  }

  return [...seenUrls.values()].map(({ style, best }) => ({
    style_id: style.style_id,
    aesthetic_name: style.aesthetic_name,
    summary: style.summary,
    pinterest_board_url: style.pinterest_board_url,
    floor_plan_id: best?.floor_plan_id ?? null,
    floor_plan_name: best?.floor_plan_name ?? null,
    rooms: best?.rooms ?? [],
    job_id: best?.job_id ?? null,
    generated_at: best?.created_at ?? null,
    final_video_url: best?.final_video_url ?? null,
  }));
}

async function loadStyleLibrary(cacheDir) {
  const indexPath = path.join(cacheDir, 'style-library', 'index.json');
  const raw = await readFile(indexPath, 'utf8').catch(() => '{"styles":[]}');
  return JSON.parse(raw).styles ?? [];
}

function localAssetUrl(absolutePath, cacheDir) {
  if (!absolutePath || !cacheDir) return null;
  const rel = path.relative(cacheDir, absolutePath);
  if (rel.startsWith('..')) return null;
  return `/api/demo-assets/${rel.split(path.sep).map(encodeURIComponent).join('/')}`;
}

async function loadJobsIndex(cacheDir) {
  const jobsDir = path.join(cacheDir, 'agent', 'jobs');
  const entries = await readdir(jobsDir, { withFileTypes: true }).catch(() => []);
  const jobs = [];

  await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        const jobFile = path.join(jobsDir, e.name, 'job.json');
        const raw = await readFile(jobFile, 'utf8').catch(() => null);
        if (!raw) return;
        try {
          const job = JSON.parse(raw);
          const pinterestUrl = job.input?.pinterest_board_url;
          if (!pinterestUrl) return;
          const rooms = normalizeRooms(job.rooms, cacheDir);
          if (!rooms.length) return;
          const finalVideoPath = job.artifacts?.final_video_path ?? null;
          jobs.push({
            job_id: e.name,
            pinterest_url: pinterestUrl,
            floor_plan_id: job.input?.floor_plan_id ?? null,
            floor_plan_name: job.floor_plan?.name ?? null,
            created_at: job.created_at ?? null,
            rooms,
            score: scoreJob(rooms),
            final_video_url: finalVideoPath
              ? `/api/jobs/${e.name}/assets/layer5/final_16x9.mp4`
              : null,
          });
        } catch {
          // skip malformed
        }
      })
  );

  return jobs;
}

function normalizeRooms(raw, cacheDir) {
  const list = Array.isArray(raw) ? raw : (raw ? Object.values(raw) : []);
  return list
    .filter((r) => r && typeof r === 'object')
    .map((r) => ({
      room_id: r.room_id ?? r.room_hint ?? null,
      room_name: r.room_name ?? titleFromId(r.room_id ?? r.room_hint ?? ''),
      state: r.state ?? null,
      video_url: localAssetUrl(r.artifacts?.video_clip_path, cacheDir) ?? r.artifacts?.video_url ?? null,
      still_url: localAssetUrl(r.artifacts?.styled_image_path, cacheDir) ?? r.artifacts?.styled_image_url ?? null,
      score: r.scores?.overall ?? null,
      camera_motion: r.video_generation?.camera_motion ?? null,
    }))
    .filter((r) => r.video_url || r.still_url);
}

function scoreJob(rooms) {
  const withVideo = rooms.filter((r) => r.video_url);
  if (!withVideo.length) return 0;
  const scores = withVideo.map((r) => r.score ?? 7).filter((s) => s > 0);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 7;
  // Coverage ratio (videos / total rooms) is the primary signal — a complete 5/5 run
  // is far preferable to a partial 7/13 run with inconsistent ancillary spaces.
  const coverageRatio = withVideo.length / rooms.length;
  return avgScore * 2 + coverageRatio * 20 + withVideo.length;
}

function pickBestJob(pinterestUrl, jobs) {
  const candidates = jobs.filter((j) => urlsMatch(j.pinterest_url, pinterestUrl));
  if (!candidates.length) return null;
  return candidates.reduce((best, j) => (j.score > best.score ? j : best));
}

function urlsMatch(a, b) {
  return normalizeUrl(a) === normalizeUrl(b);
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname.replace(/\/?$/, '').toLowerCase();
  } catch {
    return String(url).toLowerCase().replace(/\/?$/, '');
  }
}

function titleFromId(id) {
  return id
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
