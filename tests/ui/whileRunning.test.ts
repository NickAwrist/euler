import { expect, test } from "bun:test";
import { setKeyPending, whileRunning } from "../../ui/lib/whileRunning";

test("clears a pending key after the task fails and keeps other pending keys", async () => {
  let pending = new Set(["other"]);
  const setPending = (update: (current: Set<string>) => Set<string>) => {
    pending = update(pending);
  };
  const failure = new Error("save failed");

  const run = whileRunning(setKeyPending(setPending, "model"), async () => {
    expect([...pending]).toEqual(["other", "model"]);
    throw failure;
  });

  await expect(run).rejects.toBe(failure);
  expect([...pending]).toEqual(["other"]);
});
