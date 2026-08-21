"use client";

import { ArrowChevronDown, Code } from "@gravity-ui/icons";
import { Accordion, Surface } from "@heroui/react";
import { CopyButton } from "./AgentMarkdown";
import type { AgentToolCall } from "@/src/features/agent/api";

const json = (value: unknown) => JSON.stringify(value, null, 2);
const toolTitle = (name: string) => name.split(/[._]/, 2).join(" · ");

export function ToolCallCard({ call }: { call: AgentToolCall }) {
  const running = call.status === "running";

  return (
    <Accordion.Root
      className="mx-0 gap-0"
      defaultExpandedKeys={running ? [call.toolName] : []}
    >
      <Accordion.Item id={call.toolName} className="mx-0">
        <Accordion.Heading className="mx-0">
          <Accordion.Trigger className="mx-0 min-w-0 px-0 hover:!bg-transparent data-[hovered=true]:!bg-transparent data-[focused=true]:!bg-transparent">
            <Code className="size-4" />
            <span className="min-w-0 flex-1 truncate text-xs text-muted">
              Tool · {toolTitle(call.toolName)}
            </span>
            <Accordion.Indicator className="shrink-0">
              <ArrowChevronDown />
            </Accordion.Indicator>
          </Accordion.Trigger>
        </Accordion.Heading>
        <Accordion.Panel className="px-0">
          <Surface className="rounded-2xl">
            <div className="divide-y divide-default">
              <section className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-4 p-3">
                <h3 className="pt-1 text-xs text-muted">参数</h3>
                <div className="relative min-w-0">
                  <CopyButton
                    value={json(call.args)}
                    label="复制参数"
                    className="hover:bg-transparent"
                    triggerClassName="absolute right-0 top-0"
                  />
                  <pre className="m-0 max-h-72 overflow-auto pr-8 text-xs">{json(call.args)}</pre>
                </div>
              </section>
              {call.result !== undefined ? (
                <section className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-4 p-3">
                  <span className="pt-1 text-xs text-muted">结果</span>
                  <div className="relative min-w-0">
                    <CopyButton
                      value={json(call.result)}
                      label="复制结果"
                      className="hover:bg-transparent"
                      triggerClassName="absolute right-0 top-0"
                    />
                    <pre className="m-0 max-h-72 overflow-auto pr-8 text-xs">{json(call.result)}</pre>
                  </div>
                </section>
              ) : null}
            </div>
          </Surface>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion.Root>
  );
}
