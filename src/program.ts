import { createRequire } from "node:module";

import { Command } from "commander";

import { createTask } from "./commands/create.js";
import { done } from "./commands/done.js";
import { init } from "./commands/init.js";
import { list } from "./commands/list.js";
import { show } from "./commands/show.js";
import { start } from "./commands/start.js";
import { status } from "./commands/status.js";
import { initWorkspace } from "./commands/workspace.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

export function createProgram(): Command {
  const program = new Command();

  program
    .name("swarmtree")
    .description("Manage parallel agent tasks with git worktrees.")
    .version(packageJson.version);

  program
    .command("init")
    .description("Initialize swarmtree in the current repository checkout.")
    .action(async () => {
      await init();
    });

  program
    .command("create")
    .description("Create a task branch, worktree, and repo-local task record.")
    .argument("<title>", "Task title")
    .option("--base <ref>", "Git ref or commit to branch from")
    .option("--owner <owner>", "Owner recorded on the task")
    .action(async (title: string, options: { base?: string; owner?: string }) => {
      await createTask({ title, base: options.base, owner: options.owner });
    });

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

  program
    .command("list")
    .description("List swarmtree tasks.")
    .action(async () => {
      await list();
    });

  program
    .command("show")
    .description("Show a swarmtree task and its handoff prompt.")
    .argument("<task-id>", "Task ID")
    .action(async (taskId: string) => {
      await show({ taskId });
    });

  program
    .command("start")
    .description("Print a task's worktree handoff prompt.")
    .argument("<task-id>", "Task ID")
    .action(async (taskId: string) => {
      await start({ taskId });
    });

  program
    .command("done")
    .description("Mark a swarmtree task done.")
    .argument("<task-id>", "Task ID")
    .option("--validation <notes>", "Validation notes to record on the task")
    .option("--result <summary>", "Result summary to record on the task")
    .action(async (taskId: string, options: { result?: string; validation?: string }) => {
      await done({ taskId, result: options.result, validation: options.validation });
    });

  return program;
}

export function normalizeProgramArgv(argv: string[]): string[] {
  return argv[2] === "--" ? [...argv.slice(0, 2), ...argv.slice(3)] : argv;
}

export async function runProgram(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  const normalizedArgv = normalizeProgramArgv(argv);

  if (normalizedArgv.length <= 2) {
    program.outputHelp();
    return;
  }

  await program.parseAsync(normalizedArgv);
}
