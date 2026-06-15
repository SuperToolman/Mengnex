import PhotoSideBar from "./components/PhotoSideBar";

export default function PhotoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <div className="flex h-full min-h-0 overflow-hidden">
            <PhotoSideBar />
            <main className="min-w-0 flex-1 overflow-auto px-4 py-1">
                {children}
            </main>
        </div>
    );
}
