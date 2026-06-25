# Swarmtree

A CLI tool for managing git worktrees with AI workflows.

## Installation

### Prerequisites

- Node.js 20.12.0 or newer
- pnpm 10.7.0 or newer
- Git

If pnpm is not already available, enable it with Corepack:

```sh
corepack enable
```

### Install from source

Clone the repository, install dependencies, and build the CLI:

```sh
git clone <repository-url>
cd swarmtree/main
pnpm install
pnpm build
```

Run the CLI from the project checkout:

```sh
pnpm start -- --help
```

For development, run the TypeScript entrypoint directly:

```sh
pnpm dev -- --help
```

### Install the local CLI globally

After installing dependencies and building the project, link the local package so
the `swarmtree` command is available on your `PATH`:

```sh
pnpm link --global
swarmtree --help
```

When you change the source, rebuild before running the globally linked command:

```sh
pnpm build
```
