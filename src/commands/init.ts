import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";
import YAML from "yaml";

export interface InitOptions {
  cwd?: string;
  worktreeRoot?: string;
}

interface SwarmtreeConfig {
  version: 1;
  worktreeRoot: string;
  branchPrefix: string;
  tasksDir: string;
  createdAt: string;
}

const DEFAULT_WORKTREE_ROOT = "../worktrees";
const DEFAULT_BRANCH_PREFIX = "swarm/";
const DEFAULT_TASKS_DIR = "tasks";

export async function init(options: InitOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await getRepoRoot(cwd);
  const swarmtreeDir = path.join(repoRoot, ".swarmtree");
  const configPath = path.join(swarmtreeDir, "config.yml");
  const tasksDir = path.join(swarmtreeDir, DEFAULT_TASKS_DIR);

  await ensureDirectory(swarmtreeDir, ".swarmtree");

  const createdConfig = await writeConfigIfMissing(configPath, {
    version: 1,
    worktreeRoot: options.worktreeRoot ?? DEFAULT_WORKTREE_ROOT,
    branchPrefix: DEFAULT_BRANCH_PREFIX,
    tasksDir: DEFAULT_TASKS_DIR,
    createdAt: new Date().toISOString(),
  });

  await ensureDirectory(tasksDir, ".swarmtree/tasks");

  if (createdConfig) {
    console.log(`Initialized swarmtree in ${path.relative(cwd, swarmtreeDir) || "."}`);
    console.log(`Config: ${path.relative(cwd, configPath)}`);
    console.log(`Tasks: ${path.relative(cwd, tasksDir)}`);
    return;
  }

  console.log(`Swarmtree is already initialized in ${path.relative(cwd, swarmtreeDir) || "."}`);
  console.log(`Config: ${path.relative(cwd, configPath)}`);
  console.log(`Tasks: ${path.relative(cwd, tasksDir)}`);
}

async function getRepoRoot(cwd: string): Promise<string> {
  try {
    const result = await execa("git", ["rev-parse", "--show-toplevel"], { cwd });
    return result.stdout.trim();
  } catch {
    throw new Error("swarmtree init must be run inside a git repository.");
  }
}

async function ensureDirectory(directoryPath: string, label: string): Promise<void> {
  const existing = await stat(directoryPath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  });

  if (existing && !existing.isDirectory()) {
    throw new Error(`${label} exists but is not a directory: ${directoryPath}`);
  }

  if (!existing) {
    await mkdir(directoryPath, { recursive: true });
  }
}

async function writeConfigIfMissing(
  configPath: string,
  config: SwarmtreeConfig,
): Promise<boolean> {
  const existing = await stat(configPath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  });

  if (existing) {
    if (!existing.isFile()) {
      throw new Error(`.swarmtree/config.yml exists but is not a file: ${configPath}`);
    }

    return false;
  }

  await writeFile(configPath, YAML.stringify(config), "utf8");
  return true;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
