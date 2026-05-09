import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_CACHE_DIR } from '../layer1/constants.js';

export function createLayer3Storage(options = {}) {
  const rootDir = path.resolve(options.cacheDir ?? DEFAULT_CACHE_DIR);
  const creativePlansDir = path.join(rootDir, 'layer3-creative-plans');
  const handoffsDir = path.join(rootDir, 'layer3-handoffs');

  return {
    creativePlansDir,
    handoffsDir,

    async readCreativePlan(cacheKey) {
      try {
        return JSON.parse(await readFile(path.join(creativePlansDir, `${cacheKey}.json`), 'utf8'));
      } catch {
        return null;
      }
    },

    async writeCreativePlan(cacheKey, plan) {
      await mkdir(creativePlansDir, { recursive: true });
      const filePath = path.join(creativePlansDir, `${cacheKey}.json`);
      await writeFile(filePath, `${JSON.stringify(plan, null, 2)}\n`);
      return filePath;
    },

    async writeHandoff(sessionId, handoff) {
      await mkdir(handoffsDir, { recursive: true });
      const filePath = path.join(handoffsDir, `${sessionId}.json`);
      await writeFile(filePath, `${JSON.stringify(handoff, null, 2)}\n`);
      return filePath;
    }
  };
}
