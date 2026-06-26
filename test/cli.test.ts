import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import YAML from "yaml";

import { createTask } from "../src/commands/create.js";
import { init } from "../src/commands/init.js";
import { createProgram, normalizeProgramArgv, runProgram } from "../src/program.js";
import { createGitRepo } from "./helpers.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

describe("cli entrypoint", () => {
  it("prints help and exits successfully when no command is provided", async () => {
    let stdout = "";
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stdout += chunk.toString();
        return true;
      });

    try {
      await runProgram(["node", "swarmtree"]);
    } finally {
      write.mockRestore();
    }

    expect(stdout).toContain("Usage: swarmtree [options] [command]");
    expect(stdout).toContain("Commands:");
    expect(stdout).toContain("done");
    expect(stdout).toContain("status");
    expect(stdout).toContain("clean");
  });

  it.each(["-V", "--version"])("prints the package version for %s", async (flag) => {
    let stdout = "";
    const program = createProgram()
      .configureOutput({
        writeOut: (chunk: string) => {
          stdout += chunk;
        },
      })
      .exitOverride();

    await expect(program.parseAsync(["node", "swarmtree", flag])).rejects.toMatchObject({
      code: "commander.version",
      exitCode: 0,
    });

    expect(stdout).toBe(`${packageJson.version}\n`);
  });

  it("prints the package version when invoked through a package script separator", async () => {
    let stdout = "";
    const program = createProgram()
      .configureOutput({
        writeOut: (chunk: string) => {
          stdout += chunk.toString();
        },
      })
      .exitOverride();

    await expect(
      program.parseAsync(normalizeProgramArgv(["node", "swarmtree", "--", "-V"])),
    ).rejects.toMatchObject({
      code: "commander.version",
      exitCode: 0,
    });

    expect(stdout).toBe(`${packageJson.version}\n`);
  });

  it("runs the clean command through the cli entrypoint", async () => {
    const repo = await createGitRepo();
    await init({ cwd: repo, worktreeRoot: "worktrees" });
    await createTask({ cwd: repo, title: "Clean via cli" });
    const taskId = await getOnlyTaskId(repo);
    await markOnlyTaskDone(repo);

    const originalCwd = process.cwd();
    try {
      process.chdir(repo);
      await runProgram(["node", "swarmtree", "clean", taskId, "--yes"]);
    } finally {
      process.chdir(originalCwd);
    }

    expect(existsSync(path.join(repo, "worktrees", "clean-via-cli"))).toBe(false);
  });
});

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
