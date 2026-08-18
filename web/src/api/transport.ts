import { client as generatedClient } from "./generated/client.gen";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export const sdkOptions = { throwOnError: true as const };

generatedClient.setConfig({
    baseUrl: API_BASE_URL,
    credentials: "include",
});

generatedClient.interceptors.response.use((response) => {
    if (response.status === 401 && typeof window !== "undefined") {
        const path = new URL(response.url).pathname;
        if (!path.startsWith("/api/auth/")) window.location.assign("/login");
    }
    return response;
});

export async function execute<T>(request: Promise<T>): Promise<T> {
    try {
        return await request;
    } catch (error) {
        if (error instanceof Error) {
            if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
                throw new Error("无法连接 API 服务，请先启动后端服务");
            }
            throw error;
        }
        if (error && typeof error === "object" && "message" in error) {
            throw new Error(String(error.message));
        }
        throw new Error("API 请求失败，请检查后端服务日志");
    }
}

export function toAbsoluteUrl(url?: string | null) {
    if (!url) return undefined;
    return url.startsWith("http") || !API_BASE_URL ? url : `${API_BASE_URL}${url}`;
}
