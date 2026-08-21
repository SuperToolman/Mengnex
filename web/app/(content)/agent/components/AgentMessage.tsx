"use client";

import { FaceRobot } from "@gravity-ui/icons";
import { Card } from "@heroui/react";
import AgentMarkdown, { CopyButton } from "./AgentMarkdown";
import { ToolCallCard } from "./ToolCallCard";
import { ThinkBlock } from "./ThinkBlock";
import { textBlocks, type RenderedMessage } from "./types";

export function AssistantMessage({ message }: { message: RenderedMessage }) {
  const blocks = message.blocks ?? [];
  const content = textBlocks(blocks) || message.content;

  return (
    <Card.Root variant="secondary" className="w-full max-w-5xl min-w-0 shrink-0 self-start overflow-hidden">
      <Card.Header>
        <div className="flex min-h-8 items-center gap-2 text-sm font-semibold text-muted">
          <FaceRobot className="size-5 text-accent" />
          <span>{message.streaming ? "正在思考" : "Agent"}</span>
          <div className="ml-auto">
            {!message.streaming && content ? <CopyButton value={content} label="复制回复" /> : null}
          </div>
        </div>
      </Card.Header>
      <Card.Content className="min-w-0 pt-0">
        {blocks.map((block, index) => {
          if (block.type === "reasoning") {
            return <ThinkBlock key={`reasoning-${index}`} text={block.text} index={index} />;
          }
          if (block.type === "tool-call") {
            return <ToolCallCard key={block.callId} call={{ toolName: block.name, args: block.args, status: block.status, result: block.result, approvalId: block.approvalId, createdAt: block.startedAt, completedAt: block.completedAt }} />;
          }
          return <AgentMarkdown key={`text-${index}`} content={block.text} />;
        })}
        {!blocks.length && content ? <AgentMarkdown content={content} /> : null}
        {message.streaming && !content && !blocks.length ? <span className="block size-2 animate-pulse rounded-full bg-accent" aria-label="正在思考" /> : null}
      </Card.Content>
    </Card.Root>
  );
}
