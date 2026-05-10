import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_CACHE_DIR } from '../layer1/constants.js';

export function styleIdFromHandoff(handoff) {
  const name = handoff.vibe_report?.aesthetic_name ?? 'style';
  const board = handoff.source_input?.pinterest_board_url ?? handoff.pinterest_intelligence?.pins?.[0]?.source_url ?? '';
  const slug = slugify(name);
  const suffix = hashString(board).slice(0, 8);
  return `${slug}-${suffix}`;
}

export async function writeStyleLibraryEntry(handoff, options = {}) {
  const rootDir = path.resolve(options.cacheDir ?? DEFAULT_CACHE_DIR, 'style-library');
  await mkdir(rootDir, { recursive: true });

  const styleId = styleIdFromHandoff(handoff);
  const entry = {
    schema_version: '1.0',
    style_id: styleId,
    created_at: new Date().toISOString(),
    source: {
      session_id: handoff.session_id,
      handoff_id: handoff.handoff_id,
      pinterest_board_url: handoff.source_input?.pinterest_board_url ?? null,
      floor_plan_url: handoff.source_input?.floor_plan_url ?? null
    },
    aesthetic_profile: handoff.pinterest_intelligence?.aesthetic_profile ?? null,
    vibe_report: handoff.vibe_report,
    creative_spec: handoff.creative_spec,
    pins: handoff.pinterest_intelligence?.pins ?? [],
    cluster_summary: handoff.pinterest_intelligence?.cluster_summary ?? [],
    room_guidance: handoff.vibe_report?.room_guidance ?? []
  };

  const filePath = path.join(rootDir, `${styleId}.json`);
  await writeFile(filePath, `${JSON.stringify(entry, null, 2)}\n`);
  await writeStyleIndex(rootDir);
  return { ...entry, path: filePath };
}

export async function listStyleLibrary(options = {}) {
  const rootDir = path.resolve(options.cacheDir ?? DEFAULT_CACHE_DIR, 'style-library');
  const indexPath = path.join(rootDir, 'index.json');
  try {
    return JSON.parse(await readFile(indexPath, 'utf8'));
  } catch {
    return { schema_version: '1.0', styles: [] };
  }
}

async function writeStyleIndex(rootDir) {
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(rootDir)).filter((file) => file.endsWith('.json') && file !== 'index.json');
  const styles = [];
  for (const file of files.sort()) {
    const entry = JSON.parse(await readFile(path.join(rootDir, file), 'utf8'));
    styles.push({
      style_id: entry.style_id,
      aesthetic_name: entry.vibe_report?.aesthetic_name ?? entry.style_id,
      summary: entry.vibe_report?.summary ?? '',
      pinterest_board_url: entry.source?.pinterest_board_url ?? null,
      path: path.join(rootDir, file)
    });
  }
  await writeFile(path.join(rootDir, 'index.json'), `${JSON.stringify({ schema_version: '1.0', styles }, null, 2)}\n`);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'style';
}

function hashString(value) {
  let hash = 5381;
  for (const char of String(value)) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  return hash.toString(16).padStart(8, '0');
}
