import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { init } from "../../src/commands/init.js";
import { list } from "../../src/commands/list.js";
import { captureConsole, createGitRepo } from "../helpers.js";

describe("list command", () => {
  it("prints an empty-state message when no tasks exist", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo });
    const consoleCapture = captureConsole();

    await list({ cwd: repo });

    expect(consoleCapture.output().logs).toEqual(["No swarmtree tasks found."]);
  });

  it("prints task records sorted by status and timestamp", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo });
    const tasksDir = path.join(repo, ".swarmtree", "tasks");
    await mkdir(tasksDir, { recursive: true });
    await writeFile(
      path.join(tasksDir, "done.yml"),
      YAML.stringify({
        branch: "swarm/done",
        createdAt: "2026-06-24T10:00:00.000Z",
        id: "done-task",
        owner: "alex",
        status: "done",
        title: "Done task",
        worktreePath: "../worktrees/done",
      }),
      "utf8",
    );
    await writeFile(
      path.join(tasksDir, "todo.yml"),
      YAML.stringify({
        branch: "swarm/todo",
        createdAt: "2026-06-24T09:00:00.000Z",
        id: "todo-task",
        owner: "atticus",
        status: "todo",
        title: "Todo task",
        worktreePath: "../worktrees/todo",
      }),
      "utf8",
    );
    const consoleCapture = captureConsole();

    await list({ cwd: repo });

    const logs = consoleCapture.output().logs;
    expect(logs[0]).toContain("Status");
    expect(logs[0]).toContain("Title");
    expect(logs[2]).toContain("todo");
    expect(logs[2]).toContain("todo-task");
    expect(logs[2]).toContain("Todo task");
    expect(logs[3]).toContain("done");
    expect(logs[3]).toContain("done-task");
    expect(logs[3]).toContain("Done task");
  });
});
