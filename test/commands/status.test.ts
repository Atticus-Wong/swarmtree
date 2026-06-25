import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

import { createTask } from "../../src/commands/create.js";
import { init } from "../../src/commands/init.js";
import { status } from "../../src/commands/status.js";
import { captureConsole, createGitRepo } from "../helpers.js";

describe("status command", () => {
  it("reports real git status from a task worktree", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo, worktreeRoot: "worktrees" });
    const baseBranch = (await execa("git", ["branch", "--show-current"], { cwd: repo })).stdout.trim();
    await createTask({ cwd: repo, owner: "atticus", title: "Add status command" });
    const taskId = await getOnlyTaskId(repo);
    const worktreePath = path.join(repo, "worktrees", "add-status-command");
    const branch = (
      await execa("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: worktreePath })
    ).stdout.trim();

    await writeFile(path.join(worktreePath, "implemented.txt"), "implemented\n", "utf8");
    await execa("git", ["add", "implemented.txt"], { cwd: worktreePath });
    await execa("git", ["commit", "-m", "Implement status command"], { cwd: worktreePath });
    await writeFile(path.join(worktreePath, "dirty.txt"), "uncommitted\n", "utf8");

    const head = (await execa("git", ["rev-parse", "--short", "HEAD"], { cwd: worktreePath })).stdout.trim();
    const consoleCapture = captureConsole();

    await status({ cwd: repo, taskId });

    const logs = consoleCapture.output().logs;
    expect(logs).toContain("Task: Add status command");
    expect(logs).toContain(`ID: ${taskId}`);
    expect(logs).toContain("Task status: created");
    expect(logs).toContain("Owner: atticus");
    expect(logs).toContain(`Recorded branch: ${branch}`);
    expect(logs).toContain(`Current branch: ${branch}`);
    expect(logs).toContain(`Worktree: ${worktreePath}`);
    expect(logs).toContain(`HEAD: ${head}`);
    expect(logs).toContain(`Compare ref: ${baseBranch}`);
    expect(logs).toContain("Ahead: 1");
    expect(logs).toContain("Behind: 0");
    expect(logs).toContain("Git status:");
    expect(logs).toContain("?? dirty.txt");
  });

  it("prints clean when the task worktree has no pending changes", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo, worktreeRoot: "worktrees" });
    await createTask({ cwd: repo, owner: "atticus", title: "Clean task" });
    const taskId = await getOnlyTaskId(repo);
    const consoleCapture = captureConsole();

    await status({ cwd: repo, taskId });

    const logs = consoleCapture.output().logs;
    expect(logs).toContain("Task: Clean task");
    expect(logs).toContain("Ahead: 0");
    expect(logs).toContain("Behind: 0");
    expect(logs).toContain("Git status:");
    expect(logs).toContain("clean");
  });

  it("errors when the task does not exist", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo });

    await expect(status({ cwd: repo, taskId: "missing-task" })).rejects.toThrow(
      "Task not found: missing-task",
    );
  });
});

async function getOnlyTaskId(repo: string): Promise<string> {
  const files = await readdir(path.join(repo, ".swarmtree", "tasks"));
  expect(files).toHaveLength(1);
  return files[0].replace(/\.ya?ml$/i, "");
}
