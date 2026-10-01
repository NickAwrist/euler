import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { BubblewrapSandboxRunner } from "../../src/sandbox/SandboxRunner";

test("background cancellation tears down descendants and output overflow does not terminate work", async () => {
  const root = await mkdtemp("/tmp/euler-background-");
  const runner = new BubblewrapSandboxRunner();
  const workspace = {
    kind: "sandbox" as const,
    hostPath: root,
    displayPath: "/workspace",
  };
  try {
    let output = "";
    const command = await runner.spawn({
      workspace,
      command: "(sleep 1; echo leaked > leaked.txt) & echo READY; wait",
      background: true,
      emitOutput: (c) => {
        output += c.text;
      },
    });
    const end = Date.now() + 3000;
    while (!output.includes("READY")) {
      if (Date.now() > end) throw new Error("No early output");
      await Bun.sleep(10);
    }
    await command.cancel();
    await command.cancel();
    await Bun.sleep(1200);
    expect(
      await readFile(`${root}/leaked.txt`, "utf8").catch(() => null),
    ).toBeNull();
    const overflow = await runner.run({
      workspace,
      background: true,
      command: "yes X | head -c 3000000; echo DONE",
      maxOutputBytes: 100,
    });
    expect(overflow.exitCode).toBe(0);
    expect(overflow.stdout.endsWith("DONE\n")).toBe(true);
    expect(Buffer.byteLength(overflow.stdout)).toBeLessThanOrEqual(65536);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
