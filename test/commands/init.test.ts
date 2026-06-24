import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { init } from "../../src/commands/init.js";
import { captureConsole, createGitRepo, readYamlFile } from "../helpers.js";

describe("init command", () => {
  it("creates the swarmtree config and tasks directory in the repo root", async () => {
    const repo = await createGitRepo();
    const consoleCapture = captureConsole();

    await init({ cwd: repo });

    const configPath = path.join(repo, ".swarmtree", "config.yml");
    const config = await readYamlFile<Record<string, unknown>>(configPath);

    expect(existsSync(path.join(repo, ".swarmtree", "tasks"))).toBe(true);
    expect(config).toMatchObject({
      branchPrefix: "swarm/",
      tasksDir: "tasks",
      version: 1,
      worktreeRoot: "../worktrees",
    });
    expect(typeof config.createdAt).toBe("string");
    expect(consoleCapture.output().logs[0]).toMatch(/^Initialized swarmtree in .*\.swarmtree$/);
  });

  it("does not overwrite an existing config", async () => {
    const repo = await createGitRepo();
    const consoleCapture = captureConsole();

    await init({ cwd: repo, worktreeRoot: "../first-worktrees" });
    await init({ cwd: repo, worktreeRoot: "../second-worktrees" });

    const config = await readYamlFile<Record<string, unknown>>(
      path.join(repo, ".swarmtree", "config.yml"),
    );

    expect(config.worktreeRoot).toBe("../first-worktrees");
    expect(consoleCapture.output().logs.at(-3)).toMatch(
      /^Swarmtree is already initialized in .*\.swarmtree$/,
    );
  });
});
