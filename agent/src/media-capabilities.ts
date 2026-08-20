import * as cordis from "cordis";
import type { Context } from "cordis";
import type { ToolContext } from "./types.js";

export type MediaItemSummary = { id: string; title: string; media_type: string; library_id: string };
export type MediaLibrarySummary = { id: string; name: string; media_type: string; enabled: boolean };
export type ExternalMediaImport = {
  libraryId: string;
  title: string;
  source: string;
  externalId: string;
  sourceUrl?: string;
  year?: number;
  metadata?: Record<string, unknown>;
};

export abstract class MediaCatalog extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  protected constructor(ctx: Context, key = "mediaCatalog") { super(ctx, key); }
  abstract search(query: string, limit: number, context: ToolContext, libraryId?: string): Promise<MediaItemSummary[]>;
}

export abstract class LibraryAccess extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  protected constructor(ctx: Context, key = "libraryAccess") { super(ctx, key); }
  abstract list(context: ToolContext): Promise<MediaLibrarySummary[]>;
  abstract assertAccessible(libraryId: string, context: ToolContext): Promise<MediaLibrarySummary>;
}

export abstract class MediaScanner extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  protected constructor(ctx: Context, key = "mediaScanner") { super(ctx, key); }
  abstract list(context: ToolContext): Promise<unknown[]>;
  abstract enqueue(libraryId: string, context: ToolContext): Promise<unknown>;
}

export abstract class MediaTasks extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  protected constructor(ctx: Context, key = "mediaTasks") { super(ctx, key); }
  abstract list(active: boolean | undefined, context: ToolContext): Promise<unknown[]>;
}

export abstract class ExternalMediaSources extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  protected constructor(ctx: Context, key = "externalMediaSources") { super(ctx, key); }
  abstract import(item: ExternalMediaImport, context: ToolContext): Promise<unknown>;
}

/** A provider-neutral metadata boundary for future local, MCP, and remote enrichers. */
export abstract class MediaMetadata extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  protected constructor(ctx: Context, key = "mediaMetadata") { super(ctx, key); }
  abstract describe(item: MediaItemSummary): Record<string, unknown>;
}

declare module "cordis" {
  interface Context {
    mediaCatalog: MediaCatalog;
    libraryAccess: LibraryAccess;
    mediaScanner: MediaScanner;
    mediaTasks: MediaTasks;
    externalMediaSources: ExternalMediaSources;
    mediaMetadata: MediaMetadata;
  }
}

export class RustLibraryAccess extends LibraryAccess {
  static inject = ["rustApi"];
  constructor(ctx: Context) { super(ctx); }
  async list(context: ToolContext): Promise<MediaLibrarySummary[]> {
    return this.ctx.rustApi.request<MediaLibrarySummary[]>("/api/libraries", {}, context.sessionCookie);
  }
  async assertAccessible(libraryId: string, context: ToolContext): Promise<MediaLibrarySummary> {
    const library = (await this.list(context)).find((entry) => entry.id === libraryId);
    if (!library) throw new Error("media library is not accessible");
    if (!library.enabled) throw new Error("media library is disabled");
    return library;
  }
}

export class RustMediaCatalog extends MediaCatalog {
  static inject = ["rustApi"];
  constructor(ctx: Context) { super(ctx); }
  async search(query: string, limit: number, context: ToolContext, libraryId?: string) {
    const items = await this.ctx.rustApi.request<MediaItemSummary[]>(`/api/media/items?limit=${limit}`, {}, context.sessionCookie);
    const normalized = query.trim().toLocaleLowerCase();
    return items.filter((item) => (!libraryId || item.library_id === libraryId) && (!normalized || item.title.toLocaleLowerCase().includes(normalized)));
  }
}

export class RustMediaScanner extends MediaScanner {
  static inject = ["rustApi", "libraryAccess"];
  constructor(ctx: Context) { super(ctx); }
  list(context: ToolContext) { return this.ctx.rustApi.request<unknown[]>("/api/scans", {}, context.sessionCookie); }
  async enqueue(libraryId: string, context: ToolContext) {
    await this.ctx.libraryAccess.assertAccessible(libraryId, context);
    return this.ctx.rustApi.request("/api/scans", { method: "POST", body: JSON.stringify({ library_id: libraryId }) }, context.sessionCookie);
  }
}

export class RustMediaTasks extends MediaTasks {
  static inject = ["rustApi"];
  constructor(ctx: Context) { super(ctx); }
  list(active: boolean | undefined, context: ToolContext) {
    const query = active === undefined ? "" : `?active=${active}`;
    return this.ctx.rustApi.request<unknown[]>(`/api/tasks${query}`, {}, context.sessionCookie);
  }
}

export class RustExternalMediaSources extends ExternalMediaSources {
  static inject = ["rustApi", "libraryAccess"];
  constructor(ctx: Context) { super(ctx); }
  async import(item: ExternalMediaImport, context: ToolContext) {
    await this.ctx.libraryAccess.assertAccessible(item.libraryId, context);
    return this.ctx.rustApi.request("/api/media/import", {
      method: "POST",
      body: JSON.stringify({
        library_id: item.libraryId,
        title: item.title,
        source: item.source,
        external_id: item.externalId,
        source_url: item.sourceUrl,
        year: item.year,
        metadata: item.metadata,
      }),
    }, context.sessionCookie);
  }
}

export class IndexedMediaMetadata extends MediaMetadata {
  constructor(ctx: Context) { super(ctx); }
  describe(item: MediaItemSummary) {
    return { id: item.id, title: item.title, mediaType: item.media_type, libraryId: item.library_id, source: "indexed_catalog" };
  }
}

export function createRustMediaCapabilitiesPlugin() {
  return {
    name: "mengnex-rust-media-capabilities",
    inject: ["rustApi"],
    async apply(ctx: Context) {
      const root = (ctx as any).root as Context;
      const install = async (plugin: unknown) => await ((root as any).plugin(plugin) as PromiseLike<{ dispose: () => Promise<void> }>);
      const fibers = [
        await install(RustLibraryAccess),
        await install(RustMediaCatalog),
        await install(RustMediaScanner),
        await install(RustMediaTasks),
        await install(RustExternalMediaSources),
        await install(IndexedMediaMetadata),
      ];
      return async () => {
        for (const fiber of fibers.reverse()) await fiber.dispose();
      };
    },
  };
}
