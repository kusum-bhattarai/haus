import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { fal } from '@fal-ai/client';

import { DEFAULT_CACHE_DIR } from '../layer1/constants.js';
import { hashJson } from './cacheKeys.js';

function configureFal(options = {}) {
  const key = options.falKey ?? process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY is required. Add it to your .env file.');
  fal.config({ credentials: key });
}

export function createGenmediaAdapter(options = {}) {
  let configured = false;
  function ensureConfigured() {
    if (!configured) {
      configureFal(options);
      configured = true;
    }
  }

  const rootDir = path.resolve(options.cacheDir ?? DEFAULT_CACHE_DIR, 'agent');
  const generationsDir = path.join(rootDir, 'generations');
  const uploadsDir = path.join(rootDir, 'uploads');

  return {
    async schema(endpointId) {
      return {};
    },

    async pricing(endpointId) {
      return {};
    },

    async upload(target) {
      const key = await uploadKey(target);
      const cachePath = path.join(uploadsDir, `${key}.json`);
      const cached = await readJson(cachePath);
      if (cached?.url) return { ...cached, cache_hit: true };

      ensureConfigured();
      const fileBuffer = await readFile(target);
      const filename = path.basename(target);
      const blob = new Blob([fileBuffer], { type: mimeFromPath(target) });

      const uploadedUrl = await fal.storage.upload(blob, { filename });
      const url = typeof uploadedUrl === 'string' ? uploadedUrl : uploadedUrl?.url ?? String(uploadedUrl);

      const payload = { url, target };
      await writeJson(cachePath, payload);
      return { ...payload, cache_hit: false };
    },

    async run(endpointId, params, { onProgress, timeoutMs = 8 * 60 * 1000 } = {}) {
      if (options.falRunner) {
        return options.falRunner(endpointId, params);
      }
      ensureConfigured();

      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`fal generation timed out after ${Math.round(timeoutMs / 1000)}s on ${endpointId}`)),
          timeoutMs
        );
      });

      try {
        const result = await Promise.race([
          fal.subscribe(endpointId, {
            input: params,
            logs: false,
            onQueueUpdate: onProgress ?? null
          }),
          timeoutPromise
        ]);
        return result?.data ?? result;
      } finally {
        clearTimeout(timeoutId);
      }
    },

    async executeCached({ endpointId, params, sourcePaths = [], skillVersion = null, artifactName = 'artifact', onProgress, timeoutMs }) {
      const sourceHashes = await Promise.all(sourcePaths.filter(Boolean).map(fileHash));
      const cacheKey = hashJson({ endpointId, params, sourceHashes, skillVersion });
      const generationDir = path.join(generationsDir, cacheKey);
      const requestPath = path.join(generationDir, 'request.json');
      const resultPath = path.join(generationDir, 'result.json');

      const cached = await readJson(resultPath);
      const cachedArtifact = cached ? await findArtifact(generationDir) : null;
      const cachedUrl = cached ? extractFirstMediaUrl(cached) : null;

      if (cached && (cachedArtifact || cachedUrl)) {
        return {
          cache_hit: true,
          cache_key: cacheKey,
          endpoint_id: endpointId,
          result: cached,
          path: cachedArtifact,
          url: cachedUrl
        };
      }

      await mkdir(generationDir, { recursive: true });
      await writeJson(requestPath, { endpoint_id: endpointId, params, source_hashes: sourceHashes, skill_version: skillVersion });

      const result = await this.run(endpointId, params, { onProgress, timeoutMs });
      await writeJson(resultPath, result);

      const url = extractFirstMediaUrl(result);
      let localPath = null;
      if (url) {
        const ext = extFromUrl(url);
        localPath = path.join(generationDir, `${artifactName}-0.${ext}`);
        const dl = options.downloadFn ?? downloadUrl;
        await dl(url, localPath).catch((err) => {
          console.warn(`[genmedia] download failed (url cached): ${err.message}`);
          localPath = null;
        });
      }

      return {
        cache_hit: false,
        cache_key: cacheKey,
        endpoint_id: endpointId,
        result,
        path: localPath,
        url
      };
    }
  };
}

export function extractFirstMediaUrl(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.url === 'string') return value.url;
  if (typeof value.video?.url === 'string') return value.video.url;
  if (Array.isArray(value.images) && typeof value.images[0]?.url === 'string') return value.images[0].url;
  if (typeof value.image?.url === 'string') return value.image.url;
  if (typeof value.file?.url === 'string') return value.file.url;

  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') {
      const found = extractFirstMediaUrl(nested);
      if (found) return found;
    }
  }
  return null;
}

async function downloadUrl(url, destPath) {
  await mkdir(path.dirname(destPath), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
  const writer = createWriteStream(destPath);
  await pipeline(response.body, writer);
}

function extFromUrl(url) {
  const pathname = new URL(url).pathname;
  const ext = path.extname(pathname).slice(1);
  if (ext && /^[a-z0-9]+$/i.test(ext)) return ext;
  if (url.includes('video') || url.includes('.mp4')) return 'mp4';
  return 'png';
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function uploadKey(target) {
  try {
    const fileStat = await stat(target);
    if (fileStat.isFile()) return fileHash(target);
  } catch {
    // Remote URLs keyed by value.
  }
  return createHash('sha256').update(target).digest('hex');
}

async function fileHash(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function findArtifact(dir) {
  try {
    const entries = await readdir(dir);
    const artifact = entries.find((entry) => entry.startsWith('artifact-') || entry.startsWith('still-') || entry.startsWith('video-'));
    return artifact ? path.join(dir, artifact) : null;
  } catch {
    return null;
  }
}
