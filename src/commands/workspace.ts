import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";

import { init } from "./init.js";

export interface WorkspaceInitOptions {
  cwd?: string;
  repoUrl?: string;
  name?: string;
}

export async function initWorkspace(options: WorkspaceInitOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const name = options.name;

  if (!name) {
    throw new Error("Usage: swarmtree workspace init [repo-url] <name>");
  }

  const workspaceRoot = path.resolve(cwd, name);
  const mainPath = path.join(workspaceRoot, "main");
  const worktreesPath = path.join(workspaceRoot, "worktrees");

  await ensurePathDoesNotExist(workspaceRoot);
  await mkdir(workspaceRoot, { recursive: true });

  if (options.repoUrl) {
    await execa("git", ["clone", options.repoUrl, mainPath], { cwd, stdio: "inherit" });
  } else {
    await mkdir(mainPath, { recursive: true });
    await execa("git", ["init"], { cwd: mainPath, stdio: "inherit" });
  }

  await mkdir(worktreesPath, { recursive: true });
  await init({ cwd: mainPath, worktreeRoot: "../worktrees" });

  console.log("");
  console.log(`Workspace: ${path.relative(cwd, workspaceRoot) || "."}`);
  console.log(`Main checkout: ${path.relative(cwd, mainPath)}`);
  console.log(`Worktrees: ${path.relative(cwd, worktreesPath)}`);
}

async function ensurePathDoesNotExist(targetPath: string): Promise<void> {
  const existing = await stat(targetPath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  });

  if (existing) {
    throw new Error(`Workspace path already exists: ${targetPath}`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
