import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { DEFAULT_CACHE_DIR } from '../layer1/constants.js';
import { hashJson } from './cacheKeys.js';

const execFileAsync = promisify(execFile);

export function createGenmediaAdapter(options = {}) {
  const rootDir = path.resolve(options.cacheDir ?? DEFAULT_CACHE_DIR, 'agent');
  const generationsDir = path.join(rootDir, 'generations');
  const uploadsDir = path.join(rootDir, 'uploads');
  const schemasDir = path.join(rootDir, 'schemas');
  const runner = options.commandRunner ?? runGenmedia;

  return {
    async schema(endpointId) {
      const key = hashJson({ endpointId });
      const cachePath = path.join(schemasDir, `${key}.json`);
      const cached = await readJson(cachePath);
      if (cached) return cached;

      const result = await runner(['schema', endpointId]);
      const parsed = parseOutput(result.stdout);
      await writeJson(cachePath, parsed);
      return parsed;
    },

    async pricing(endpointId) {
      const result = await runner(['pricing', endpointId]);
      return parseOutput(result.stdout);
    },

    async upload(target) {
      const key = await uploadKey(target);
      const cachePath = path.join(uploadsDir, `${key}.json`);
      const cached = await readJson(cachePath);
      if (cached?.url) return { ...cached, cache_hit: true };

      const result = await runner(['upload', target]);
      const parsed = parseOutput(result.stdout);
      const url = parsed.url ?? parsed.file?.url ?? firstUrl(result.stdout);
      const payload = { url, raw: parsed, target };
      await writeJson(cachePath, payload);
      return { ...payload, cache_hit: false };
    },

    async run(endpointId, params, options = {}) {
      const args = ['run'];
      if (options.async) args.push('--async');
      if (options.download) args.push(`--download=${options.download}`);
      args.push(endpointId, ...paramsToArgs(params));
      const result = await runner(args, { timeout: options.timeout });
      return parseOutput(result.stdout);
    },

    async status(endpointId, requestId, options = {}) {
      const args = ['status'];
      if (options.result) args.push('--result');
      if (options.download) args.push(`--download=${options.download}`);
      args.push(endpointId, requestId);
      const result = await runner(args, { timeout: options.timeout });
      return parseOutput(result.stdout);
    },

    async executeCached({ endpointId, params, sourcePaths = [], skillVersion = null, artifactName = 'artifact' }) {
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
      const downloadTemplate = path.join(generationDir, `${artifactName}-{index}.{ext}`);
      const result = await this.run(endpointId, params, { download: downloadTemplate });
      await writeJson(resultPath, result);

      return {
        cache_hit: false,
        cache_key: cacheKey,
        endpoint_id: endpointId,
        result,
        path: await findArtifact(generationDir),
        url: extractFirstMediaUrl(result)
      };
    }
  };
}

async function runGenmedia(args, options = {}) {
  const { stdout, stderr } = await execFileAsync('genmedia', args, {
    timeout: options.timeout ?? 20 * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024
  });
  return { stdout, stderr };
}

function paramsToArgs(params) {
  return Object.entries(params ?? {}).flatMap(([key, value]) => {
    if (value === undefined || value === null) return [];
    return [`--${key}`, typeof value === 'object' ? JSON.stringify(value) : String(value)];
  });
}

function parseOutput(stdout) {
  const text = stdout.trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, url: firstUrl(text) };
  }
}

function firstUrl(text) {
  return text.match(/https?:\/\/\S+/)?.[0] ?? null;
}

export function extractFirstMediaUrl(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.url === 'string') return value.url;
  if (typeof value.video?.url === 'string') return value.video.url;
  if (Array.isArray(value.images) && typeof value.images[0]?.url === 'string') return value.images[0].url;
  if (typeof value.image?.url === 'string') return value.image.url;
  if (typeof value.file?.url === 'string') return value.file.url;

  for (const nested of Object.values(value)) {
    const found = extractFirstMediaUrl(nested);
    if (found) return found;
  }
  return null;
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
    // Remote URLs are keyed by their value.
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
