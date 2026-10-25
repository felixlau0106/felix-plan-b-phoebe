// src/components/Shell.tsx
import { useChat } from "../hooks/useChat";
import { Send } from "lucide-react";
import { ChatContainer } from "./ChatContainer"
import { useEffect, useState } from "react";
import { CodeWorkbench } from "./CodeWorkbench";
import { SubShell } from "./SubShell";
export function Shell() {
    const [showWorkbench, setShowWorkbench] = useState(false);
    const [showSubShell, setShowSubShell] = useState(false);
    const { input, setInput, sendMessage, chat, settings, getSettings, setSettings } = useChat({
        onToggleWorkbench: () => setShowWorkbench((prev) => !prev),
        onToggleSubShell: () => setShowSubShell((prev) => !prev),
    }); // wire the names used in textarea to the useChat.ts

    useEffect(() => {
        let run = true;
        async function fetchSettings() {
            while (run) {
                try {
                    const result = await getSettings();
                    if (!run) return;
                    if (result) {
                        setSettings(result);
                        return;
                    }
                } catch {}
                if (!run) return;
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        void fetchSettings();
        return () => {
            run = false;
        };
    }, [getSettings]);

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100%", overflow: "hidden" }}>
            <header
                data-tauri-drag-region
                className="w-full h-[69px] flex items-center px-4"
            >
                <img data-tauri-drag-region
                    src="icon.png"
                    alt="icon"
                    className="w-24 h-24 object-contain">
                </img>
                <div className="flex-1 items-end flex flex-col">
                    <div className="text-xs text-gray-300">
                        Companion: {settings?.companion ?? "Loading…"}
                    </div>
                    <div className="text-xs text-gray-300">
                        Model: {settings?.model ?? "Loading…"}
                    </div>
                    <div className="text-xs text-gray-300">
                        Reasoning Level: {settings?.reasoning_level ?? "Loading…"}
                    </div>
                </div>
            </header>

            <main style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                <div style={{ display: "flex", flexDirection: "row", flex: 1, minHeight: 0 }}>
                    <CodeWorkbench show={showWorkbench} />
                    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                        <div className="py-4"
                            style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                            <ChatContainer chat={chat} companion={settings?.companion ?? "Loading…"} />
                        </div>
                        <footer className="shrink-0 p-3">
                            <div className="inputbox flex gap-3 flex-1 resize-none rounded-lg border border-gray-600 bg-gray-900/50 px-4 py-3 ">
                                <textarea
                                    className="inputboxinner w-full"
                                    rows={3}
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && !e.shiftKey) {
                                            e.preventDefault();
                                            void sendMessage();
                                        }
                                    }}
                                    placeholder="Type here…"
                                />

                                {/* Send Button */}
                                <button
                                    onClick={() => void sendMessage()}
                                    title="Send"
                                >
                                    <Send />
                                </button>

                            </div>
                        </footer>
                    </div>
                    <SubShell show={showSubShell} />
                </div>
            </main>
        </div>
    );
}