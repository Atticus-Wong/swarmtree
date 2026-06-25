import { createInterface } from "node:readline/promises";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { execa, type ExecaError } from "execa";
import YAML from "yaml";

export interface CleanOptions {
  cwd?: string;
  taskId: string;
  yes?: boolean;
  deleteBranch?: boolean;
}

interface SwarmtreeConfig {
  tasksDir?: string;
}

interface TaskRecord {
  id?: unknown;
  status?: unknown;
  branch?: unknown;
  worktreePath?: unknown;
}

const DEFAULT_TASKS_DIR = "tasks";

export async function clean(options: CleanOptions): Promise<void> {
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
  const status = coerceString(task.status);

  if (status !== "done") {
    throw new Error(`Task must be done before cleaning: ${taskId} (status: ${status ?? "-"})`);
  }

  const branch = getRequiredString(task.branch, `Task branch is required: ${taskId}`);
  const worktreePath = getRequiredString(task.worktreePath, `Task worktree path is required: ${taskId}`);
  const absoluteWorktreePath = path.resolve(repoRoot, worktreePath);

  await ensureWorktreeExists(absoluteWorktreePath);
  await ensureRegisteredTaskWorktree({ repoRoot, taskId, worktreePath: absoluteWorktreePath });
  await ensureWorktreeBranch({ branch, taskId, worktreePath: absoluteWorktreePath });
  await ensureWorktreeClean({ displayPath: worktreePath, worktreePath: absoluteWorktreePath });

  if (options.deleteBranch) {
    await ensureBranchMerged({ branch, repoRoot });
  }

  if (!options.yes) {
    await requireConfirmation({ taskId, worktreePath });
  }

  await execa("git", ["worktree", "remove", absoluteWorktreePath], { cwd: repoRoot });
  console.log(`Removed worktree: ${worktreePath}`);

  if (options.deleteBranch) {
    await execa("git", ["branch", "-d", branch], { cwd: repoRoot });
    console.log(`Deleted branch: ${branch}`);
  }
}

async function getRepoRoot(cwd: string): Promise<string> {
  try {
    const result = await execa("git", ["rev-parse", "--show-toplevel"], { cwd });
    return result.stdout.trim();
  } catch {
    throw new Error("swarmtree clean must be run inside a git repository.");
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

async function ensureRegisteredTaskWorktree(input: {
  repoRoot: string;
  taskId: string;
  worktreePath: string;
}): Promise<void> {
  const worktrees = await readGitWorktreePaths(input.repoRoot);
  const normalizedTarget = path.resolve(input.worktreePath);

  if (normalizedTarget === path.resolve(input.repoRoot)) {
    throw new Error(`Refusing to remove the current repository checkout as task ${input.taskId}.`);
  }

  if (!worktrees.some((worktree) => path.resolve(worktree) === normalizedTarget)) {
    throw new Error(`Task worktree is not registered with git: ${input.worktreePath}`);
  }
}

async function readGitWorktreePaths(repoRoot: string): Promise<string[]> {
  const result = await execa("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot });

  return result.stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter((worktreePath) => worktreePath.length > 0);
}

async function ensureWorktreeBranch(input: {
  branch: string;
  taskId: string;
  worktreePath: string;
}): Promise<void> {
  const currentBranch = await getCurrentBranch(input.worktreePath);

  if (currentBranch !== input.branch) {
    throw new Error(
      `Expected task ${input.taskId} worktree to be on ${input.branch}, but found ${
        currentBranch ?? "detached HEAD"
      }.`,
    );
  }
}

async function ensureWorktreeClean(input: {
  displayPath: string;
  worktreePath: string;
}): Promise<void> {
  const result = await execa("git", ["status", "--porcelain"], { cwd: input.worktreePath });

  if (result.stdout.trim().length > 0) {
    throw new Error(`Refusing to clean dirty task worktree: ${input.displayPath}`);
  }
}

async function ensureBranchMerged(input: {
  branch: string;
  repoRoot: string;
}): Promise<void> {
  try {
    await execa("git", ["merge-base", "--is-ancestor", input.branch, "HEAD"], { cwd: input.repoRoot });
  } catch (error: unknown) {
    const exitCode = getExitCode(error);

    if (exitCode === 1) {
      throw new Error(`Refusing to delete unmerged branch: ${input.branch}`);
    }

    throw error;
  }
}

async function requireConfirmation(input: {
  taskId: string;
  worktreePath: string;
}): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Cleanup requires explicit confirmation. Re-run with --yes to remove the worktree.");
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const answer = await readline.question(
      `Remove worktree ${input.worktreePath} for task ${input.taskId}? Type yes to continue: `,
    );

    if (answer.trim().toLowerCase() !== "yes") {
      throw new Error("Cleanup cancelled.");
    }
  } finally {
    readline.close();
  }
}

async function getCurrentBranch(cwd: string): Promise<string | undefined> {
  try {
    const result = await execa("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd });
    return result.stdout.trim();
  } catch (error: unknown) {
    const exitCode = getExitCode(error);

    if (exitCode === 1) {
      return undefined;
    }

    throw error;
  }
}

function getRequiredString(value: unknown, message: string): string {
  const stringValue = coerceString(value);

  if (!stringValue) {
    throw new Error(message);
  }

  return stringValue;
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
