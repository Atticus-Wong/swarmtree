import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { execa, type ExecaError } from "execa";
import YAML from "yaml";

export interface StatusOptions {
  cwd?: string;
  taskId: string;
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
  baseRef?: unknown;
  baseCommit?: unknown;
  updatedAt?: unknown;
}

interface GitStatus {
  ahead?: number;
  behind?: number;
  branch?: string;
  commit: string;
  comparisonRef?: string;
  lines: string[];
}

const DEFAULT_TASKS_DIR = "tasks";

export async function status(options: StatusOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const taskId = options.taskId.trim();

  if (!taskId) {
    throw new Error("Task ID is required.");
  }

  const repoRoot = await getRepoRoot(cwd);
  const swarmtreeDir = path.join(repoRoot, ".swarmtree");
  const config = await readConfig(path.join(swarmtreeDir, "config.yml"));
  const tasksDir = path.join(swarmtreeDir, config.tasksDir ?? DEFAULT_TASKS_DIR);
  const task = await findTask(tasksDir, taskId);
  const worktreePath = path.resolve(
    repoRoot,
    getRequiredString(task.worktreePath, `Task worktree path is required: ${taskId}`),
  );

  await ensureWorktreeExists(worktreePath);

  const gitStatus = await readGitStatus(worktreePath, task);
  printStatus(task, worktreePath, gitStatus);
}

async function getRepoRoot(cwd: string): Promise<string> {
  try {
    const result = await execa("git", ["rev-parse", "--show-toplevel"], { cwd });
    return result.stdout.trim();
  } catch {
    throw new Error("swarmtree status must be run inside a git repository.");
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

async function findTask(tasksDir: string, taskId: string): Promise<TaskRecord> {
  const taskFiles = await readTaskFileNames(tasksDir);

  for (const fileName of taskFiles) {
    const task = await readTask(path.join(tasksDir, fileName));
    const fileId = fileName.replace(/\.ya?ml$/i, "");

    if (coerceString(task.id) === taskId || fileId === taskId) {
      return task;
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

async function ensureWorktreeExists(worktreePath: string): Promise<void> {
  const existing = await stat(worktreePath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  });

  if (!existing) {
    throw new Error(`Task worktree does not exist: ${worktreePath}`);
  }

  if (!existing.isDirectory()) {
    throw new Error(`Task worktree path is not a directory: ${worktreePath}`);
  }

  try {
    await execa("git", ["rev-parse", "--show-toplevel"], { cwd: worktreePath });
  } catch {
    throw new Error(`Task worktree is not a git checkout: ${worktreePath}`);
  }
}

async function readGitStatus(worktreePath: string, task: TaskRecord): Promise<GitStatus> {
  const [branch, commit, lines, comparisonRef] = await Promise.all([
    getCurrentBranch(worktreePath),
    git(worktreePath, ["rev-parse", "--short", "HEAD"]),
    getStatusLines(worktreePath),
    getComparisonRef(worktreePath, task),
  ]);
  const counts = comparisonRef ? await getAheadBehind(worktreePath, comparisonRef) : {};

  return {
    ...counts,
    branch,
    commit,
    comparisonRef,
    lines,
  };
}

async function getCurrentBranch(cwd: string): Promise<string | undefined> {
  try {
    return await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  } catch (error: unknown) {
    const exitCode = getExitCode(error);

    if (exitCode === 1) {
      return undefined;
    }

    throw error;
  }
}

async function getStatusLines(cwd: string): Promise<string[]> {
  const statusText = await git(cwd, ["status", "--short"]);

  if (!statusText) {
    return [];
  }

  return statusText.split("\n");
}

async function getComparisonRef(cwd: string, task: TaskRecord): Promise<string | undefined> {
  const upstream = await gitOptional(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);

  if (upstream) {
    return upstream;
  }

  const baseRef = coerceString(task.baseRef);

  if (baseRef && (await refExists(cwd, baseRef))) {
    return baseRef;
  }

  const baseCommit = coerceString(task.baseCommit);

  if (baseCommit && (await refExists(cwd, baseCommit))) {
    return baseCommit;
  }

  return undefined;
}

async function getAheadBehind(cwd: string, comparisonRef: string): Promise<{
  ahead: number;
  behind: number;
}> {
  const output = await git(cwd, ["rev-list", "--left-right", "--count", `HEAD...${comparisonRef}`]);
  const [aheadText, behindText] = output.split(/\s+/, 2);

  return {
    ahead: Number.parseInt(aheadText ?? "0", 10),
    behind: Number.parseInt(behindText ?? "0", 10),
  };
}

async function refExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await execa("git", ["rev-parse", "--verify", "--quiet", ref], { cwd });
    return true;
  } catch (error: unknown) {
    const exitCode = getExitCode(error);

    if (exitCode === 1) {
      return false;
    }

    throw error;
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execa("git", args, { cwd });
  return result.stdout.trim();
}

async function gitOptional(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    return await git(cwd, args);
  } catch (error: unknown) {
    const exitCode = getExitCode(error);

    if (exitCode === 1 || exitCode === 128) {
      return undefined;
    }

    throw error;
  }
}

function printStatus(task: TaskRecord, worktreePath: string, gitStatus: GitStatus): void {
  console.log(`Task: ${displayValue(task.title)}`);
  console.log(`ID: ${displayValue(task.id)}`);
  console.log(`Task status: ${displayValue(task.status)}`);
  console.log(`Owner: ${displayValue(task.owner)}`);
  console.log(`Recorded branch: ${displayValue(task.branch)}`);
  console.log(`Current branch: ${gitStatus.branch ?? "detached HEAD"}`);
  console.log(`Worktree: ${worktreePath}`);
  console.log(`HEAD: ${gitStatus.commit}`);
  console.log(`Base: ${formatBase(task)}`);
  console.log(`Compare ref: ${gitStatus.comparisonRef ?? "-"}`);
  console.log(`Ahead: ${formatCount(gitStatus.ahead)}`);
  console.log(`Behind: ${formatCount(gitStatus.behind)}`);
  console.log(`Updated: ${displayValue(task.updatedAt)}`);
  console.log("Git status:");

  if (gitStatus.lines.length === 0) {
    console.log("clean");
    return;
  }

  for (const line of gitStatus.lines) {
    console.log(line);
  }
}

function formatBase(task: TaskRecord): string {
  const baseRef = coerceString(task.baseRef);
  const baseCommit = coerceString(task.baseCommit);

  if (baseRef && baseCommit) {
    return `${baseRef} (${baseCommit})`;
  }

  return baseRef ?? baseCommit ?? "-";
}

function getRequiredString(value: unknown, message: string): string {
  const stringValue = coerceString(value);

  if (!stringValue) {
    throw new Error(message);
  }

  return stringValue;
}

function displayValue(value: unknown): string {
  return coerceString(value) || "-";
}

function formatCount(value: number | undefined): string {
  return value === undefined || Number.isNaN(value) ? "-" : String(value);
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

function getExitCode(error: unknown): number | undefined {
  if (isExecaError(error) && typeof error.exitCode === "number") {
    return error.exitCode;
  }

  return undefined;
}

function isExecaError(error: unknown): error is ExecaError {
  return error instanceof Error && "exitCode" in error;
}
