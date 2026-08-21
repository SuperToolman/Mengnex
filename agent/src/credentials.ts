import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as cordis from "cordis";
import type { Context } from "cordis";

export type CredentialReference = { id: string; kind: string; label?: string; createdAt: string; updatedAt: string };
export type CredentialInput = { kind: string; secret: string; label?: string };

export abstract class CredentialProvider extends (cordis as any).Service {
  protected constructor(ctx: Context, key = "credentials") { super(ctx, key); }
  abstract load(): Promise<void>;
  abstract list(): CredentialReference[];
  abstract create(input: CredentialInput): Promise<CredentialReference>;
  abstract resolve(id: string, kind?: string): Promise<string>;
  abstract delete(id: string): Promise<void>;
}
declare module "cordis" { interface Context { credentials: CredentialProvider } }

export class FileCredentialProvider extends CredentialProvider {
  private readonly secrets = new Map<string, { reference: CredentialReference; secret: string }>();
  private queue: Promise<void> = Promise.resolve();
  constructor(ctx: Context, private readonly filePath = join(process.cwd(), "data", "credentials.json")) { super(ctx); }
  async load() {
    try { const rows = JSON.parse(await readFile(this.filePath, "utf8")) as Array<{ reference: CredentialReference; secret: string }>; for (const row of rows) if (row?.reference?.id && typeof row.secret === "string") this.secrets.set(row.reference.id, row); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  list() { return [...this.secrets.values()].map(({ reference }) => structuredClone(reference)); }
  async create(input: CredentialInput) { if (!input.kind.trim() || !input.secret) throw new Error("credential kind and secret are required"); const now = new Date().toISOString(); const reference = { id: randomUUID(), kind: input.kind.trim(), ...(input.label ? { label: input.label.trim() } : {}), createdAt: now, updatedAt: now }; this.secrets.set(reference.id, { reference, secret: input.secret }); await this.persist(); return structuredClone(reference); }
  async resolve(id: string, kind?: string) { const value = this.secrets.get(id); if (!value || (kind && value.reference.kind !== kind)) throw new Error("credential not found"); return value.secret; }
  async delete(id: string) { if (!this.secrets.delete(id)) throw new Error("credential not found"); await this.persist(); }
  private persist() { this.queue = this.queue.then(async () => { await mkdir(dirname(this.filePath), { recursive: true }); await writeFile(this.filePath, JSON.stringify([...this.secrets.values()], null, 2), { encoding: "utf8", mode: 0o600 }); }); return this.queue; }
}
