import * as cordis from "cordis";
import type { Context } from "cordis";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export abstract class KeyValueStorage extends (cordis as any).Service { protected constructor(ctx: Context, key = "storage") { super(ctx, key); } abstract get<T>(key: string): Promise<T | undefined>; abstract set<T>(key: string, value: T): Promise<void>; }
export class FileKeyValueStorage extends KeyValueStorage { private data: Record<string, unknown> = {}; constructor(ctx: Context, private readonly path = join(process.cwd(), "data", "storage.json")) { super(ctx); } async get<T>(key: string) { await this.load(); return this.data[key] as T | undefined; } async set<T>(key: string, value: T) { await this.load(); this.data[key] = value; await mkdir(dirname(this.path), { recursive: true }); await writeFile(this.path, JSON.stringify(this.data, null, 2), "utf8"); } private loaded = false; private async load() { if (this.loaded) return; this.loaded = true; try { this.data = JSON.parse(await readFile(this.path, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } } }

export abstract class JobScheduler extends (cordis as any).Service { protected constructor(ctx: Context, key = "jobs") { super(ctx, key); } abstract schedule(id: string, delayMs: number, run: () => Promise<void>): () => void; }
export class LocalJobScheduler extends JobScheduler { constructor(ctx: Context) { super(ctx); } schedule(_id: string, delayMs: number, run: () => Promise<void>) { const timer = setTimeout(() => void run(), delayMs); return () => clearTimeout(timer); } }

export abstract class SandboxProvider extends (cordis as any).Service { protected constructor(ctx: Context, key = "sandbox") { super(ctx, key); } abstract available(): boolean; }
export class LocalSandboxProvider extends SandboxProvider { constructor(ctx: Context) { super(ctx); } available() { return true; } }

declare module "cordis" { interface Context { storage: KeyValueStorage; jobs: JobScheduler; sandbox: SandboxProvider; } }
