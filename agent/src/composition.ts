import { readFile } from "node:fs/promises";
import { join } from "node:path";

type Override = { enabled?: boolean; config?: Record<string, unknown> };
type Composition = { profiles?: Record<string, { plugins?: Record<string, Override> }>; overlays?: Record<string, { plugins?: Record<string, Override> }> };

export async function loadComposition(path = join(process.cwd(), "cordis.json")) {
  let value: Composition = {};
  try { value = JSON.parse(await readFile(path, "utf8")) as Composition; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const profile = process.env.AGENT_PROFILE ?? "default";
  const overlays = (process.env.AGENT_OVERLAYS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return [value.profiles?.[profile]?.plugins ?? {}, ...overlays.map((name) => value.overlays?.[name]?.plugins ?? {})].reduce((merged, overlay) => Object.assign(merged, overlay), {} as Record<string, Override>);
}
