// src/hooks/useChat.ts
// Minimum features for the most basic chat, I don't need anything else for this toy

import { useState, useRef, useCallback } from "react";
import type { ChatMessage, Settings } from "../lib/types";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

interface UseChatOptions {
  onToggleWorkbench?: () => void;
  onToggleSubShell?: () => void;
}

// companions map live in this file


export function useChat(options?: UseChatOptions) {
  const [input, setInput] = useState(""); // Keep track of user input
  const [chat, setChat] = useState<ChatMessage[]>([]); // List of chat messages, ChatMessage type is imported from types.ts
  const chatContainerRef = useRef<HTMLDivElement>(null!);
  const generateId = () => Math.random().toString(36).substring(2, 9);
  const [settings, setSettings] = useState<Settings | null>(null);
  
  const companionMap: Record<string, string> = {
    "--companion phoebe": "Phoebe",
    "-c phoebe": "Phoebe",
    "--companion grok": "Grok",
    "-c grok": "Grok",
    "--companion grok_4.3": "Grok 4.3",
    "-c grok_4.3": "Grok 4.3",
  };

  const modelMap: Record<string, string> = {
    "--model qwen": "Qwen3.8-27B-UD-Q4_K_M",
    "-m qwen": "Qwen3.8-27B-UD-Q4_K_M",
    "--model grok-4.7": "grok-4.7",
    "-m grok-4.7": "grok-4.7",
    "--model grok-4.3": "grok-4.3",
    "-m grok-4.3": "grok-4.3",
  };
  
  const reasoningLevelMap: Record<string, string> = {
    "--reasoning_level low": "low",
    "-r low": "low",
    "--reasoning_level medium": "medium",
    "-r medium": "medium",
    "--reasoning_level xhigh": "xhigh",
    "-r xhigh": "xhigh",
  };
  
  async function downloadChat(chat: ChatMessage[]) {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const path = await save({
      defaultPath: `chat_with_${settings?.companion}(${settings?.model})_${timestamp}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;

    await invoke("write_file", {
      path,
      content: JSON.stringify(chat, null, 2),
    });
  }
  
  // useCallback: if dep [input] renders, and input has changed, create a new sendMessage
  const sendMessage = useCallback(async () => {
    const userInput = input;
    if (!userInput) return;
    if (userInput === "--save" || userInput === "-s") {
      await downloadChat(chat);
      setInput("");
      return;
    }
    if (userInput === "--workbench" || userInput === "-w") {
      options?.onToggleWorkbench?.();
      setInput("");
      return;
    }
    if (userInput === "--subshell" || userInput === "-ss" || userInput === "--subchat" || userInput === "-sc") {
      options?.onToggleSubShell?.();
      setInput("");
      return;
    }
    if (userInput === "--compaction" || userInput === "-cp" || userInput === "--compact" || userInput === "-cm") {
      await compactionChat();
      setInput("");
      return;
    }
    if (userInput === "--clear" || userInput === "-c") {
      await clearChat();
      return;
    }
    if (userInput === "--reboot") {
      await restartEngine();
      return;
    }
    if (userInput === "--killengine" || userInput === "-k") {
      await killEngine();
      return;
    }
    const companionName = companionMap[userInput];
    if (companionName) {
      await changeCompanion(companionName);
      setInput("");
      return;
    }
    const modelName = modelMap[userInput];
    if (modelName) {
      await changeModel(modelName);
      setInput("");
      return;
    }
    const reasoningLevel = reasoningLevelMap[userInput];
    if (reasoningLevel) {
      await changeReasoningLevel(reasoningLevel);
      setInput("");
      return;
    }
    if (userInput === "--phoebe" || userInput === "-p") {
      await changeModel("Qwen3.8-27B-UD-Q4_K_M");
      await changeCompanion("Phoebe");
      await changeReasoningLevel("low");
      setInput("");
      return;
    }
    if (userInput === "--grok" || userInput === "-g") {
      await changeModel("grok-4.7");
      await changeCompanion("Grok");
      await changeReasoningLevel("low");
      setInput("");
      return;
    }
    if (userInput === "--grok43" || userInput === "-g43") {
      await changeModel("grok-4.3");
      await changeCompanion("Grok 4.3");
      await changeReasoningLevel("low");
      setInput("");
      return;
    }
    if (userInput === "--exit" || userInput === "-e" || userInput === "--quit" || userInput === "-q") {
      const appWindow = getCurrentWindow();
      await appWindow.close();
      return;
    }

    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content: userInput,
    };
    setInput(""); // once its sent empty the field
    setChat((prev: ChatMessage[]) => [...prev, userMessage]); // Add new message to the list

    const assistantMessageId = generateId();
    setChat((prev) => [
      ...prev,
      { id: assistantMessageId, role: "assistant", content: "", thinking: "" },
    ]); // Add placeholder assistant message to chat

    try {
      const response = await fetch("http://localhost:6969/response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: userInput,
        }),
      });
      if (!response.ok) throw new Error("API error");
      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader(); // Get a reader from the response body stream
      const decoder = new TextDecoder(); // Decoder to convert Uint8Array chunks to string
      let assistantContent = "";
      let assistantThinking = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break; // Exit loop if stream is done

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6); // Remove "data: " prefix
            try {
              const parsed = JSON.parse(data);

              if (parsed.reasoning) {
                assistantThinking += parsed.reasoning;
                setChat((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, thinking: assistantThinking }
                      : msg
                  )
                );
              }

              if (parsed.content) {
                assistantContent += parsed.content;
                // Update the assistant message in chat
                setChat((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: assistantContent }
                      : msg,
                  ),
                );
              }
            } catch { }
          }
        }
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        console.log("Fetch aborted");
      } else {
        console.error("Error during fetch:", error);
        setChat((prev) => prev.filter((msg) => msg.id !== assistantMessageId)); // Remove placeholder on error
      }
    }
  }, [input]);

  const clearChat = async () => {
    const response = await fetch("http://localhost:6969/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (response.ok) {
      setChat([]);
    }
  };

  const compactionChat = async () => {
    const response = await fetch("http://localhost:6969/compaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (response.ok) {
      console.log("Compaction successful");
    }
  };
  const restartEngine = async () => {
    await fetch("http://localhost:6969/restartengine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  };
  const killEngine = async () => {
    await fetch("http://localhost:6969/killengine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  };
  const changeCompanion = async (choice: string) => {
    await fetch("http://localhost:6969/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companion: choice }),
    });
    const latestSettings = await getSettings();
    if (latestSettings) {
      setSettings(latestSettings);
    }
  };

  const changeModel = async (choice: string) => {
    await fetch("http://localhost:6969/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: choice }),
    });
    const latestSettings = await getSettings();
    if (latestSettings) {
      setSettings(latestSettings);
    }
  };

  const changeReasoningLevel = async (choice: string) => {
  await fetch("http://localhost:6969/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reasoning_level: choice }),
  });
    const latestSettings = await getSettings();
    if (latestSettings) {
      setSettings(latestSettings);
    }
  };

  const getSettings = useCallback(async () => {
    try {
      const response = await fetch("http://localhost:6969/settings", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        return null;
      }
      return await response.json();
    } catch {
      return null;
    }
  }, []);

  return {
    input,
    setInput,
    chat,
    setChat,
    chatContainerRef,
    sendMessage,
    clearChat,
    restartEngine,
    killEngine,
    changeCompanion,
    changeModel,
    changeReasoningLevel,
    getSettings,
    settings,
    setSettings,
  };
}
