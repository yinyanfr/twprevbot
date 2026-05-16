import assert from "node:assert/strict";
import test from "node:test";
import { fetchTwitterThread } from "../services/fx-twitter.js";

test("fetches /2/thread/{id}", async () => {
  const calls: string[] = [];
  const fetcher = (input: string | URL): Promise<Response> => {
    calls.push(String(input));
    return Promise.resolve(
      Response.json({
        code: 200,
        status: null,
        thread: null,
        author: null,
      }),
    );
  };

  const result = await fetchTwitterThread("20", fetcher);

  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://api.fxtwitter.com/2/thread/20");
  assert.deepEqual(result, {
    code: 200,
    status: null,
    thread: null,
    author: null,
  });
});

test("retries once on network TypeError failure", async () => {
  let calls = 0;
  const fetcher = (): Promise<Response> => {
    calls += 1;

    if (calls === 1) {
      return Promise.reject(new TypeError("network failed"));
    }

    return Promise.resolve(
      Response.json({
        code: 200,
        status: null,
        thread: null,
        author: null,
      }),
    );
  };

  await fetchTwitterThread("20", fetcher);

  assert.equal(calls, 2);
});

test("does not retry on successful http response", async () => {
  let calls = 0;
  const fetcher = (): Promise<Response> => {
    calls += 1;

    return Promise.resolve(
      Response.json(
        { code: 404, status: null, thread: null, author: null },
        { status: 404 },
      ),
    );
  };

  const result = await fetchTwitterThread("20", fetcher);

  assert.equal(calls, 1);
  assert.equal(result.code, 404);
});
