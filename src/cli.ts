#!/usr/bin/env node

import { Command } from "commander";

import { createTask } from "./commands/create.js";
import { init } from "./commands/init.js";
import { list } from "./commands/list.js";
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

// create command
program
  .command("create")
  .description("Create a task branch, worktree, and repo-local task record.")
  .argument("<title>", "Task title")
  .option("--base <ref>", "Git ref or commit to branch from")
  .option("--owner <owner>", "Owner recorded on the task")
  .action(async (title: string, options: { base?: string; owner?: string }) => {
    await createTask({ title, base: options.base, owner: options.owner });
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

// list command
program
  .command("list")
  .description("List swarmtree tasks.")
  .action(async () => {
    await list();
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});

