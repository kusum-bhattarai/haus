#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import { createLayer3Handoff, Layer3ValidationError } from '../src/layer3/index.js';

function usage() {
  return [
    'Usage:',
    '  npm run layer3:create-handoff -- --profile ./.haus-cache/layer2-profiles/{session_id}.json',
    '',
    'Required environment for live runs:',
    '  OPENAI_API_KEY'
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--profile') {
      args.profile = argv[index + 1];
      index += 1;
    }
    if (argv[index] === '--demo') {
      args.demoMode = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.profile) {
  console.error(usage());
  process.exit(1);
}

try {
  const profile = JSON.parse(await readFile(args.profile, 'utf8'));
  const handoff = await createLayer3Handoff(profile, { demoMode: args.demoMode });
  console.log(JSON.stringify(handoff, null, 2));
} catch (error) {
  if (error instanceof Layer3ValidationError) {
    console.error(JSON.stringify({ error: error.message, details: error.details }, null, 2));
    process.exit(2);
  }

  console.error(error);
  process.exit(1);
}
