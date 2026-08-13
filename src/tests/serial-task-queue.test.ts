import assert from "node:assert/strict";
import test from "node:test";
import { SerialTaskQueue } from "../libs/serial-task-queue.js";

test("runs tasks serially in arrival order", async () => {
  const queue = new SerialTaskQueue();
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const first = queue.run(async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
  });
  const second = queue.run(() => {
    events.push("second:start");
    return Promise.resolve();
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start"]);
});

test("continues after a task fails", async () => {
  const queue = new SerialTaskQueue();
  const first = queue.run(() => Promise.reject(new Error("failed")));
  const second = queue.run(() => Promise.resolve("completed"));

  await assert.rejects(first, /failed/);
  assert.equal(await second, "completed");
});
