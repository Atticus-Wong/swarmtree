import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { init } from "../../src/commands/init.js";
import { show } from "../../src/commands/show.js";
import { captureConsole, createGitRepo } from "../helpers.js";

describe("show command", () => {
  it("prints task details and the recorded handoff prompt", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo });
    const tasksDir = path.join(repo, ".swarmtree", "tasks");
    const handoffPrompt = `Task: Add show command
Branch: swarm/2026-06-24-add-show-command
Worktree: ../worktrees/add-show-command

cd ../worktrees/add-show-command

Agent instruction:
Use the task worktree.`;

    await writeFile(
      path.join(tasksDir, "20260624-add-show-command.yml"),
      YAML.stringify({
        baseCommit: "abc123",
        baseRef: "main",
        branch: "swarm/2026-06-24-add-show-command",
        createdAt: "2026-06-24T09:00:00.000Z",
        handoffPrompt,
        id: "20260624-add-show-command",
        notes: ["Needs CLI registration"],
        owner: "atticus",
        result: "pending",
        status: "created",
        title: "Add show command",
        updatedAt: "2026-06-24T10:00:00.000Z",
        validation: "pnpm test",
        worktreePath: "../worktrees/add-show-command",
      }),
      "utf8",
    );
    const consoleCapture = captureConsole();

    await show({ cwd: repo, taskId: "20260624-add-show-command" });

    const logs = consoleCapture.output().logs;
    expect(logs).toContain("Task: Add show command");
    expect(logs).toContain("ID: 20260624-add-show-command");
    expect(logs).toContain("Status: created");
    expect(logs).toContain("Owner: atticus");
    expect(logs).toContain("Branch: swarm/2026-06-24-add-show-command");
    expect(logs).toContain("Worktree: ../worktrees/add-show-command");
    expect(logs).toContain("Base: main (abc123)");
    expect(logs).toContain("- Needs CLI registration");
    expect(logs).toContain("pnpm test");
    expect(logs).toContain("Handoff prompt:");
    expect(logs).toContain(handoffPrompt);
  });

  it("can find a task by the record ID when the file name differs", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo });
    const tasksDir = path.join(repo, ".swarmtree", "tasks");
    await writeFile(
      path.join(tasksDir, "renamed-task.yml"),
      YAML.stringify({
        branch: "swarm/renamed",
        id: "task-from-record-id",
        status: "todo",
        title: "Task from record ID",
        worktreePath: "../worktrees/renamed",
      }),
      "utf8",
    );
    const consoleCapture = captureConsole();

    await show({ cwd: repo, taskId: "task-from-record-id" });

    const logs = consoleCapture.output().logs;
    expect(logs).toContain("Task: Task from record ID");
    expect(logs).toContain("Handoff prompt:");
    expect(logs).toContain(`Task: Task from record ID
Branch: swarm/renamed
Worktree: ../worktrees/renamed

cd ../worktrees/renamed

Agent instruction:
You are working in an isolated git worktree for this task. Do not modify sibling worktrees. Do not revert changes you did not make. Read project instructions before editing.`);
  });

  it("prints placeholders for missing optional fields", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo });
    const tasksDir = path.join(repo, ".swarmtree", "tasks");
    await mkdir(tasksDir, { recursive: true });
    await writeFile(
      path.join(tasksDir, "partial.yml"),
      YAML.stringify({
        id: "partial",
        title: "Partial task",
      }),
      "utf8",
    );
    const consoleCapture = captureConsole();

    await show({ cwd: repo, taskId: "partial" });

    const logs = consoleCapture.output().logs;
    expect(logs).toContain("Task: Partial task");
    expect(logs).toContain("Status: -");
    expect(logs).toContain("Notes:");
    expect(logs).toContain("-");
    expect(logs.at(-1)).toBe("-");
  });

  it("errors when the task does not exist", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo });

    await expect(show({ cwd: repo, taskId: "missing-task" })).rejects.toThrow(
      "Task not found: missing-task",
    );
  });

  it("requires swarmtree to be initialized first", async () => {
    const repo = await createGitRepo();

    await expect(show({ cwd: repo, taskId: "missing-task" })).rejects.toThrow(
      "Swarmtree is not initialized. Run `swarmtree init` first.",
    );
  });
});
