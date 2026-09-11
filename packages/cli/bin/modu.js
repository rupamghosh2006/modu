#!/usr/bin/env node

import { run } from '../dist/index.js';

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
