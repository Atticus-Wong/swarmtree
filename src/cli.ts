#!/usr/bin/env node

import { runProgram } from "./program.js";

runProgram().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
