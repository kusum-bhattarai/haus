#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheRoot = path.resolve(process.env.HAUS_CACHE_DIR ?? path.join(repoRoot, '.haus-cache'));
const outPath = path.resolve(process.argv[2] ?? path.join(cacheRoot, 'cache-dictionary.json'));

export async function buildCacheDictionary(options = {}) {
  const root = path.resolve(options.cacheRoot ?? cacheRoot);
  const styles = new Map();
  const sessions = new Map();
  const generationToStyle = {};
  const unassignedGenerations = [];

  const styleFor = (boardUrl, styleName = null) => {
    const key = boardUrl || `unknown:${styleName || 'style'}`;
    if (!styles.has(key)) styles.set(key, emptyStyle(boardUrl, styleName));
    const style = styles.get(key);
    if (styleName) style.style_names = add(style.style_names, styleName);
    return style;
  };

  for (const payload of await readJsonFiles(path.join(root, 'payloads'))) {
    const boardUrl = payload.data.pinterest_board_url ?? null;
    if (!boardUrl || !payload.data.session_id) continue;
    sessions.set(payload.data.session_id, { boardUrl });
    styleFor(boardUrl).payload_session_ids = add(styleFor(boardUrl).payload_session_ids, payload.data.session_id);
  }

  for (const profile of await readJsonFiles(path.join(root, 'layer2-profiles'))) {
    const data = profile.data;
    const boardUrl = data.source_payload?.pinterest_board_url ?? sessions.get(data.session_id)?.boardUrl ?? null;
    if (!boardUrl) continue;
    sessions.set(data.session_id, { ...sessions.get(data.session_id), boardUrl });
    const style = styleFor(boardUrl, data.aesthetic_profile?.style_name ?? null);
    style.layer2_profile_ids = add(style.layer2_profile_ids, data.profile_id);
    style.layer2_profile_files = add(style.layer2_profile_files, rel(root, profile.path));
    const limit = data.provenance?.pinterest?.requested_limit;
    if (Number.isFinite(limit)) addPinterestKeys(style, boardUrl, limit);
    style.aesthetic_cache_keys = add(style.aesthetic_cache_keys, path.basename(data.provenance?.aesthetic_cache_path ?? ''), Boolean(data.provenance?.aesthetic_cache_path));
  }

  for (const handoff of await readJsonFiles(path.join(root, 'layer3-handoffs'))) {
    const data = handoff.data;
    const boardUrl = data.source_input?.pinterest_board_url ?? sessions.get(data.session_id)?.boardUrl ?? null;
    const styleName = data.vibe_report?.aesthetic_name ?? null;
    if (!boardUrl && !styleName) continue;
    const style = styleFor(boardUrl, styleName);
    sessions.set(data.session_id, { ...sessions.get(data.session_id), boardUrl, styleName });
    style.layer3_handoff_ids = add(style.layer3_handoff_ids, data.handoff_id);
    style.layer3_handoff_files = add(style.layer3_handoff_files, rel(root, handoff.path));
    style.room_count = Math.max(style.room_count, data.room_generation_jobs?.length ?? 0);
  }

  await addStyleLibrary(root, styleFor);
  await addPinterestFiles(root, styles);
  await addCreativePlans(root, styles);
  await addJobs(root, styleFor, generationToStyle);
  await addGenerations(root, styles, generationToStyle, unassignedGenerations);

  const byPinterestUrl = Object.fromEntries([...styles.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, style]) => [key, sortStyle(style)]));

  return {
    generated_at: new Date().toISOString(),
    cache_root: rel(repoRoot, root),
    hash_logic: {
      pinterest_cache_key: 'sha256(JSON.stringify({ version: 2, boardUrl, limit }))',
      pinterest_cache_key_legacy: 'sha256(JSON.stringify({ boardUrl, limit }))',
      layer3_creative_plan_key: 'sha256(JSON.stringify({ model, skill_version, profile_id, source_payload, aesthetic_profile, cluster_summary, floor_plan }))',
      agent_generation_id: 'sha256(stableStringify({ endpointId, params, sourceHashes, skillVersion }))',
      style_library_id: 'slug(aesthetic_name) + djb2(pinterest_board_url).slice(0, 8)'
    },
    by_pinterest_url: byPinterestUrl,
    generation_to_style: sortObject(generationToStyle),
    unassigned_generations: unassignedGenerations.sort((a, b) => a.generation_id.localeCompare(b.generation_id))
  };
}

async function addStyleLibrary(root, styleFor) {
  for (const entry of await readJsonFiles(path.join(root, 'style-library'))) {
    if (path.basename(entry.path) === 'index.json') continue;
    const data = entry.data;
    const boardUrl = data.source?.pinterest_board_url ?? null;
    const styleName = data.vibe_report?.aesthetic_name ?? null;
    const style = styleFor(boardUrl, styleName);
    style.style_library_ids = add(style.style_library_ids, data.style_id);
    style.style_library_files = add(style.style_library_files, rel(root, entry.path));
  }
}

async function addPinterestFiles(root, styles) {
  const files = await readJsonFiles(path.join(root, 'pinterest'));
  for (const file of files) {
    const hash = path.basename(file.path, '.json');
    const style = [...styles.values()].find((candidate) => candidate.pinterest_cache_keys.includes(hash));
    if (style) {
      style.pinterest_cache_files = add(style.pinterest_cache_files, rel(root, file.path));
      style.pinterest_pin_count = Math.max(style.pinterest_pin_count, Array.isArray(file.data) ? file.data.length : Object.keys(file.data ?? {}).length);
      const index = style.pinterest_cache_indexes.find((item) => item.hash_index === hash);
      if (index) index.file = rel(root, file.path);
    }
  }
}

async function addCreativePlans(root, styles) {
  const files = await readJsonFiles(path.join(root, 'layer3-creative-plans'));
  for (const file of files) {
    const hash = path.basename(file.path, '.json');
    const styleName = file.data.vibe_report?.aesthetic_name ?? null;
    const matches = [...styles.values()].filter((style) => style.style_names.includes(styleName));
    if (matches.length === 1) {
      matches[0].layer3_creative_plan_hashes = add(matches[0].layer3_creative_plan_hashes, hash);
      matches[0].layer3_creative_plan_files = add(matches[0].layer3_creative_plan_files, rel(root, file.path));
    }
  }
}

async function addJobs(root, styleFor, generationToStyle) {
  const jobsRoot = path.join(root, 'agent', 'jobs');
  const dirs = await safeReaddir(jobsRoot);
  for (const dir of dirs) {
    const jobPath = path.join(jobsRoot, dir, 'job.json');
    const job = await readJson(jobPath);
    if (!job) continue;
    const boardUrl = job.input?.pinterest_board_url ?? job.payload?.pinterest_board_url ?? job.handoff?.source_input?.pinterest_board_url ?? null;
    const styleName = job.handoff?.vibe_report?.aesthetic_name ?? null;
    const style = styleFor(boardUrl, styleName);
    const generationIds = [];
    for (const room of job.rooms ?? []) {
      for (const artifactPath of generationPaths(room.artifacts)) {
        const generationId = generationHashFromPath(artifactPath);
        if (!generationId) continue;
        generationIds.push(generationId);
        const kind = generationKind(artifactPath);
        const item = {
          generation_id: generationId,
          hash_index: generationId,
          short_hash: generationId.slice(0, 10),
          kind,
          room_id: room.room_id ?? null,
          room_name: room.room_name ?? null,
          job_ids: [job.job_id ?? dir],
          artifact_paths: [rel(root, artifactPath)]
        };
        style.generations[generationId] = mergeGeneration(style.generations[generationId], item);
        generationToStyle[generationId] = {
          pinterest_board_url: boardUrl,
          style_name: styleName,
          kind,
          room_id: room.room_id ?? null,
          room_name: room.room_name ?? null,
          job_id: job.job_id ?? dir
        };
      }
    }
    style.agent_jobs.push({
      job_id: job.job_id ?? dir,
      status: job.status ?? null,
      floor_plan_id: job.input?.floor_plan_id ?? job.floor_plan_id ?? null,
      room_count: job.rooms?.length ?? 0,
      generation_ids: uniq(generationIds)
    });
  }
}

async function addGenerations(root, styles, generationToStyle, unassigned) {
  const dirs = await safeReaddir(path.join(root, 'agent', 'generations'));
  for (const generationId of dirs) {
    const request = await readJson(path.join(root, 'agent', 'generations', generationId, 'request.json'));
    const result = await readJson(path.join(root, 'agent', 'generations', generationId, 'result.json'));
    const detail = {
      endpoint_id: request?.endpoint_id ?? null,
      skill_version: request?.skill_version ?? null,
      source_hashes: request?.source_hashes ?? [],
      has_result: Boolean(result)
    };
    const owner = generationToStyle[generationId];
    if (owner) {
      const style = styles.get(owner.pinterest_board_url || `unknown:${owner.style_name || 'style'}`);
      style.generations[generationId] = { ...style.generations[generationId], ...detail };
    } else {
      unassigned.push({ generation_id: generationId, hash_index: generationId, short_hash: generationId.slice(0, 10), ...detail });
    }
  }
}

function emptyStyle(boardUrl, styleName) {
  return {
    pinterest_board_url: boardUrl,
    style_names: styleName ? [styleName] : [],
    pinterest_cache_keys: [],
    pinterest_cache_indexes: [],
    pinterest_cache_files: [],
    pinterest_pin_count: 0,
    payload_session_ids: [],
    layer2_profile_ids: [],
    layer2_profile_files: [],
    aesthetic_cache_keys: [],
    layer3_handoff_ids: [],
    layer3_handoff_files: [],
    layer3_creative_plan_hashes: [],
    layer3_creative_plan_files: [],
    style_library_ids: [],
    style_library_files: [],
    room_count: 0,
    agent_jobs: [],
    generations: {}
  };
}

function generationPaths(artifacts = {}) {
  return Object.values(artifacts ?? {}).filter((value) => typeof value === 'string' && value.includes('/generations/'));
}

export function generationHashFromPath(filePath) {
  const parts = String(filePath).split(/[\\/]+/);
  const index = parts.lastIndexOf('generations');
  return index >= 0 ? parts[index + 1] : null;
}

function generationKind(filePath) {
  const name = path.basename(filePath);
  if (name.startsWith('video')) return 'video';
  if (name.startsWith('still')) return 'still';
  if (name.startsWith('anchor')) return 'anchor';
  return 'asset';
}

function pinterestCacheKey(boardUrl, limit) {
  return sha256(JSON.stringify({ version: 2, boardUrl, limit }));
}

function legacyPinterestCacheKey(boardUrl, limit) {
  return sha256(JSON.stringify({ boardUrl, limit }));
}

function addPinterestKeys(style, boardUrl, limit) {
  const variants = [
    { algorithm: 'pinterestCacheKey:v2', limit, hash_index: pinterestCacheKey(boardUrl, limit) },
    { algorithm: 'pinterestCacheKey:legacy', limit, hash_index: legacyPinterestCacheKey(boardUrl, limit) }
  ];
  for (const variant of variants) {
    style.pinterest_cache_keys = add(style.pinterest_cache_keys, variant.hash_index);
    if (!style.pinterest_cache_indexes.some((item) => item.hash_index === variant.hash_index)) {
      style.pinterest_cache_indexes.push(variant);
    }
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function mergeGeneration(left = {}, right) {
  return {
    ...left,
    ...right,
    job_ids: uniq([...(left.job_ids ?? []), ...(right.job_ids ?? [])]),
    artifact_paths: uniq([...(left.artifact_paths ?? []), ...(right.artifact_paths ?? [])])
  };
}

function sortStyle(style) {
  return {
    ...style,
    agent_jobs: style.agent_jobs.sort((a, b) => a.job_id.localeCompare(b.job_id)),
    generations: sortObject(style.generations)
  };
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function add(list, value, keep = true) {
  return keep && value ? uniq([...list, value]) : list;
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function rel(root, filePath) {
  const resolved = path.resolve(path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath));
  const base = path.resolve(root);
  return resolved.startsWith(base) ? path.relative(base, resolved) : path.relative(repoRoot, resolved);
}

async function readJsonFiles(dir) {
  const names = await safeReaddir(dir);
  const out = [];
  for (const name of names.filter((item) => item.endsWith('.json'))) {
    const filePath = path.join(dir, name);
    const data = await readJson(filePath);
    if (data) out.push({ path: filePath, data });
  }
  return out;
}

async function safeReaddir(dir) {
  return readdir(dir).catch(() => []);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dictionary = await buildCacheDictionary();
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(dictionary, null, 2)}\n`);
  console.log(`Wrote ${path.relative(repoRoot, outPath)}`);
  console.log(`${Object.keys(dictionary.by_pinterest_url).length} Pinterest styles, ${Object.keys(dictionary.generation_to_style).length} attributed generations`);
}
