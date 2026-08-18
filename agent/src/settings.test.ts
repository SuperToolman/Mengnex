import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as cordis from "cordis";
import type { Context } from "cordis";
import { FileProviderRegistry } from "./providers.js";
import { FileExecutionPolicy } from "./execution-policy.js";

test("provider registry and execution policy persist through replaceable seams", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mengnex-agent-"));
  const providerPath = join(directory, "providers.json");
  const policyPath = join(directory, "policy.json");
  try {
    const app = new (cordis as any).Context() as Context;
    const legacyPath = join(directory, "legacy.json");
    const providers = new FileProviderRegistry(app, providerPath, legacyPath);
    const policy = new FileExecutionPolicy(app, policyPath, legacyPath);
    await providers.load(); await policy.load();
    const first = await providers.create({ name: "Primary", baseUrl: "https://example.test/v1", model: "model-a", enabled: true, apiKey: "secret" });
    const second = await providers.create({ name: "Backup", baseUrl: "https://backup.test/v1", model: "model-b", enabled: true });
    assert.equal(first.isDefault, true);
    assert.equal("apiKey" in first, false);
    await providers.setDefault(second.id);
    assert.equal(providers.configured().id, second.id);
    await policy.update({ executionMode: "full_access", allowedCapabilities: ["media.search"] });

    const restored = new (cordis as any).Context() as Context;
    const restoredProviders = new FileProviderRegistry(restored, providerPath, legacyPath);
    const restoredPolicy = new FileExecutionPolicy(restored, policyPath, legacyPath);
    await restoredProviders.load(); await restoredPolicy.load();
    assert.equal(restoredProviders.list().find((provider) => provider.id === first.id)?.hasApiKey, true);
    assert.equal(restoredProviders.configured().id, second.id);
    assert.equal(restoredPolicy.view().executionMode, "full_access");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
