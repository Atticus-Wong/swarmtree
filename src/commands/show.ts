import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";
import YAML from "yaml";

export interface ShowOptions {
  cwd?: string;
  taskId: string;
}

interface SwarmtreeConfig {
  tasksDir?: string;
}

interface TaskRecord {
  id?: unknown;
  title?: unknown;
  slug?: unknown;
  status?: unknown;
  baseRef?: unknown;
  baseCommit?: unknown;
  branch?: unknown;
  worktreePath?: unknown;
  owner?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  handoffPrompt?: unknown;
  notes?: unknown;
  validation?: unknown;
  result?: unknown;
}

const DEFAULT_TASKS_DIR = "tasks";

export async function show(options: ShowOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const taskId = options.taskId.trim();

  if (!taskId) {
    throw new Error("Task ID is required.");
  }

  const repoRoot = await getRepoRoot(cwd);
  const swarmtreeDir = path.join(repoRoot, ".swarmtree");
  const config = await readConfig(path.join(swarmtreeDir, "config.yml"));
  const tasksDir = path.join(swarmtreeDir, config.tasksDir ?? DEFAULT_TASKS_DIR);
  const taskFiles = await readTaskFileNames(tasksDir);

  for (const fileName of taskFiles) {
    const task = await readTask(path.join(tasksDir, fileName));
    const fileId = fileName.replace(/\.ya?ml$/i, "");

    if (coerceString(task.id) === taskId || fileId === taskId) {
      printTask(task);
      return;
    }
  }

  throw new Error(`Task not found: ${taskId}`);
}

async function getRepoRoot(cwd: string): Promise<string> {
  try {
    const result = await execa("git", ["rev-parse", "--show-toplevel"], { cwd });
    return result.stdout.trim();
  } catch {
    throw new Error("swarmtree show must be run inside a git repository.");
  }
}

async function readConfig(configPath: string): Promise<SwarmtreeConfig> {
  const configFile = await readFile(configPath, "utf8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error("Swarmtree is not initialized. Run `swarmtree init` first.");
    }

    throw error;
  });

  const parsed = YAML.parse(configFile) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`Invalid swarmtree config: ${configPath}`);
  }

  return parsed;
}

async function readTaskFileNames(tasksDir: string): Promise<string[]> {
  const existing = await stat(tasksDir).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  });

  if (!existing) {
    return [];
  }

  if (!existing.isDirectory()) {
    throw new Error(`.swarmtree tasks path is not a directory: ${tasksDir}`);
  }

  const entries = await readdir(tasksDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function readTask(taskPath: string): Promise<TaskRecord> {
  const taskFile = await readFile(taskPath, "utf8");
  const parsed = YAML.parse(taskFile) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`Invalid swarmtree task file: ${taskPath}`);
  }

  return parsed;
}

function printTask(task: TaskRecord): void {
  console.log(`Task: ${displayValue(task.title)}`);
  console.log(`ID: ${displayValue(task.id)}`);
  console.log(`Status: ${displayValue(task.status)}`);
  console.log(`Owner: ${displayValue(task.owner)}`);
  console.log(`Branch: ${displayValue(task.branch)}`);
  console.log(`Worktree: ${displayValue(task.worktreePath)}`);
  console.log(`Base: ${formatBase(task)}`);
  console.log(`Created: ${displayValue(task.createdAt)}`);
  console.log(`Updated: ${displayValue(task.updatedAt)}`);
  printList("Notes", task.notes);
  console.log("Validation:");
  console.log(displayValue(task.validation));
  console.log("Result:");
  console.log(displayValue(task.result));
  console.log("");
  console.log("Handoff prompt:");
  console.log(getHandoffPrompt(task));
}

function formatBase(task: TaskRecord): string {
  const baseRef = coerceString(task.baseRef);
  const baseCommit = coerceString(task.baseCommit);

  if (baseRef && baseCommit) {
    return `${baseRef} (${baseCommit})`;
  }

  return baseRef ?? baseCommit ?? "-";
}

function printList(label: string, value: unknown): void {
  console.log(`${label}:`);

  if (!Array.isArray(value) || value.length === 0) {
    console.log("-");
    return;
  }

  for (const item of value) {
    console.log(`- ${displayValue(item)}`);
  }
}

function getHandoffPrompt(task: TaskRecord): string {
  const storedPrompt = coerceString(task.handoffPrompt);

  if (storedPrompt) {
    return storedPrompt;
  }

  const title = coerceString(task.title);
  const branch = coerceString(task.branch);
  const worktreePath = coerceString(task.worktreePath);

  if (!title || !branch || !worktreePath) {
    return "-";
  }

  return `Task: ${title}
Branch: ${branch}
Worktree: ${worktreePath}

cd ${worktreePath}

Agent instruction:
You are working in an isolated git worktree for this task. Do not modify sibling worktrees. Do not revert changes you did not make. Read project instructions before editing.`;
}

function displayValue(value: unknown): string {
  return coerceString(value) || "-";
}

function coerceString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const stringValue = String(value).trim();
  return stringValue || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
