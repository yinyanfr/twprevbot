import assert from "node:assert/strict";
import test from "node:test";
import { startRepeatingChatAction } from "../libs/repeating-chat-action.js";

test("repeats chat actions until stopped", async () => {
  const waits: Array<() => void> = [];
  let calls = 0;
  const stop = startRepeatingChatAction(
    () => {
      calls += 1;
      return Promise.resolve();
    },
    {
      wait: () =>
        new Promise<void>((resolve) => {
          waits.push(resolve);
        }),
    },
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  waits.shift()?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  stop();
  waits.shift()?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
});

test("continues after a chat action error", async () => {
  const waits: Array<() => void> = [];
  const errors: unknown[] = [];
  let calls = 0;
  const stop = startRepeatingChatAction(
    () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("unavailable"))
        : Promise.resolve();
    },
    {
      wait: () =>
        new Promise<void>((resolve) => {
          waits.push(resolve);
        }),
      onError: (error) => errors.push(error),
    },
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 1);
  waits.shift()?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  stop();
});
