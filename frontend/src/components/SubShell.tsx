// src/components/SubShell.tsx
import { useSubChat } from "../hooks/useSubChat";
import { ChatContainer } from "./ChatContainer";
import { useState, useRef } from "react";

export function SubShell({ show }: { show: boolean }) {
    const [SubShellWidth, setSubShellWidth] = useState(550);
    const SubShellHorizontalDrag = useRef({ mouseBeganAt: 0, startWidth: 550 });
    const [isSubShellDragging, setIsSubShellDragging] = useState(false);
    const {
        input,
        setInput,
        sendMessage,
        chat,
    } = useSubChat();
    function startHorizontalDrag(e: React.MouseEvent<HTMLDivElement>) {
        e.preventDefault(); // dont fucking select text when I drag with my mouse
        setIsSubShellDragging(true);
        SubShellHorizontalDrag.current = {
            mouseBeganAt: e.clientX,
            startWidth: SubShellWidth,
        };
        window.addEventListener("mousemove", onHorizontalMouseMove);
        window.addEventListener("mouseup", onMouseUp);
    }
    function onHorizontalMouseMove(e: MouseEvent) {
        const diff = e.clientX - SubShellHorizontalDrag.current.mouseBeganAt; // clientX is the secret word for current position
        const next = SubShellHorizontalDrag.current.startWidth - diff;
        setSubShellWidth(Math.min(1530, Math.max(140, next))); // max 160, next will keep the width at least 160; min 560 is setting the max to 560
    }

    function onMouseUp() {
        setIsSubShellDragging(false);
        window.removeEventListener("mousemove", onHorizontalMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
    }

    return (
        <div style={{ position: "relative", display: "flex", flexDirection: "row", height: "100%", width: show ? SubShellWidth : 0, overflow: "hidden", }}>
            <div style={{ width: 3, flexShrink: 0, cursor: "ew-resize", borderLeft: "4px solid hotpink", }}
                onMouseDown={startHorizontalDrag}
            />

                <main style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, }}>
                    <div style={{ display: "flex", flexDirection: "row", flex: 1, minHeight: 0, }}>
                        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, }}>
                            <div className="py-4" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                                <ChatContainer chat={chat} companion="SubChat" />
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
                                </div>
                            </footer>
                        </div>
                    </div>
                </main>

            {isSubShellDragging && (
                <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, cursor: "none", }}/>
            )}
        </div>
    );
}
