import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { discoverLocalPlugins } from "./plugin-loader.js";

test("local plugin packages are discovered without changing the Agent entrypoint", async () => {
  const plugins = await discoverLocalPlugins(join(process.cwd(), "plugins"));
  const hello = plugins.find((plugin) => plugin.id === "hello-world");
  assert.ok(hello);
  assert.equal(hello.origin, "local");
  assert.deepEqual(hello.dependencies, ["agent-runtime"]);
  const plugin = await hello.create({});
  assert.equal((plugin as { name: string }).name, "mengnex-hello-world-package");
  const knowledge = plugins.find((plugin) => plugin.id === "knowledge-base");
  assert.ok(knowledge?.configSchema);
  assert.equal(knowledge.ui?.settings.label, "知识库");
  assert.equal(knowledge.configSchema.properties.paths.type, "array");
  assert.deepEqual(plugins.filter((plugin) => plugin.origin === "local").map((plugin) => plugin.id).sort(), ["hello-world", "knowledge-base", "mcp-client", "skills"]);
});
