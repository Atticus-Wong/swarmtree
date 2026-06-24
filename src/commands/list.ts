import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";
import YAML from "yaml";

export interface ListOptions {
  cwd?: string;
}

interface SwarmtreeConfig {
  tasksDir?: string;
}

interface TaskRecord {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  branch?: unknown;
  worktreePath?: unknown;
  owner?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
}

const DEFAULT_TASKS_DIR = "tasks";
const STATUS_ORDER = ["todo", "ready", "in_progress", "blocked", "done"];

export async function list(options: ListOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await getRepoRoot(cwd);
  const swarmtreeDir = path.join(repoRoot, ".swarmtree");
  const config = await readConfig(path.join(swarmtreeDir, "config.yml"));
  const tasksDir = path.join(swarmtreeDir, config.tasksDir ?? DEFAULT_TASKS_DIR);
  const taskFiles = await readTaskFileNames(tasksDir);

  if (taskFiles.length === 0) {
    console.log("No swarmtree tasks found.");
    return;
  }

  const tasks = await Promise.all(
    taskFiles.map(async (fileName) => readTask(path.join(tasksDir, fileName))),
  );

  printTasks(tasks);
}

async function getRepoRoot(cwd: string): Promise<string> {
  try {
    const result = await execa("git", ["rev-parse", "--show-toplevel"], { cwd });
    return result.stdout.trim();
  } catch {
    throw new Error("swarmtree list must be run inside a git repository.");
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

function printTasks(tasks: TaskRecord[]): void {
  const sortedTasks = [...tasks].sort(compareTasks);
  const rows = sortedTasks.map((task) => ({
    status: displayValue(task.status),
    id: displayValue(task.id),
    owner: displayValue(task.owner),
    branch: displayValue(task.branch),
    worktree: displayValue(task.worktreePath),
    title: displayValue(task.title),
  }));

  const widths = {
    status: maxWidth("Status", rows.map((row) => row.status)),
    id: maxWidth("ID", rows.map((row) => row.id)),
    owner: maxWidth("Owner", rows.map((row) => row.owner)),
    branch: maxWidth("Branch", rows.map((row) => row.branch)),
    worktree: maxWidth("Worktree", rows.map((row) => row.worktree)),
  };

  console.log(
    [
      pad("Status", widths.status),
      pad("ID", widths.id),
      pad("Owner", widths.owner),
      pad("Branch", widths.branch),
      pad("Worktree", widths.worktree),
      "Title",
    ].join("  "),
  );
  console.log(
    [
      "-".repeat(widths.status),
      "-".repeat(widths.id),
      "-".repeat(widths.owner),
      "-".repeat(widths.branch),
      "-".repeat(widths.worktree),
      "-----",
    ].join("  "),
  );

  for (const row of rows) {
    console.log(
      [
        pad(row.status, widths.status),
        pad(row.id, widths.id),
        pad(row.owner, widths.owner),
        pad(row.branch, widths.branch),
        pad(row.worktree, widths.worktree),
        row.title,
      ].join("  "),
    );
  }
}

function compareTasks(left: TaskRecord, right: TaskRecord): number {
  return (
    statusRank(left.status) - statusRank(right.status) ||
    compareString(left.status, right.status) ||
    compareString(
      coerceString(left.updatedAt) ?? coerceString(left.createdAt),
      coerceString(right.updatedAt) ?? coerceString(right.createdAt),
    ) ||
    compareString(left.id, right.id)
  );
}

function statusRank(status: unknown): number {
  const rank = STATUS_ORDER.indexOf(coerceString(status) ?? "");
  return rank === -1 ? STATUS_ORDER.length : rank;
}

function compareString(left: unknown, right: unknown): number {
  return (coerceString(left) ?? "").localeCompare(coerceString(right) ?? "");
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

function maxWidth(header: string, values: string[]): number {
  return Math.max(header.length, ...values.map((value) => value.length));
}

function pad(value: string, width: number): string {
  return value.padEnd(width, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
