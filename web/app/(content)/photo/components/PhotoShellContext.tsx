"use client";

import {
    createContext,
    useContext,
    useMemo,
    useState,
    type ReactNode,
} from "react";

export type PhotoScaleMode = "folder-columns" | "photo-height" | "none";

export type PhotoBreadcrumb = {
    key: string;
    label: string;
    onPress: () => void;
};

type PhotoShellContextValue = {
    searchQuery: string;
    setSearchQuery: (value: string) => void;
    scaleLevel: number;
    setScaleLevel: (value: number) => void;
    scaleMode: PhotoScaleMode;
    setScaleMode: (value: PhotoScaleMode) => void;
    breadcrumbs: PhotoBreadcrumb[];
    setBreadcrumbs: (value: PhotoBreadcrumb[]) => void;
};

const PhotoShellContext = createContext<PhotoShellContextValue | null>(null);

export function PhotoShellProvider({ children }: { children: ReactNode }) {
    const [searchQuery, setSearchQuery] = useState("");
    const [scaleLevel, setScaleLevel] = useState(1);
    const [scaleMode, setScaleMode] = useState<PhotoScaleMode>("none");
    const [breadcrumbs, setBreadcrumbs] = useState<PhotoBreadcrumb[]>([]);

    const value = useMemo<PhotoShellContextValue>(() => ({
        searchQuery,
        setSearchQuery,
        scaleLevel,
        setScaleLevel,
        scaleMode,
        setScaleMode,
        breadcrumbs,
        setBreadcrumbs,
    }), [breadcrumbs, scaleLevel, scaleMode, searchQuery]);

    return (
        <PhotoShellContext.Provider value={value}>
            {children}
        </PhotoShellContext.Provider>
    );
}

export function usePhotoShell() {
    const context = useContext(PhotoShellContext);

    if (!context) {
        throw new Error("usePhotoShell must be used within PhotoShellProvider");
    }

    return context;
}
