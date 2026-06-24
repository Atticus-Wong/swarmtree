# Swarmtree CLI Plan

## Summary

Build a TypeScript/Node CLI named `swarmtree` for managing parallel agent tasks in git repositories. The v1 product is a workspace layout, repo-local task ledger, and safe `git worktree` automation. It should stay generic: it prepares isolated worktrees and prints agent handoff prompts/commands, but does not depend on a specific agent runtime.

The core job: make it easy to create, inspect, resume, complete, and clean up parallel coding tasks without agents colliding in one checkout.

## Key Changes

- Create a Node CLI with subcommands:
  - `swarmtree init`: create repo-local config/state folder for the current checkout.
  - `swarmtree workspace init <repo-url> <name>`: create a clean workspace with `main/` and `worktrees/` directories.
  - `swarmtree create "<task title>"`: create task record, branch, and sibling worktree.
  - `swarmtree list`: show tasks by status, branch, worktree path, and owner.
  - `swarmtree show <task-id>`: print task details and handoff prompt.
  - `swarmtree start <task-id>`: print `cd <worktree>` plus agent-ready context.
  - `swarmtree status <task-id>`: show git status, branch, commits ahead/behind, and task metadata.
  - `swarmtree done <task-id>`: mark complete after optional validation notes.
  - `swarmtree clean <task-id>`: remove completed worktree only after explicit confirmation.
- Store state in human-readable repo-local YAML under `.swarmtree/`:
  - `.swarmtree/config.yml`
  - `.swarmtree/tasks/<task-id>.yml`
- Default task schema:
  - `id`, `title`, `slug`, `status`
  - `baseRef`, `baseCommit`, `branch`, `worktreePath`
  - `owner`, `createdAt`, `updatedAt`
  - `handoffPrompt`, `notes`, `validation`, `result`
- Default git conventions:
  - Branch prefix: `swarm/`
  - Branch format: `swarm/YYYY-MM-DD-<slug>`
  - Preferred workspace layout: `<workspace-root>/main` for the primary checkout and `<workspace-root>/worktrees/<task-slug>` for task worktrees.
  - Existing repo default worktree root: `../worktrees`.
  - Base: current `HEAD` unless `--base` is provided
- Safety behavior:
  - Never stash, reset, clean, delete branches, or remove worktrees without explicit user confirmation.
  - If a branch/path already exists, append `-2`, `-3`, etc.
  - Warn when the source checkout has uncommitted changes before creating a task.
  - Keep each task in its own YAML file to reduce merge conflicts between agents.
  - Refuse to create task worktrees in detached `HEAD` unless the user explicitly confirms the base commit.
  - Refuse to leave a task worktree in detached `HEAD`; every task worktree must have a dedicated branch checked out.

## Workspace Layout

Swarmtree should support two setup modes.

Existing repo mode:

```text
repo/
  .git/
  .swarmtree/
    config.yml
    tasks/

../worktrees/
  <task-slug>/
```

Clean workspace mode:

```text
<workspace-root>/
  main/
    .git/
    .swarmtree/
      config.yml
      tasks/

  worktrees/
    <task-slug>/
```

`main/` is the primary git checkout directory, not a special branch created by swarmtree. It will usually have the repository's normal default branch checked out. `worktrees/` is a container directory for linked git worktrees.

`swarmtree workspace init <repo-url> <name>` should clone the repository into `<name>/main`, create `<name>/worktrees`, and write `.swarmtree/config.yml` with `worktreeRoot: ../worktrees`.

`swarmtree init` should initialize `.swarmtree/` in an existing checkout and default `worktreeRoot` to `../worktrees`.

Swarmtree should not create task worktrees inside the primary checkout. Keeping task worktrees outside the repo working tree prevents editor noise, duplicate search results, nested repository confusion, and accidental inclusion in project tooling.

## Public Interface

Example workflow:

```bash
swarmtree workspace init git@github.com:example/myrepo.git myrepo
cd myrepo/main
swarmtree init
swarmtree create "add billing export"
swarmtree list
swarmtree start 20260624-add-billing-export
swarmtree status 20260624-add-billing-export
swarmtree done 20260624-add-billing-export --validation "npm test passed"
swarmtree clean 20260624-add-billing-export
```

Example handoff output from `swarmtree start`:

```text
Task: add billing export
Branch: swarm/2026-06-24-add-billing-export
Worktree: ../worktrees/add-billing-export

cd ../worktrees/add-billing-export

Agent instruction:
You are working in an isolated git worktree for this task. Do not modify sibling worktrees. Do not revert changes you did not make. Read project instructions before editing.
```

## Implementation Notes

- Use TypeScript with a small CLI framework such as `commander` or `clipanion`.
- Use structured libraries for YAML and shell execution rather than ad hoc parsing.
- Treat git as the source of truth for actual branch/worktree state, and YAML as the task ledger.
- Implement git operations through a small internal wrapper:
  - repo root detection
  - current branch/commit/status
  - worktree list
  - branch existence check
  - worktree creation/removal

## Test Plan

- Unit tests:
  - slug generation
  - task id generation
  - YAML read/write
  - branch/path collision handling
  - task status transitions
- Integration tests in a temporary git repo:
  - `init` creates `.swarmtree/config.yml`
  - `workspace init` creates `<name>/main`, `<name>/worktrees`, and initializes swarmtree config
  - `create` creates one task file, one branch, and one worktree
  - `create` checks out a dedicated task branch and never leaves the task worktree in detached `HEAD`
  - duplicate task titles produce unique branch/path names
  - dirty source checkout emits a warning but does not mutate user changes
  - `status` reports real git status from the task worktree
  - `done` records validation notes
  - `clean` refuses incomplete tasks and requires explicit confirmation
  - `clean` refuses dirty task worktrees
  - `clean --delete-branch` refuses to delete unmerged branches
- Manual acceptance:
  - Create two tasks in the same repo and verify both agents could work independently in separate sibling directories.
  - Confirm `git worktree list` matches the CLI task ledger.
  - Merge two completed task branches back into the target branch one at a time and confirm swarmtree reports the expected state before cleanup.
  - Confirm all CLI output is useful to copy into an agent prompt.

## Assumptions

- First version targets personal/local use, not team-wide coordination.
- Repo-local YAML is preferred over a global database.
- The CLI should be generic shell-first, with Codex-specific integration deferred.
- The initial package can live in this repo or a new repo, but project task state should live under `.swarmtree/`.
- The first implementation should prioritize safety, transparency, and easy manual recovery over automation depth.

## Merge Model

Swarmtree isolates task execution by creating one branch and one filesystem worktree per task. This prevents agents from modifying the same working directory, git index, staged changes, or uncommitted files.

Swarmtree does not guarantee conflict-free merges. When task branches are merged back into the target branch, git remains responsible for textual merge conflicts, and project tests remain responsible for semantic conflicts.

Recommended merge flow:
- Merge completed task branches back one at a time.
- Before merging, show each task branch's diff and ahead/behind status.
- If the target branch has moved, warn when the task branch is behind.
- After each merge, run the project's validation command before merging the next task.

Closing or merging a task branch does not remove its sibling worktree directory. Cleanup is a separate explicit step.

`swarmtree clean <task-id>` should:
- Refuse if the task is not marked done.
- Refuse if the task worktree has uncommitted changes.
- Remove the linked worktree after explicit confirmation.
- Preserve the task branch by default.
- Delete the task branch only with an explicit flag, and only after confirming it has already been merged.
