import * as cordis from "cordis";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ToolContext } from "./types.js";

const MAX_FETCH_BYTES = 512 * 1024;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export type WebFetchResult = { url: string; finalUrl: string; status: number; contentType: string; content: string; truncated: boolean };
export type WebDownloadResult = { url: string; finalUrl: string; status: number; contentType: string; bytes: number; fileName: string; path: string };
export type WebSearchResult = { query: string; sources: Array<{ url: string; title?: string; snippet?: string; publishedAt?: string }>; truncated: boolean };

declare module "cordis" { interface Context { web: WebRuntime; } }

export class WebRuntime extends (cordis as any).Service {
  protected declare readonly ctx: cordis.Context;
  private readonly downloadDirectory: string;
  constructor(ctx: cordis.Context, downloadDirectory = join(process.cwd(), "data", "downloads")) { super(ctx, "web"); this.downloadDirectory = downloadDirectory; }
  async search(query: string, context: ToolContext): Promise<WebSearchResult> {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) throw new Error("web search is not configured; set EXA_API_KEY");
    const response = await fetch("https://api.exa.ai/search", { method: "POST", signal: context.signal, headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json", "user-agent": "Mengnex-Agent/0.1" }, body: JSON.stringify({ query, type: "auto", numResults: 8, contents: { highlights: { highlightsPerUrl: 1 } } }) });
    if (!response.ok) throw new Error(`web search failed with HTTP ${response.status}`);
    const payload = await response.json() as { results?: Array<{ url?: string; title?: string; publishedDate?: string; highlights?: string[] }> };
    const sources = (payload.results ?? []).filter((item) => typeof item.url === "string").map((item) => ({ url: item.url as string, ...(item.title ? { title: item.title } : {}), ...(item.highlights?.find((value) => value.trim()) ? { snippet: item.highlights.find((value) => value.trim()) } : {}), ...(item.publishedDate ? { publishedAt: item.publishedDate } : {}) }));
    return { query, sources, truncated: false };
  }
  async fetchPage(url: string, context: ToolContext): Promise<WebFetchResult> {
    const response = await request(url, context.signal, false);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { url, finalUrl: response.url, status: response.status, contentType: response.headers.get("content-type") ?? "application/octet-stream", content: new TextDecoder().decode(bytes.slice(0, MAX_FETCH_BYTES)), truncated: bytes.byteLength > MAX_FETCH_BYTES };
  }
  async download(url: string, context: ToolContext): Promise<WebDownloadResult> {
    const response = await request(url, context.signal, true);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_DOWNLOAD_BYTES) throw new Error("download exceeds the 50 MB limit");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new Error("download exceeds the 50 MB limit");
    const fileName = safeFileName(response.headers.get("content-disposition") ?? "", response.url);
    await mkdir(this.downloadDirectory, { recursive: true });
    const path = join(this.downloadDirectory, `${crypto.randomUUID()}-${fileName}`);
    await writeFile(path, bytes, { mode: 0o600 });
    return { url, finalUrl: response.url, status: response.status, contentType: response.headers.get("content-type") ?? "application/octet-stream", bytes: bytes.byteLength, fileName, path };
  }
}

async function request(input: string, signal: AbortSignal | undefined, download: boolean) {
  let current = validateUrl(input);
  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
    const response = await fetch(current, { redirect: "manual", signal, headers: { accept: download ? "*/*" : "text/html,text/plain,application/json;q=0.9,*/*;q=0.1", "user-agent": "Mengnex-Agent/0.1" } });
    if (response.status < 300 || response.status >= 400) {
      if (!response.ok) throw new Error(`web request failed with HTTP ${response.status}`);
      return response;
    }
    const location = response.headers.get("location");
    if (!location) throw new Error(`web request returned HTTP ${response.status} without a redirect location`);
    current = validateUrl(new URL(location, current).toString());
  }
  throw new Error("web request exceeded the redirect limit");
}

function validateUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("only HTTP(S) URLs are allowed");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host === "127.0.0.1" || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) throw new Error("private or local network URLs are not allowed");
  return url.toString();
}

function safeFileName(disposition: string, url: string) {
  const match = disposition.match(/filename\*?=(?:UTF-8''|\")?([^;\"]+)/i);
  const fallback = basename(new URL(url).pathname) || "download.bin";
  return ((match?.[1] ?? fallback).trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 160) || "download.bin");
}

export function createWebCapabilitiesPlugin() {
  return {
    name: "mengnex-web-capabilities",
    inject: [],
    async apply(ctx: cordis.Context) {
      const root = (ctx as any).root as cordis.Context;
      const fiber = await ((root as any).plugin(WebRuntime) as PromiseLike<{ dispose: () => Promise<void> }>);
      return () => fiber.dispose();
    },
  };
}
