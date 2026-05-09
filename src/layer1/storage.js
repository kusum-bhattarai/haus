import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_CACHE_DIR } from './constants.js';
import { toFileUrl } from './image.js';

export function createLayer1Storage(options = {}) {
  const rootDir = path.resolve(options.cacheDir ?? DEFAULT_CACHE_DIR);
  const uploadsDir = path.join(rootDir, 'floor-plans');
  const payloadsDir = path.join(rootDir, 'payloads');
  const floorPlanVisionDir = path.join(rootDir, 'floor-plan-vision');

  return {
    rootDir,
    uploadsDir,
    payloadsDir,
    floorPlanVisionDir,

    async ensure() {
      await mkdir(uploadsDir, { recursive: true });
      await mkdir(payloadsDir, { recursive: true });
      await mkdir(floorPlanVisionDir, { recursive: true });
    },

    async cacheFloorPlan(localImage) {
      await mkdir(uploadsDir, { recursive: true });
      const cachedPath = path.join(uploadsDir, `${localImage.sha256}${localImage.extension}`);

      try {
        await readFile(cachedPath);
      } catch {
        await writeFile(cachedPath, localImage.buffer);
      }

      return {
        floor_plan_url: toFileUrl(cachedPath),
        cache_key: localImage.sha256,
        cached_path: cachedPath
      };
    },

    async writePayload(payload) {
      await mkdir(payloadsDir, { recursive: true });
      const payloadPath = path.join(payloadsDir, `${payload.session_id}.json`);
      await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`);
      return payloadPath;
    },

    async readFloorPlanVision(cacheKey) {
      const cachePath = path.join(floorPlanVisionDir, `${cacheKey}.json`);
      try {
        return JSON.parse(await readFile(cachePath, 'utf8'));
      } catch {
        return null;
      }
    },

    async writeFloorPlanVision(cacheKey, measurements) {
      await mkdir(floorPlanVisionDir, { recursive: true });
      const cachePath = path.join(floorPlanVisionDir, `${cacheKey}.json`);
      await writeFile(cachePath, `${JSON.stringify(measurements, null, 2)}\n`);
      return cachePath;
    }
  };
}
