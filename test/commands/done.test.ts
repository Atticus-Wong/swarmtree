import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createTask } from "../../src/commands/create.js";
import { done } from "../../src/commands/done.js";
import { init } from "../../src/commands/init.js";
import { captureConsole, createGitRepo, readYamlFile } from "../helpers.js";

describe("done command", () => {
  it("marks a task done and records validation notes", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo, worktreeRoot: "worktrees" });
    await createTask({ cwd: repo, owner: "atticus", title: "Add done command" });
    const [taskFile] = await readdir(path.join(repo, ".swarmtree", "tasks"));
    const taskId = taskFile.replace(/\.ya?ml$/i, "");
    const now = new Date("2026-06-25T12:34:56.000Z");
    const consoleCapture = captureConsole();

    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      await done({
        cwd: repo,
        result: "Task branch is ready for review.",
        taskId,
        validation: "pnpm test passed",
      });
    } finally {
      vi.useRealTimers();
    }

    const task = await readYamlFile<Record<string, unknown>>(
      path.join(repo, ".swarmtree", "tasks", taskFile),
    );

    expect(task).toMatchObject({
      id: taskId,
      owner: "atticus",
      result: "Task branch is ready for review.",
      status: "done",
      title: "Add done command",
      updatedAt: now.toISOString(),
      validation: "pnpm test passed",
    });
    expect(consoleCapture.output().logs).toEqual([
      `Marked task ${taskId} done.`,
      `Task file: .swarmtree/tasks/${taskFile}`,
    ]);
  });

  it("can find a task by record ID when the file name differs", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo });
    const taskPath = path.join(repo, ".swarmtree", "tasks", "renamed.yml");
    await writeFile(
      taskPath,
      "id: task-from-record-id\nstatus: created\ntitle: Task from record ID\nvalidation: existing validation\n",
      "utf8",
    );

    await done({ cwd: repo, taskId: "task-from-record-id" });

    const task = await readYamlFile<Record<string, unknown>>(taskPath);
    expect(task).toMatchObject({
      id: "task-from-record-id",
      status: "done",
      title: "Task from record ID",
      validation: "existing validation",
    });
    expect(typeof task.updatedAt).toBe("string");
  });

  it("errors when the task does not exist", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo });

    await expect(done({ cwd: repo, taskId: "missing-task" })).rejects.toThrow(
      "Task not found: missing-task",
    );
  });

  it("requires swarmtree to be initialized first", async () => {
    const repo = await createGitRepo();

    await expect(done({ cwd: repo, taskId: "missing-task" })).rejects.toThrow(
      "Swarmtree is not initialized. Run `swarmtree init` first.",
    );
  });
});
