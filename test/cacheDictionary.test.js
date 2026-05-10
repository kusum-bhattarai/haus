import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildCacheDictionary } from '../scripts/cache-dictionary.js';

test('maps generation hashes to Pinterest style and current plus legacy pin indexes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'haus-cache-dict-'));
  const boardUrl = 'https://www.pinterest.com/tarive22/japandi-interior-design/';
  const generationId = 'abc123';

  await writeJson(path.join(root, 'layer2-profiles/session-1.json'), {
    session_id: 'session-1',
    profile_id: 'profile-1',
    source_payload: { pinterest_board_url: boardUrl },
    provenance: { pinterest: { requested_limit: 20 } }
  });
  await writeJson(path.join(root, 'layer3-handoffs/session-1.json'), {
    session_id: 'session-1',
    handoff_id: 'handoff-1',
    source_input: { pinterest_board_url: boardUrl },
    vibe_report: { aesthetic_name: 'Warm Japandi' },
    room_generation_jobs: [{ room_id: 'living' }]
  });
  await writeJson(path.join(root, 'agent/jobs/job-1/job.json'), {
    job_id: 'job-1',
    input: { pinterest_board_url: boardUrl, floor_plan_id: 'plan-1' },
    handoff: { vibe_report: { aesthetic_name: 'Warm Japandi' }, source_input: { pinterest_board_url: boardUrl } },
    rooms: [{ room_id: 'living', room_name: 'Living', artifacts: { styled_image_path: `.haus-cache/agent/generations/${generationId}/still-0.png` } }]
  });
  await writeJson(path.join(root, 'agent/generations', generationId, 'request.json'), { endpoint_id: 'fal-ai/nano-banana-2' });
  await writeJson(path.join(root, 'pinterest', `${legacyPinterestHash(boardUrl, 20)}.json`), []);

  const dictionary = await buildCacheDictionary({ cacheRoot: root });
  const style = dictionary.by_pinterest_url[boardUrl];

  assert.equal(style.generations[generationId].room_id, 'living');
  assert.equal(dictionary.generation_to_style[generationId].style_name, 'Warm Japandi');
  assert.ok(style.pinterest_cache_indexes.some((item) => item.algorithm === 'pinterestCacheKey:v2'));
  assert.ok(style.pinterest_cache_indexes.some((item) => item.algorithm === 'pinterestCacheKey:legacy' && item.file));
});

function legacyPinterestHash(boardUrl, limit) {
  return createHash('sha256').update(JSON.stringify({ boardUrl, limit })).digest('hex');
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
