// src/hooks/useSubChat.ts
// Minimum features for the most basic chat, I don't need anything else for this toy

import { useState, useRef, useCallback } from "react";
import type { ChatMessage, Settings } from "../lib/types";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

export function useSubChat() {
  const [input, setInput] = useState(""); // Keep track of user input
  const [chat, setChat] = useState<ChatMessage[]>([]); // List of chat messages, ChatMessage type is imported from types.ts
  const chatContainerRef = useRef<HTMLDivElement>(null!);
  const generateId = () => Math.random().toString(36).substring(2, 9);
  const [settings, setSettings] = useState<Settings | null>(null);
   
  async function downloadChat(chat: ChatMessage[]) {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const path = await save({
      defaultPath: `subchat_${timestamp}.json`,
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
    if (userInput === "--clear" || userInput === "-c") {
      await clearChat();
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
      const response = await fetch("http://localhost:6969/subchat/response", {
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
    const response = await fetch("http://localhost:6969/subchat/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (response.ok) {
      setChat([]);
    }
  };

  return {
    input,
    setInput,
    chat,
    setChat,
    chatContainerRef,
    sendMessage,
    clearChat,
    settings,
    setSettings,
  };
}
