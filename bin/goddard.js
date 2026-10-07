#!/usr/bin/env node
import { main } from '../src/cli.js';

main().catch(error => {
  console.error(`Goddard: ${error.message}`);
  process.exitCode = 1;
});
