import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { onTestFinished, vi } from "vitest";
import YAML from "yaml";

export async function makeTempDir(prefix = "swarmtree-"): Promise<string> {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  onTestFinished(async () => {
    await rm(directory, { force: true, recursive: true });
  });
  return directory;
}

export async function createGitRepo(): Promise<string> {
  const repo = await makeTempDir("swarmtree-repo-");
  await execa("git", ["init"], { cwd: repo });
  await execa("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  await execa("git", ["config", "user.name", "Test User"], { cwd: repo });
  await writeFile(path.join(repo, "README.md"), "# Test repo\n", "utf8");
  await execa("git", ["add", "README.md"], { cwd: repo });
  await execa("git", ["commit", "-m", "Initial commit"], { cwd: repo });
  return repo;
}

export async function readYamlFile<T = unknown>(filePath: string): Promise<T> {
  return YAML.parse(await readFile(filePath, "utf8")) as T;
}

export function captureConsole(): {
  error: ReturnType<typeof vi.spyOn>;
  log: ReturnType<typeof vi.spyOn>;
  output: () => { errors: string[]; logs: string[] };
} {
  const logs: string[] = [];
  const errors: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  const error = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  onTestFinished(() => {
    log.mockRestore();
    error.mockRestore();
  });

  return {
    error,
    log,
    output: () => ({ errors, logs }),
  };
}
