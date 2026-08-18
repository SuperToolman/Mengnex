"use client";

import { ArrowRotateRight, BackwardStep, ForwardStep, Pause, PlayFill, Shuffle } from "@gravity-ui/icons";
import { Button, Slider, Tooltip } from "@heroui/react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { MusicTrackResponse } from "@/src/api/generated/types.gen";
import { getMusicLyrics, updateMusicPlayback } from "@/src/features/music/api";

type MusicPlayerContextValue = {
    current: MusicTrackResponse | null;
    queue: MusicTrackResponse[];
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    playMode: "sequence" | "shuffle" | "repeat_one";
    play: (track: MusicTrackResponse, queue?: MusicTrackResponse[]) => void;
    toggle: () => void;
    next: () => void;
    previous: () => void;
    cyclePlayMode: () => void;
    seek: (position: number) => void;
    setVolume: (volume: number) => void;
};

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null);

function sourceUrl(path: string) {
    const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
    return path.startsWith("http") || !base ? path : `${base}${path}`;
}

export function MusicPlayerProvider({ children }: { children: React.ReactNode }) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const currentRef = useRef<MusicTrackResponse | null>(null);
    const queueRef = useRef<MusicTrackResponse[]>([]);
    const playModeRef = useRef<MusicPlayerContextValue["playMode"]>("sequence");
    const [current, setCurrent] = useState<MusicTrackResponse | null>(null);
    const [queue, setQueue] = useState<MusicTrackResponse[]>([]);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolumeState] = useState(0.8);
    const [playMode, setPlayMode] = useState<MusicPlayerContextValue["playMode"]>("sequence");

    useEffect(() => {
        const audio = new Audio();
        audio.preload = "metadata";
        audio.volume = 0.8;
        audioRef.current = audio;
        const onTime = () => setCurrentTime(audio.currentTime);
        const onLoaded = () => {
            setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
            if (currentRef.current?.playback_position_seconds) audio.currentTime = currentRef.current.playback_position_seconds;
        };
        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);
        const onEnded = () => next();
        audio.addEventListener("timeupdate", onTime);
        audio.addEventListener("loadedmetadata", onLoaded);
        audio.addEventListener("play", onPlay);
        audio.addEventListener("pause", onPause);
        audio.addEventListener("ended", onEnded);
        return () => {
            audio.pause();
            void updateProgress(audio.currentTime, true);
            audio.removeEventListener("timeupdate", onTime);
            audio.removeEventListener("loadedmetadata", onLoaded);
            audio.removeEventListener("play", onPlay);
            audio.removeEventListener("pause", onPause);
            audio.removeEventListener("ended", onEnded);
            audioRef.current = null;
        };
        // The audio element is created once; current is read when a source is loaded.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function updateProgress(position: number, completed = false) {
        const active = currentRef.current;
        if (!active) return;
        try { await updateMusicPlayback(active.id, { position_seconds: position, completed }); } catch { /* playback persistence is best effort */ }
    }

    function load(track: MusicTrackResponse, shouldPlay: boolean) {
        const audio = audioRef.current;
        if (!audio) return;
        currentRef.current = track;
        setCurrent(track);
        audio.src = sourceUrl(track.stream_src);
        audio.load();
        if (shouldPlay) void audio.play().catch(() => setIsPlaying(false));
    }

    function play(track: MusicTrackResponse, nextQueue = queue) {
        const effectiveQueue = nextQueue.length > 0 ? nextQueue : [track];
        queueRef.current = effectiveQueue;
        setQueue(effectiveQueue);
        load(track, true);
    }

    function toggle() {
        const audio = audioRef.current;
        if (!audio || !current) return;
        if (audio.paused) void audio.play().catch(() => setIsPlaying(false)); else { audio.pause(); void updateProgress(audio.currentTime); }
    }

    function seek(position: number) {
        const audio = audioRef.current;
        if (!audio) return;
        audio.currentTime = Math.max(0, Math.min(position, Number.isFinite(audio.duration) ? audio.duration : position));
        setCurrentTime(audio.currentTime);
    }

    function setVolume(value: number) {
        const nextVolume = Math.max(0, Math.min(1, value));
        if (audioRef.current) audioRef.current.volume = nextVolume;
        setVolumeState(nextVolume);
    }

    function next() {
        const active = currentRef.current;
        const activeQueue = queueRef.current;
        if (!active || activeQueue.length === 0) return;
        if (playModeRef.current === "repeat_one") { load(active, true); return; }
        const index = activeQueue.findIndex((track) => track.id === active.id);
        const following = playModeRef.current === "shuffle" && activeQueue.length > 1
            ? activeQueue.filter((track) => track.id !== active.id)[Math.floor(Math.random() * (activeQueue.length - 1))]
            : activeQueue[(index + 1) % activeQueue.length];
        if (following) load(following, true);
    }

    function previous() {
        const active = currentRef.current;
        const activeQueue = queueRef.current;
        if (!active || activeQueue.length === 0) return;
        const index = activeQueue.findIndex((track) => track.id === active.id);
        const previousTrack = activeQueue[(index - 1 + activeQueue.length) % activeQueue.length];
        if (previousTrack) load(previousTrack, true);
    }

    function cyclePlayMode() {
        const nextMode = playModeRef.current === "sequence" ? "shuffle" : playModeRef.current === "shuffle" ? "repeat_one" : "sequence";
        playModeRef.current = nextMode;
        setPlayMode(nextMode);
    }

    // The command functions intentionally close over the current queue and audio element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const value = useMemo(() => ({ current, queue, isPlaying, currentTime, duration, volume, playMode, play, toggle, next, previous, cyclePlayMode, seek, setVolume }), [current, queue, isPlaying, currentTime, duration, volume, playMode]);
    return <MusicPlayerContext.Provider value={value}>{children}<MusicPlayerBar /></MusicPlayerContext.Provider>;
}

function MusicPlayerBar() {
    const player = useMusicPlayer();
    if (!player.current) return null;
    return <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 px-4 py-2 shadow-2xl backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3">
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{player.current.title}</p><p className="truncate text-xs text-muted">{player.current.artist ?? player.current.album_title ?? "本地音乐"}</p></div>
            <PlayerButton label="上一首" onPress={player.previous}><BackwardStep /></PlayerButton>
            <PlayerButton label={player.isPlaying ? "暂停" : "播放"} onPress={player.toggle} primary>{player.isPlaying ? <Pause /> : <PlayFill />}</PlayerButton>
            <PlayerButton label="下一首" onPress={player.next}><ForwardStep /></PlayerButton>
            <PlayerButton label={player.playMode === "sequence" ? "顺序播放" : player.playMode === "shuffle" ? "随机播放" : "单曲循环"} onPress={player.cyclePlayMode}>{player.playMode === "shuffle" ? <Shuffle /> : <ArrowRotateRight />}</PlayerButton>
            <div className="hidden w-72 items-center gap-2 md:flex"><span className="text-[11px] text-muted">{formatTime(player.currentTime)}</span><Slider aria-label="播放进度" className="flex-1" minValue={0} maxValue={Math.max(player.duration, 0)} step={0.1} value={Math.min(player.currentTime, player.duration || 0)} onChange={(value) => player.seek(Array.isArray(value) ? value[0] ?? 0 : value)}><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track></Slider><span className="text-[11px] text-muted">{formatTime(player.duration)}</span><Slider aria-label="音量" className="w-16" minValue={0} maxValue={1} step={0.01} value={player.volume} onChange={(value) => player.setVolume(Array.isArray(value) ? value[0] ?? player.volume : value)}><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track></Slider></div>
            <LyricsPreview trackId={player.current.id} currentTime={player.currentTime} />
        </div>
    </div>;
}

function LyricsPreview({ trackId, currentTime }: { trackId: string; currentTime: number }) {
    const [lines, setLines] = useState<{ time: number; text: string }[]>([]);
    useEffect(() => { let active = true; void getMusicLyrics(trackId).then((lyrics) => { if (active) setLines(parseLyrics(lyrics.content)); }).catch(() => { if (active) setLines([]); }); return () => { active = false; }; }, [trackId]);
    if (lines.length === 0) return null;
    const activeIndex = lines.reduce((result, line, index) => line.time <= currentTime ? index : result, 0);
    const offset = Math.max(activeIndex - 1, 0);
    return <div className="hidden h-10 max-w-52 overflow-hidden xl:block" aria-label="滚动歌词"><div className="space-y-1 transition-transform duration-300" style={{ transform: `translateY(-${offset * 20}px)` }}>{lines.map((line, index) => <p key={`${line.time}-${index}`} className={`truncate text-xs ${index === activeIndex ? "text-foreground" : "text-muted"}`}>{line.text}</p>)}</div></div>;
}

function parseLyrics(content?: string | null) { return (content ?? "").split(/\r?\n/).flatMap((line) => { const matches = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]; const text = line.replace(/\[\d+:\d+(?:\.\d+)?\]/g, "").trim(); return matches.map((match) => ({ time: Number(match[1]) * 60 + Number(match[2]), text })); }).filter((line) => line.text); }

function PlayerButton({ label, onPress, primary = false, children }: { label: string; onPress: () => void; primary?: boolean; children: React.ReactNode }) {
    return <Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant={primary ? "primary" : "ghost"} aria-label={label} onPress={onPress}>{children}</Button></Tooltip.Trigger><Tooltip.Content>{label}</Tooltip.Content></Tooltip>;
}

function formatTime(value: number) { if (!Number.isFinite(value)) return "0:00"; return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`; }
export function useMusicPlayer() { const context = useContext(MusicPlayerContext); if (!context) throw new Error("useMusicPlayer must be used inside MusicPlayerProvider"); return context; }
