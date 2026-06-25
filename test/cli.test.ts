import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

import { createProgram, normalizeProgramArgv, runProgram } from "../src/program.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

describe("cli entrypoint", () => {
  it("prints help and exits successfully when no command is provided", async () => {
    let stdout = "";
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stdout += chunk.toString();
        return true;
      });

    try {
      await runProgram(["node", "swarmtree"]);
    } finally {
      write.mockRestore();
    }

    expect(stdout).toContain("Usage: swarmtree [options] [command]");
    expect(stdout).toContain("Commands:");
    expect(stdout).toContain("done");
    expect(stdout).toContain("status");
  });

  it.each(["-V", "--version"])("prints the package version for %s", async (flag) => {
    let stdout = "";
    const program = createProgram()
      .configureOutput({
        writeOut: (chunk: string) => {
          stdout += chunk;
        },
      })
      .exitOverride();

    await expect(program.parseAsync(["node", "swarmtree", flag])).rejects.toMatchObject({
      code: "commander.version",
      exitCode: 0,
    });

    expect(stdout).toBe(`${packageJson.version}\n`);
  });

  it("prints the package version when invoked through a package script separator", async () => {
    let stdout = "";
    const program = createProgram()
      .configureOutput({
        writeOut: (chunk: string) => {
          stdout += chunk.toString();
        },
      })
      .exitOverride();

    await expect(
      program.parseAsync(normalizeProgramArgv(["node", "swarmtree", "--", "-V"])),
    ).rejects.toMatchObject({
      code: "commander.version",
      exitCode: 0,
    });

    expect(stdout).toBe(`${packageJson.version}\n`);
  });
});
