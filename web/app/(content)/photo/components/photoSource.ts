export function isWebDavSourcePath(sourcePath?: string) {
    if (!sourcePath) {
        return false;
    }

    try {
        const url = new URL(sourcePath);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

export function getSourcePathSegments(sourcePath: string, sourceType?: string) {
    if (sourceType === "webdav" || isWebDavSourcePath(sourcePath)) {
        try {
            return new URL(sourcePath).pathname
                .split("/")
                .filter(Boolean)
                .map((segment) => decodeURIComponent(segment));
        } catch {
            return [];
        }
    }

    return sourcePath
        .replaceAll("\\", "/")
        .replace(/\/+/, "/")
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean);
}

export function formatSourceLocation(sourcePath?: string) {
    if (!sourcePath) {
        return "Unknown";
    }

    if (!isWebDavSourcePath(sourcePath)) {
        return sourcePath;
    }

    try {
        return decodeURIComponent(new URL(sourcePath).pathname);
    } catch {
        return sourcePath;
    }
}
