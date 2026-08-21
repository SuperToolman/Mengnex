import assert from "node:assert/strict";
import test from "node:test";
import { modelTools } from "./agent-loop.js";
import { parseSse } from "./llm-adapters.js";

test("model tools use OpenAI-compatible function names and retain the internal mapping", () => {
  const result = modelTools([
    { name: "media.search", description: "search", inputSchema: {} },
    { name: "tasks.create_scan", description: "scan", inputSchema: {} },
  ]);
  assert.deepEqual(result.tools.map((tool) => tool.function.name), ["media_search", "tasks_create_scan"]);
  assert.equal(result.toolNames.get("media_search"), "media.search");
});

test("OpenAI-compatible SSE parser emits content, reasoning, tool deltas, and usage", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"model":"m","choices":[{"delta":{"content":"hi"}}]}\n\n'));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"why","tool_calls":[{"index":0,"id":"call-1","function":{"name":"media_","arguments":"{\\"q\\":"}}]}}]}\n\n'));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"search","arguments":"\\"x\\"}"}}]}}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\n'));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  const deltas = [];
  for await (const delta of parseSse(stream)) deltas.push(delta);
  assert.equal(deltas[0].content, "hi");
  assert.equal(deltas[1].reasoning, "why");
  assert.equal(deltas[2].toolCall?.arguments, "{\"q\":");
  assert.equal(deltas[3].toolCall?.arguments, "\"x\"}");
  assert.equal(deltas[4].usage?.totalTokens, 5);
});
