#!/usr/bin/env node

import { Command } from "commander";

import { init } from "./commands/init.js";
import { initWorkspace } from "./commands/workspace.js";

const program = new Command();

program
  .name("swarmtree")
  .description("Manage parallel agent tasks with git worktrees.")
  .version("0.1.0");

// init command
program
  .command("init")
  .description("Initialize swarmtree in the current repository checkout.")
  .action(async () => {
    await init();
  });

// workspace command
const workspace = program
  .command("workspace")
  .description("Create and manage swarmtree workspace layouts.");

workspace
  .command("init [repo-url] [name]")
  .description("Create a workspace with main/ and worktrees/ directories.")
  .action(async (repoUrlOrName: string | undefined, name: string | undefined) => {
    await initWorkspace({
      repoUrl: name ? repoUrlOrName : undefined,
      name: name ?? repoUrlOrName,
    });
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});

// create command


// list command
