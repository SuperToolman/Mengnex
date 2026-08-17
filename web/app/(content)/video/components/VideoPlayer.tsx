"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type VideoPlayerProps = {
    src: string;
    poster?: string | null;
    autoPlay?: boolean;
    onLoadedMetadata?: () => void;
    onPause?: () => void;
    onEnded?: () => void;
    onError?: () => void;
};

const VideoPlayer = forwardRef<HTMLVideoElement, VideoPlayerProps>(function VideoPlayer({
    src,
    poster,
    autoPlay = false,
    onLoadedMetadata,
    onPause,
    onEnded,
    onError,
}, forwardedRef) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const loadedSourceRef = useRef<string | null>(null);

    useImperativeHandle(forwardedRef, () => videoRef.current!, []);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || loadedSourceRef.current === src) return;
        loadedSourceRef.current = src;
        video.src = src;
        video.poster = poster ?? "";
        video.load();
    }, [poster, src]);

    return <video ref={videoRef} controls autoPlay={autoPlay} playsInline preload="metadata" className="h-full w-full bg-black object-contain" onLoadedMetadata={onLoadedMetadata} onPause={onPause} onEnded={onEnded} onError={onError} />;
});

export default VideoPlayer;
