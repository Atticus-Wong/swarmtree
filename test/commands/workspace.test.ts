import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { initWorkspace } from "../../src/commands/workspace.js";
import { captureConsole, makeTempDir, readYamlFile } from "../helpers.js";

describe("workspace command", () => {
  it("creates a workspace with main and worktrees directories", async () => {
    const cwd = await makeTempDir("swarmtree-workspaces-");
    const consoleCapture = captureConsole();

    await initWorkspace({ cwd, name: "demo" });

    const workspaceRoot = path.join(cwd, "demo");
    const config = await readYamlFile<Record<string, unknown>>(
      path.join(workspaceRoot, "main", ".swarmtree", "config.yml"),
    );

    expect(existsSync(path.join(workspaceRoot, "main", ".git"))).toBe(true);
    expect(existsSync(path.join(workspaceRoot, "main", ".swarmtree", "tasks"))).toBe(true);
    expect(existsSync(path.join(workspaceRoot, "worktrees"))).toBe(true);
    expect(config.worktreeRoot).toBe("../worktrees");
    expect(consoleCapture.output().logs).toEqual(
      expect.arrayContaining([
        "Workspace: demo",
        "Main checkout: demo/main",
        "Worktrees: demo/worktrees",
      ]),
    );
  });

  it("requires a workspace name", async () => {
    const cwd = await makeTempDir("swarmtree-workspaces-");

    await expect(initWorkspace({ cwd })).rejects.toThrow(
      "Usage: swarmtree workspace init [repo-url] <name>",
    );
  });
});
