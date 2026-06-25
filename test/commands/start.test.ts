import { readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { createTask } from "../../src/commands/create.js";
import { init } from "../../src/commands/init.js";
import { start } from "../../src/commands/start.js";
import { captureConsole, createGitRepo } from "../helpers.js";

describe("start command", () => {
  it("prints the handoff prompt for an existing task worktree", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo, worktreeRoot: "worktrees" });
    await createTask({ cwd: repo, owner: "atticus", title: "Add start command" });
    const [taskFile] = await readdir(path.join(repo, ".swarmtree", "tasks"));
    const taskId = taskFile.replace(/\.ya?ml$/i, "");
    const consoleCapture = captureConsole();

    await start({ cwd: repo, taskId });

    const date = formatLocalDate(new Date());
    expect(consoleCapture.output().logs).toEqual([
      `Task: Add start command
Branch: swarm/${date.dashed}-add-start-command
Worktree: worktrees/add-start-command

cd worktrees/add-start-command

Agent instruction:
You are working in an isolated git worktree for this task. Do not modify sibling worktrees. Do not revert changes you did not make. Read project instructions before editing.`,
    ]);
  });

  it("can find a task by record ID and build a handoff prompt when none is stored", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo, worktreeRoot: "worktrees" });
    await execa("git", ["worktree", "add", "-b", "swarm/manual", "worktrees/manual-task", "HEAD"], {
      cwd: repo,
    });
    await writeFile(
      path.join(repo, ".swarmtree", "tasks", "renamed.yml"),
      YAML.stringify({
        branch: "swarm/manual",
        id: "manual-task",
        title: "Manual task",
        worktreePath: "worktrees/manual-task",
      }),
      "utf8",
    );
    const consoleCapture = captureConsole();

    await start({ cwd: repo, taskId: "manual-task" });

    expect(consoleCapture.output().logs).toEqual([
      `Task: Manual task
Branch: swarm/manual
Worktree: worktrees/manual-task

cd worktrees/manual-task

Agent instruction:
You are working in an isolated git worktree for this task. Do not modify sibling worktrees. Do not revert changes you did not make. Read project instructions before editing.`,
    ]);
  });

  it("errors when the task worktree is missing", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo, worktreeRoot: "worktrees" });
    await createTask({ cwd: repo, title: "Missing worktree" });
    const [taskFile] = await readdir(path.join(repo, ".swarmtree", "tasks"));
    const taskId = taskFile.replace(/\.ya?ml$/i, "");
    await rm(path.join(repo, "worktrees", "missing-worktree"), { force: true, recursive: true });

    await expect(start({ cwd: repo, taskId })).rejects.toThrow("Task worktree does not exist:");
  });

  it("errors when the task worktree is on a different branch", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo, worktreeRoot: "worktrees" });
    await createTask({ cwd: repo, title: "Wrong branch" });
    const [taskFile] = await readdir(path.join(repo, ".swarmtree", "tasks"));
    const taskId = taskFile.replace(/\.ya?ml$/i, "");
    await execa("git", ["checkout", "-b", "manual/wrong-branch"], {
      cwd: path.join(repo, "worktrees", "wrong-branch"),
    });

    await expect(start({ cwd: repo, taskId })).rejects.toThrow(
      `Expected task ${taskId} worktree to be on swarm/${formatLocalDate(new Date()).dashed}-wrong-branch, but found manual/wrong-branch.`,
    );
  });

  it("requires swarmtree to be initialized first", async () => {
    const repo = await createGitRepo();

    await expect(start({ cwd: repo, taskId: "missing-task" })).rejects.toThrow(
      "Swarmtree is not initialized. Run `swarmtree init` first.",
    );
  });
});

function formatLocalDate(date: Date): { dashed: string } {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");

  return {
    dashed: `${year}-${month}-${day}`,
  };
}
