import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import * as cordis from "cordis";
import type { Context } from "cordis";
import { RustApiClient } from "./rust-api.js";
import { ToolRegistry, createCoreToolsPlugin } from "./tools.js";

test("media.search forwards the authenticated cookie to the Rust API", async () => {
  let receivedCookie = "";
  const server = createServer((request, response) => {
    receivedCookie = request.headers.cookie ?? "";
    assert.equal(request.url, "/api/media/items?limit=50");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify([
      { id: "1", title: "Neon Genesis Evangelion", media_type: "anime", library_id: "library-1" },
      { id: "2", title: "Arrival", media_type: "movie", library_id: "library-1" },
    ]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not expose a port");

  try {
    const app = new (cordis as any).Context() as Context;
    const install = (app as any).plugin.bind(app) as (plugin: unknown, config?: unknown) => PromiseLike<unknown>;
    await install(ToolRegistry);
    await install(createCoreToolsPlugin(new RustApiClient(`http://127.0.0.1:${address.port}`)));

    const result = await app.tools.execute("media.search", { query: "eva" }, { executionMode: "approve_high_risk", sessionCookie: "mengnex_session=verified" });
    assert.equal(receivedCookie, "mengnex_session=verified");
    assert.deepEqual(result, [{ id: "1", title: "Neon Genesis Evangelion", media_type: "anime", library_id: "library-1" }]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
