import PhotoSideBar from "./components/PhotoSideBar";
import { PhotoShellProvider } from "./components/PhotoShellContext";
import MediaLibraryLayout from "@/app/components/MediaLibraryLayout";

export default function PhotoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <PhotoShellProvider>
            <MediaLibraryLayout
                title="照片"
                description="按拍摄日期浏览照片媒体库。"
                header={<PhotoSideBar />}
            >
                {children}
            </MediaLibraryLayout>
        </PhotoShellProvider>
    );
}
