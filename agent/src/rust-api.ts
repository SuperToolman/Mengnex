import * as cordis from "cordis";
import type { Context } from "cordis";

declare module "cordis" {
  interface Context {
    rustApi: RustApiService;
  }
}

export class RustApiClient {
  constructor(
    private readonly baseUrl: string,
  ) {}

  async request<T>(path: string, init: RequestInit = {}, sessionCookie?: string): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (sessionCookie) headers.set("Cookie", sessionCookie);
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    const body = await response.text();
    const parsed = body ? JSON.parse(body) : undefined;
    if (!response.ok) throw new Error(parsed?.message ?? `Rust API request failed (${response.status})`);
    return parsed as T;
  }
}

export class RustApiService extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  private readonly client: RustApiClient;

  constructor(ctx: Context, baseUrl = process.env.RUST_API_URL ?? "http://127.0.0.1:7587") {
    super(ctx, "rustApi");
    this.client = new RustApiClient(baseUrl);
  }

  request<T>(path: string, init: RequestInit = {}, sessionCookie?: string) {
    return this.client.request<T>(path, init, sessionCookie);
  }
}
