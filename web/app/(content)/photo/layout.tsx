import PhotoSideBar from "./components/PhotoSideBar";
import { PhotoShellProvider } from "./components/PhotoShellContext";
import ContentPageLayout from "@/app/components/ContentPageLayout";

export default function PhotoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <PhotoShellProvider>
            <ContentPageLayout
                title="照片"
                description="按拍摄日期浏览照片媒体库。"
                header={<PhotoSideBar />}
            >
                {children}
            </ContentPageLayout>
        </PhotoShellProvider>
    );
}
