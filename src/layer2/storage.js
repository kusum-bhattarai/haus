import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_CACHE_DIR } from '../layer1/constants.js';

export function createLayer2Storage(options = {}) {
  const rootDir = path.resolve(options.cacheDir ?? DEFAULT_CACHE_DIR);
  const pinterestDir = path.join(rootDir, 'pinterest');
  const aestheticDir = path.join(rootDir, 'aesthetic');
  const floorPlanDir = path.join(rootDir, 'floor-plan-structure');
  const profilesDir = path.join(rootDir, 'layer2-profiles');

  return {
    rootDir,
    pinterestDir,
    aestheticDir,
    floorPlanDir,
    profilesDir,

    async readJson(kind, key) {
      const filePath = path.join(directoryForKind(kind), `${key}.json`);
      try {
        return JSON.parse(await readFile(filePath, 'utf8'));
      } catch {
        return null;
      }
    },

    async writeJson(kind, key, value) {
      const dir = directoryForKind(kind);
      await mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${key}.json`);
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
      return filePath;
    }
  };

  function directoryForKind(kind) {
    if (kind === 'pinterest') return pinterestDir;
    if (kind === 'aesthetic') return aestheticDir;
    if (kind === 'floor_plan') return floorPlanDir;
    if (kind === 'profile') return profilesDir;
    throw new Error(`Unknown Layer 2 cache kind: ${kind}`);
  }
}
