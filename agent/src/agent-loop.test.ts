import assert from "node:assert/strict";
import test from "node:test";
import { modelTools } from "./agent-loop.js";

test("model tools use OpenAI-compatible function names and retain the internal mapping", () => {
  const result = modelTools([
    { name: "media.search", description: "search", inputSchema: {} },
    { name: "tasks.create_scan", description: "scan", inputSchema: {} },
  ]);
  assert.deepEqual(result.tools.map((tool) => tool.function.name), ["media_search", "tasks_create_scan"]);
  assert.equal(result.toolNames.get("media_search"), "media.search");
});
