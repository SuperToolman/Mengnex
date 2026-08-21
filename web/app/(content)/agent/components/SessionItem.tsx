"use client";

import { TrashBin } from "@gravity-ui/icons";
import { Button } from "@heroui/react";
import { archiveAgentSession, type AgentSession } from "@/src/features/agent/api";

type SessionItemProps = {
  session: AgentSession;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
  onClose?: () => void;
};

export function SessionItem({
  session,
  active,
  disabled,
  onSelect,
  onClose,
}: SessionItemProps) {
  async function archive() {
    if (onClose) return onClose();
    await archiveAgentSession(session.id, true);
    window.dispatchEvent(
      new CustomEvent("agent-session-closed", { detail: session.id }),
    );
  }

  return (
    <div className={`group flex items-center rounded-lg transition-colors ${active ? "bg-default" : "hover:bg-default"}`}>
      <Button
        type="button"
        variant="ghost"
        className="min-w-0 flex-1 justify-start bg-transparent hover:bg-transparent"
        onPress={onSelect}
        isDisabled={disabled}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {session.title || "新对话"}
        </span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        isIconOnly
        size="sm"
        aria-label="归档对话"
        className="mr-1 hidden shrink-0 group-hover:inline-flex"
        onPress={() => void archive()}
        isDisabled={disabled}
      >
        <TrashBin />
      </Button>
    </div>
  );
}
