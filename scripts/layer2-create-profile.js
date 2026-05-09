#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import { loadEnvFile } from '../src/env.js';
import { createLayer2Profile, Layer2ValidationError } from '../src/layer2/index.js';

loadEnvFile();

function usage() {
  return [
    'Usage:',
    '  npm run layer2:create-profile -- --payload ./.haus-cache/payloads/{session_id}.json',
    '',
    'Required environment for live runs:',
    '  OPENAI_API_KEY',
    '  APIFY_TOKEN',
    '  APIFY_PINTEREST_ACTOR_ID'
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--payload') {
      args.payload = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.payload) {
  console.error(usage());
  process.exit(1);
}

try {
  const payload = JSON.parse(await readFile(args.payload, 'utf8'));
  const profile = await createLayer2Profile(payload);
  console.log(JSON.stringify(profile, null, 2));
} catch (error) {
  if (error instanceof Layer2ValidationError) {
    console.error(JSON.stringify({ error: error.message, details: error.details }, null, 2));
    process.exit(2);
  }

  console.error(error);
  process.exit(1);
}
