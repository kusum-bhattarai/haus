#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import { Layer1ValidationError, createLayer1Payload } from '../src/layer1/index.js';

function usage() {
  return [
    'Usage:',
    '  npm run layer1:create-payload -- --input ./input.json',
    '',
    'Input JSON fields:',
    '  floor_plan_image, pinterest_board_url, brief, objects, platform'
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      args.input = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.input) {
  console.error(usage());
  process.exit(1);
}

try {
  const input = JSON.parse(await readFile(args.input, 'utf8'));
  const payload = await createLayer1Payload(input);
  console.log(JSON.stringify(payload, null, 2));
} catch (error) {
  if (error instanceof Layer1ValidationError) {
    console.error(JSON.stringify({ error: error.message, details: error.details }, null, 2));
    process.exit(2);
  }

  console.error(error);
  process.exit(1);
}
