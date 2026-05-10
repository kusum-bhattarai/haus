#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import { listStyleLibrary, writeStyleLibraryEntry } from '../src/layer3/index.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.fromHandoff) {
    const handoff = JSON.parse(await readFile(args.fromHandoff, 'utf8'));
    const entry = await writeStyleLibraryEntry(handoff);
    console.log(JSON.stringify({ style_id: entry.style_id, path: entry.path }, null, 2));
    return;
  }

  const index = await listStyleLibrary();
  console.log(JSON.stringify(index, null, 2));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--from-handoff') args.fromHandoff = argv[++i];
  }
  return args;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
