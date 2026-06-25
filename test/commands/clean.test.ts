import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { clean } from "../../src/commands/clean.js";
import { createTask } from "../../src/commands/create.js";
import { init } from "../../src/commands/init.js";
import { captureConsole, createGitRepo } from "../helpers.js";

describe("clean command", () => {
  it("removes a done task worktree after explicit confirmation", async () => {
    const repo = await createDoneTaskRepo("Remove done worktree");
    const taskId = await getOnlyTaskId(repo);
    const worktreePath = path.join(repo, "worktrees", "remove-done-worktree");
    const consoleCapture = captureConsole();

    await clean({ cwd: repo, taskId, yes: true });

    const worktreeList = (await execa("git", ["worktree", "list"], { cwd: repo })).stdout;
    expect(existsSync(worktreePath)).toBe(false);
    expect(worktreeList).not.toContain(worktreePath);
    expect(consoleCapture.output().logs).toEqual(["Removed worktree: worktrees/remove-done-worktree"]);
  });

  it("requires a done task before removing the worktree", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo, worktreeRoot: "worktrees" });
    await createTask({ cwd: repo, title: "Incomplete task" });
    const taskId = await getOnlyTaskId(repo);

    await expect(clean({ cwd: repo, taskId, yes: true })).rejects.toThrow(
      `Task must be done before cleaning: ${taskId} (status: created)`,
    );
    expect(existsSync(path.join(repo, "worktrees", "incomplete-task"))).toBe(true);
  });

  it("requires explicit confirmation", async () => {
    const repo = await createDoneTaskRepo("Needs confirmation");
    const taskId = await getOnlyTaskId(repo);

    await expect(clean({ cwd: repo, taskId })).rejects.toThrow(
      "Cleanup requires explicit confirmation. Re-run with --yes to remove the worktree.",
    );
    expect(existsSync(path.join(repo, "worktrees", "needs-confirmation"))).toBe(true);
  });

  it("refuses to clean dirty task worktrees", async () => {
    const repo = await createDoneTaskRepo("Dirty worktree");
    const taskId = await getOnlyTaskId(repo);
    await writeFile(path.join(repo, "worktrees", "dirty-worktree", "notes.txt"), "dirty\n", "utf8");

    await expect(clean({ cwd: repo, taskId, yes: true })).rejects.toThrow(
      "Refusing to clean dirty task worktree: worktrees/dirty-worktree",
    );
    expect(existsSync(path.join(repo, "worktrees", "dirty-worktree"))).toBe(true);
  });

  it("refuses to delete unmerged branches", async () => {
    const repo = await createDoneTaskRepo("Unmerged branch");
    const taskId = await getOnlyTaskId(repo);
    const worktreePath = path.join(repo, "worktrees", "unmerged-branch");
    await writeFile(path.join(worktreePath, "feature.txt"), "feature\n", "utf8");
    await execa("git", ["add", "feature.txt"], { cwd: worktreePath });
    await execa("git", ["commit", "-m", "Feature work"], { cwd: worktreePath });
    const branch = `swarm/${formatLocalDate(new Date()).dashed}-unmerged-branch`;

    await expect(clean({ cwd: repo, taskId, yes: true, deleteBranch: true })).rejects.toThrow(
      `Refusing to delete unmerged branch: ${branch}`,
    );
    expect(existsSync(worktreePath)).toBe(true);
  });

  it("deletes merged task branches when requested", async () => {
    const repo = await createDoneTaskRepo("Delete merged branch");
    const taskId = await getOnlyTaskId(repo);
    const branch = `swarm/${formatLocalDate(new Date()).dashed}-delete-merged-branch`;
    const consoleCapture = captureConsole();

    await clean({ cwd: repo, taskId, yes: true, deleteBranch: true });

    await expect(
      execa("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: repo }),
    ).rejects.toMatchObject({ exitCode: 1 });
    expect(consoleCapture.output().logs).toEqual([
      "Removed worktree: worktrees/delete-merged-branch",
      `Deleted branch: ${branch}`,
    ]);
  });

  it("requires swarmtree to be initialized first", async () => {
    const repo = await createGitRepo();

    await expect(clean({ cwd: repo, taskId: "missing-task", yes: true })).rejects.toThrow(
      "Swarmtree is not initialized. Run `swarmtree init` first.",
    );
  });
});

async function createDoneTaskRepo(title: string): Promise<string> {
  const repo = await createGitRepo();
  await init({ cwd: repo, worktreeRoot: "worktrees" });
  await createTask({ cwd: repo, title });
  await markOnlyTaskDone(repo);
  return repo;
}

async function getOnlyTaskId(repo: string): Promise<string> {
  const [taskFile] = await readdir(path.join(repo, ".swarmtree", "tasks"));
  return taskFile.replace(/\.ya?ml$/i, "");
}

async function markOnlyTaskDone(repo: string): Promise<void> {
  const [taskFile] = await readdir(path.join(repo, ".swarmtree", "tasks"));
  const taskPath = path.join(repo, ".swarmtree", "tasks", taskFile);
  const task = YAML.parse(await readFile(taskPath, "utf8")) as Record<string, unknown>;
  task.status = "done";
  task.updatedAt = new Date().toISOString();
  await writeFile(taskPath, YAML.stringify(task), "utf8");
}

function formatLocalDate(date: Date): { dashed: string } {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");

  return {
    dashed: `${year}-${month}-${day}`,
  };
}
