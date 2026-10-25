import { Virtuoso } from "react-virtuoso";
import type { ChatMessage } from "../lib/types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { useEffect, useState } from "react";

function ThinkingBlock({ thinking, isStreaming }: { thinking: string; isStreaming: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  if (!thinking) return null;
  /* useEffect(() => {
    setIsOpen(isStreaming);
    }, [isStreaming]);
    */
  return (
    <div className="mb-3 rounded-xl border border-white/10 bg-black/20 text-xs overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-3 py-2 text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2 font-medium">
          <span>🧠 Thinking</span>
          {isStreaming && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
          )}
        </div>
        <span className="text-[10px] opacity-60">{isOpen ? "Hide" : "Show"}</span>
      </button>

      {isOpen && (
        <div className="px-3 pb-3 pt-1 text-slate-400 font-mono text-[11px] leading-relaxed border-t border-white/5 whitespace-pre-wrap max-h-48 overflow-y-auto">
          {thinking}
        </div>
      )}
    </div>
  );
}


export function ChatContainer({ chat, companion }: { chat: ChatMessage[]; companion: string }) {
  return (
    <Virtuoso
      className="py-4 virtuoso-scroller"
      style={{ height: "100%" }}
      data={chat}
      computeItemKey={(_index, msg) => msg.id}
      itemContent={(_index, msg) => {
        const isThinkingStreaming = Boolean(msg.thinking && !msg.content);

        return (
          <div className="mb-5 px-4">
            <div
              className={`px-2 py-1 text-xs opacity-60 ${
                msg.role === "user" ? "text-right" : "text-left"
              }`}
            >
              {msg.role === "user" ? "You" : companion}
            </div>
            <div
              className={`mt-1 flex ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div className="mb-1 max-w-[90%] min-w-0 rounded-2xl px-4 py-3 bg-white/5">
                {msg.role === "assistant" && msg.thinking && (
                  <ThinkingBlock
                    thinking={msg.thinking}
                    isStreaming={isThinkingStreaming}
                  />
                )}

                {/* Main message text */}
                <MarkdownRenderer content={msg.content} />
              </div>
            </div>
          </div>
        );
      }}
    />
  );
}