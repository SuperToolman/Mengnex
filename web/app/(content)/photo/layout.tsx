import PhotoSideBar from "./components/PhotoSideBar";
import { PhotoShellProvider } from "./components/PhotoShellContext";

export default function PhotoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <PhotoShellProvider>
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
                <PhotoSideBar />
                <main className="min-h-0 min-w-0 flex-1 overflow-auto px-4 py-4">
                    {children}
                </main>
            </div>
        </PhotoShellProvider>
    );
}
