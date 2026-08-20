import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as cordis from "cordis";
import type { Context } from "cordis";
import type { ConversationTurn } from "./conversation.js";

export type AgentSession = {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: ConversationTurn[];
};

const sessionsPath = join(process.cwd(), "data", "sessions.json");

declare module "cordis" {
  interface Context {
    sessions: SessionStore;
  }
}

export class SessionStore extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  private sessions = new Map<string, AgentSession>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(ctx: Context, private readonly filePath = sessionsPath) {
    super(ctx, "sessions");
  }

  async load() {
    try {
      const entries = JSON.parse(await readFile(this.filePath, "utf8")) as AgentSession[];
      if (entries.some((entry) => !Array.isArray(entry.turns))) throw new Error("agent session data uses an obsolete schema; remove agent/data/sessions.json");
      this.sessions = new Map(entries.map((entry) => [entry.id, entry]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  list(userId: string) {
    return [...this.sessions.values()]
      .filter((session) => session.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(userId: string, title = "新对话") {
    const now = new Date().toISOString();
    const session: AgentSession = { id: crypto.randomUUID(), userId, title, createdAt: now, updatedAt: now, turns: [] };
    this.sessions.set(session.id, session);
    await this.persist();
    return session;
  }

  getOwned(id: string, userId: string) {
    const session = this.sessions.get(id);
    if (!session || session.userId !== userId) throw new Error("agent session not found");
    return session;
  }

  async appendTurn(id: string, userId: string, turn: ConversationTurn) {
    const session = this.getOwned(id, userId);
    session.turns.push(turn);
    session.updatedAt = new Date().toISOString();
    await this.persist();
    return session;
  }

  private persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify([...this.sessions.values()], null, 2), { encoding: "utf8", mode: 0o600 });
    });
    return this.writeQueue;
  }
}
