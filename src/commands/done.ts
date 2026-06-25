import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";
import YAML from "yaml";

export interface DoneOptions {
  cwd?: string;
  taskId: string;
  result?: string;
  validation?: string;
}

interface SwarmtreeConfig {
  tasksDir?: string;
}

type TaskRecord = Record<string, unknown>;

interface TaskMatch {
  filePath: string;
  task: TaskRecord;
}

const DEFAULT_TASKS_DIR = "tasks";

export async function done(options: DoneOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const taskId = options.taskId.trim();

  if (!taskId) {
    throw new Error("Task ID is required.");
  }

  const repoRoot = await getRepoRoot(cwd);
  const swarmtreeDir = path.join(repoRoot, ".swarmtree");
  const config = await readConfig(path.join(swarmtreeDir, "config.yml"));
  const tasksDir = path.join(swarmtreeDir, config.tasksDir ?? DEFAULT_TASKS_DIR);
  const match = await findTask(tasksDir, taskId);
  const updatedTask = buildDoneTask(match.task, options);

  await writeFile(match.filePath, YAML.stringify(updatedTask), "utf8");

  console.log(`Marked task ${displayValue(updatedTask.id) || taskId} done.`);
  console.log(`Task file: ${path.relative(cwd, match.filePath)}`);
}

async function getRepoRoot(cwd: string): Promise<string> {
  try {
    const result = await execa("git", ["rev-parse", "--show-toplevel"], { cwd });
    return result.stdout.trim();
  } catch {
    throw new Error("swarmtree done must be run inside a git repository.");
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

async function findTask(tasksDir: string, taskId: string): Promise<TaskMatch> {
  const taskFiles = await readTaskFileNames(tasksDir);

  for (const fileName of taskFiles) {
    const filePath = path.join(tasksDir, fileName);
    const task = await readTask(filePath);
    const fileId = fileName.replace(/\.ya?ml$/i, "");

    if (coerceString(task.id) === taskId || fileId === taskId) {
      return { filePath, task };
    }
  }

  throw new Error(`Task not found: ${taskId}`);
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

function buildDoneTask(task: TaskRecord, options: DoneOptions): TaskRecord {
  const updatedTask: TaskRecord = {
    ...task,
    status: "done",
    updatedAt: new Date().toISOString(),
  };
  const validation = coerceString(options.validation);
  const result = coerceString(options.result);

  if (validation) {
    updatedTask.validation = validation;
  }

  if (result) {
    updatedTask.result = result;
  }

  return updatedTask;
}

function displayValue(value: unknown): string {
  return coerceString(value) || "";
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
