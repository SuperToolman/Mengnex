import type { AgentContentBlock } from "@/src/features/agent/api";

export type RenderedMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  blocks?: AgentContentBlock[];
  streaming?: boolean;
};

export const textBlocks = (blocks: AgentContentBlock[]) =>
  blocks
    .filter(
      (block): block is Extract<AgentContentBlock, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("\n\n");
