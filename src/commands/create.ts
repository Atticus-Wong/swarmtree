import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { execa, type ExecaError } from "execa";
import YAML from "yaml";

export interface CreateTaskOptions {
  cwd?: string;
  title: string;
  base?: string;
  owner?: string;
}

interface SwarmtreeConfig {
  worktreeRoot: string;
  branchPrefix: string;
  tasksDir: string;
}

interface TaskRecord {
  id: string;
  title: string;
  slug: string;
  status: "created";
  baseRef: string;
  baseCommit: string;
  branch: string;
  worktreePath: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
  handoffPrompt: string;
  notes: string[];
  validation: string;
  result: string;
}

interface UniqueTaskNames {
  id: string;
  slug: string;
  branch: string;
  taskFilePath: string;
  worktreePath: string;
  displayWorktreePath: string;
}

const DEFAULT_WORKTREE_ROOT = "../worktrees";
const DEFAULT_BRANCH_PREFIX = "swarm/";
const DEFAULT_TASKS_DIR = "tasks";

export async function createTask(options: CreateTaskOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const title = options.title.trim();

  if (!title) {
    throw new Error("Task title is required.");
  }

  const repoRoot = await git(cwd, ["rev-parse", "--show-toplevel"]);
  const config = await readConfig(repoRoot);
  const tasksDir = path.join(repoRoot, ".swarmtree", config.tasksDir);
  const worktreeRoot = path.resolve(repoRoot, config.worktreeRoot);

  await ensureDirectory(tasksDir);
  await ensureDirectory(worktreeRoot);

  const currentBranch = await getCurrentBranch(repoRoot);
  const baseRef = options.base ?? currentBranch;

  if (!baseRef) {
    throw new Error(
      "Refusing to create a task from detached HEAD. Pass --base <ref-or-commit> to confirm the base explicitly.",
    );
  }

  const baseCommit = await git(repoRoot, ["rev-parse", baseRef]);
  const status = await git(repoRoot, ["status", "--porcelain"]);

  if (status.length > 0) {
    console.error(
      "Warning: source checkout has uncommitted changes. The task worktree will be created from committed git state only.",
    );
  }

  const now = new Date();
  const date = formatLocalDate(now);
  const baseSlug = slugify(title);
  const names = await resolveUniqueTaskNames({
    baseSlug,
    branchPrefix: config.branchPrefix,
    date,
    repoRoot,
    tasksDir,
    worktreeRoot,
  });

  await execa("git", ["worktree", "add", "-b", names.branch, names.worktreePath, baseRef], {
    cwd: repoRoot,
  });

  const worktreeBranch = await getCurrentBranch(names.worktreePath);

  if (worktreeBranch !== names.branch) {
    throw new Error(`Expected task worktree to be on ${names.branch}, but found ${worktreeBranch ?? "detached HEAD"}.`);
  }

  const createdAt = now.toISOString();
  const handoffPrompt = buildHandoffPrompt({
    branch: names.branch,
    title,
    worktreePath: names.displayWorktreePath,
  });
  const task: TaskRecord = {
    id: names.id,
    title,
    slug: names.slug,
    status: "created",
    baseRef,
    baseCommit,
    branch: names.branch,
    worktreePath: names.displayWorktreePath,
    owner: options.owner ?? process.env.USER ?? "",
    createdAt,
    updatedAt: createdAt,
    handoffPrompt,
    notes: [],
    validation: "",
    result: "",
  };

  await writeFile(names.taskFilePath, YAML.stringify(task), "utf8");

  console.log(`Created task ${task.id}`);
  console.log(`Branch: ${task.branch}`);
  console.log(`Worktree: ${task.worktreePath}`);
  console.log(`Task file: ${path.relative(cwd, names.taskFilePath)}`);
  console.log("");
  console.log(handoffPrompt);
}

async function readConfig(repoRoot: string): Promise<SwarmtreeConfig> {
  const configPath = path.join(repoRoot, ".swarmtree", "config.yml");
  const configText = await readFile(configPath, "utf8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error("Swarmtree is not initialized. Run `swarmtree init` first.");
    }

    throw error;
  });
  const parsed = YAML.parse(configText);

  if (!isRecord(parsed)) {
    throw new Error(`Invalid swarmtree config: ${configPath}`);
  }

  return {
    worktreeRoot: getString(parsed.worktreeRoot, DEFAULT_WORKTREE_ROOT),
    branchPrefix: getString(parsed.branchPrefix, DEFAULT_BRANCH_PREFIX),
    tasksDir: getString(parsed.tasksDir, DEFAULT_TASKS_DIR),
  };
}

async function resolveUniqueTaskNames(input: {
  baseSlug: string;
  branchPrefix: string;
  date: { compact: string; dashed: string };
  repoRoot: string;
  tasksDir: string;
  worktreeRoot: string;
}): Promise<UniqueTaskNames> {
  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const suffix = attempt === 1 ? "" : `-${attempt}`;
    const slug = `${input.baseSlug}${suffix}`;
    const id = `${input.date.compact}-${slug}`;
    const branch = `${input.branchPrefix}${input.date.dashed}-${slug}`;
    const taskFilePath = path.join(input.tasksDir, `${id}.yml`);
    const worktreePath = path.join(input.worktreeRoot, slug);

    const [taskFileExists, branchExists, worktreePathExists] = await Promise.all([
      pathExists(taskFilePath),
      localBranchExists(input.repoRoot, branch),
      pathExists(worktreePath),
    ]);

    if (!taskFileExists && !branchExists && !worktreePathExists) {
      return {
        id,
        slug,
        branch,
        taskFilePath,
        worktreePath,
        displayWorktreePath: path.relative(input.repoRoot, worktreePath),
      };
    }
  }

  throw new Error(`Could not find an available task name for "${input.baseSlug}".`);
}

async function localBranchExists(repoRoot: string, branch: string): Promise<boolean> {
  try {
    await execa("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: repoRoot });
    return true;
  } catch (error: unknown) {
    const exitCode = getExitCode(error);

    if (exitCode === 1) {
      return false;
    }

    throw error;
  }
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

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execa("git", args, { cwd });
  return result.stdout.trim();
}

async function ensureDirectory(directoryPath: string): Promise<void> {
  const existing = await stat(directoryPath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  });

  if (existing && !existing.isDirectory()) {
    throw new Error(`Expected a directory: ${directoryPath}`);
  }

  if (!existing) {
    await mkdir(directoryPath, { recursive: true });
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return false;
      }

      throw error;
    });
}

function buildHandoffPrompt(input: {
  title: string;
  branch: string;
  worktreePath: string;
}): string {
  return `Task: ${input.title}
Branch: ${input.branch}
Worktree: ${input.worktreePath}

cd ${input.worktreePath}

Agent instruction:
You are working in an isolated git worktree for this task. Do not modify sibling worktrees. Do not revert changes you did not make. Read project instructions before editing.`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug || "task";
}

function formatLocalDate(date: Date): { compact: string; dashed: string } {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");

  return {
    compact: `${year}${month}${day}`,
    dashed: `${year}-${month}-${day}`,
  };
}

function getString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
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
