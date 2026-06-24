#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("swarmtree")
  .description("Manage parallel agent tasks with git worktrees.")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize swarmtree in the current repository checkout.")
  .action(() => {
    console.log("swarmtree init is not implemented yet.");
  });

program.parse(process.argv);
