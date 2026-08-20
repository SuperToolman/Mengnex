"use client";

import { Check, Copy } from "@gravity-ui/icons";
import { Button, Tooltip, Typography } from "@heroui/react";
import { Fragment, type ReactNode, useState } from "react";

type MarkdownBlock = { type: "code"; language: string; content: string } | { type: "text"; content: string };

function splitBlocks(source: string): MarkdownBlock[] {
    const blocks: MarkdownBlock[] = [];
    const expression = /```([^\n`]*)\n?([\s\S]*?)```/g;
    let position = 0;
    for (const match of source.matchAll(expression)) {
        if (match.index! > position) blocks.push({ type: "text", content: source.slice(position, match.index) });
        blocks.push({ type: "code", language: match[1].trim(), content: match[2].replace(/\n$/, "") });
        position = match.index! + match[0].length;
    }
    if (position < source.length) blocks.push({ type: "text", content: source.slice(position) });
    return blocks;
}

function safeHref(value: string) { return /^(https?:|mailto:)/i.test(value) ? value : undefined; }

function inline(source: string): ReactNode[] {
    const chunks = source.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g);
    return chunks.filter(Boolean).map((chunk, index) => {
        if (chunk.startsWith("`") && chunk.endsWith("`")) return <Typography.Code key={index}>{chunk.slice(1, -1)}</Typography.Code>;
        if (chunk.startsWith("**") && chunk.endsWith("**")) return <strong key={index}>{chunk.slice(2, -2)}</strong>;
        const link = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(chunk);
        if (link) { const href = safeHref(link[2]); return href ? <a key={index} href={href} target="_blank" rel="noreferrer">{link[1]}</a> : link[1]; }
        return <Fragment key={index}>{chunk}</Fragment>;
    });
}

function TextBlock({ content }: { content: string }) {
    const lines = content.split("\n"); const nodes: ReactNode[] = []; let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) { index += 1; continue; }
        const heading = /^(#{1,3})\s+(.+)$/.exec(line);
        if (heading) { const level = heading[1].length + 1 as 2 | 3 | 4; nodes.push(<Typography.Heading key={index} level={level}>{inline(heading[2])}</Typography.Heading>); index += 1; continue; }
        if (line.startsWith("> ")) { nodes.push(<Typography.Paragraph key={index} color="muted">{inline(line.slice(2))}</Typography.Paragraph>); index += 1; continue; }
        const list = /^[-*]\s+(.+)$/.exec(line); const ordered = /^\d+\.\s+(.+)$/.exec(line);
        if (list || ordered) { const items: ReactNode[] = []; const isOrdered = Boolean(ordered); while (index < lines.length) { const item = isOrdered ? /^\d+\.\s+(.+)$/.exec(lines[index]) : /^[-*]\s+(.+)$/.exec(lines[index]); if (!item) break; items.push(<li key={index}>{inline(item[1])}</li>); index += 1; } nodes.push(isOrdered ? <ol key={`list-${index}`}>{items}</ol> : <ul key={`list-${index}`}>{items}</ul>); continue; }
        const paragraph: string[] = [line]; index += 1;
        while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s|^> |^[-*]\s+|^\d+\.\s+/.test(lines[index])) paragraph.push(lines[index++]);
        nodes.push(<Typography.Paragraph key={index}>{paragraph.map((value, lineIndex) => <Fragment key={lineIndex}>{lineIndex ? <br /> : null}{inline(value)}</Fragment>)}</Typography.Paragraph>);
    }
    return <>{nodes}</>;
}

export function CopyButton({ value, label = "复制" }: { value: string; label?: string }) {
    const [copied, setCopied] = useState(false);
    async function copy() { await navigator.clipboard?.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
    return <Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label={copied ? "已复制" : label} onPress={() => void copy()}>{copied ? <Check /> : <Copy />}</Button></Tooltip.Trigger><Tooltip.Content>{copied ? "已复制" : label}</Tooltip.Content></Tooltip>;
}

export default function AgentMarkdown({ content }: { content: string }) {
    return <Typography.Prose>{splitBlocks(content).map((block, index) => block.type === "code" ? <div key={index} className="my-3 overflow-hidden rounded-lg border border-default"><div className="flex items-center justify-between border-b border-default px-3 py-1 text-xs text-muted"><span>{block.language || "text"}</span><CopyButton value={block.content} label="复制代码" /></div><pre className="overflow-auto p-3 text-xs"><Typography.Code>{block.content}</Typography.Code></pre></div> : <TextBlock key={index} content={block.content} />)}</Typography.Prose>;
}
