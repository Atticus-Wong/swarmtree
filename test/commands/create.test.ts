import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

import { createTask } from "../../src/commands/create.js";
import { init } from "../../src/commands/init.js";
import { captureConsole, createGitRepo, readYamlFile } from "../helpers.js";

describe("create command", () => {
  it("creates a task branch, worktree, and task record", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo, worktreeRoot: "worktrees" });
    const baseCommit = (await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
    const consoleCapture = captureConsole();
    const date = formatLocalDate(new Date());

    await createTask({ cwd: repo, owner: "atticus", title: "Add list command tests" });

    const taskFiles = await readdir(path.join(repo, ".swarmtree", "tasks"));
    expect(taskFiles).toEqual([`${date.compact}-add-list-command-tests.yml`]);

    const task = await readYamlFile<Record<string, unknown>>(
      path.join(repo, ".swarmtree", "tasks", taskFiles[0]),
    );
    const worktreePath = path.resolve(repo, "worktrees/add-list-command-tests");
    const worktreeBranch = (
      await execa("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: worktreePath })
    ).stdout.trim();

    expect(task).toMatchObject({
      baseCommit,
      branch: `swarm/${date.dashed}-add-list-command-tests`,
      id: `${date.compact}-add-list-command-tests`,
      owner: "atticus",
      slug: "add-list-command-tests",
      status: "created",
      title: "Add list command tests",
      worktreePath: "worktrees/add-list-command-tests",
    });
    expect(existsSync(worktreePath)).toBe(true);
    expect(worktreeBranch).toBe(`swarm/${date.dashed}-add-list-command-tests`);
    expect(consoleCapture.output().logs).toEqual(
      expect.arrayContaining([
        `Created task ${date.compact}-add-list-command-tests`,
        `Branch: swarm/${date.dashed}-add-list-command-tests`,
        "Worktree: worktrees/add-list-command-tests",
      ]),
    );
  });

  it("requires swarmtree to be initialized first", async () => {
    const repo = await createGitRepo();

    await expect(createTask({ cwd: repo, title: "Missing config" })).rejects.toThrow(
      "Swarmtree is not initialized. Run `swarmtree init` first.",
    );
  });
});

function formatLocalDate(date: Date): { compact: string; dashed: string } {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");

  return {
    compact: `${year}${month}${day}`,
    dashed: `${year}-${month}-${day}`,
  };
}
