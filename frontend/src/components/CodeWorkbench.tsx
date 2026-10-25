import { useState, useRef, useEffect } from "react";
import Editor from "@monaco-editor/react"
import { editor } from "monaco-editor";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css"
import { invoke } from "@tauri-apps/api/core"
import { open, save } from "@tauri-apps/plugin-dialog"
import { FilePlusCorner, FolderOpen, SaveCheck, SavePen } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
// This is example code from AI, need to review or this will be vibe coding.
function EmbeddedTerminal({ show }: { show: boolean }) {
    const terminalRef = useRef<HTMLDivElement | null>(null);
    const termInstance = useRef<Terminal | null>(null);
    const fitAddon = useRef<FitAddon | null>(null);

    useEffect(() => {
        const termRef = terminalRef.current
        if (!termRef) return;
        const term = new Terminal({
            cursorBlink: true,
            fontSize: 12,
            fontFamily: "Fira Code, Consolas, monospace",
            theme: { background: "#0b0c0e", foreground: "#c9d1d9" },
            convertEol: true,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(termRef); // termRef is the <div>, term is the canvas. `Draw this fucking thing in this div!`
        fit.fit(); // make it look nice NOW
        const dataListener = term.onData((data) => {
            invoke("write_to_pty", { data });
        });
        const handleClick = () => term.focus()
        termRef.addEventListener("click", handleClick);
        const resizeObserver = new ResizeObserver(() => {
            fit.fit()
        });
        resizeObserver.observe(termRef);
        termInstance.current = term;
        fitAddon.current = fit;
        
        // listen() is tauri promising me `I will run the code and hand you back a unlisten button!` thats why the variable name is unlistenPromise
        const unlistenPromise = listen<string>("pty-output", (event) => {
            term.write(event.payload);
        });
        invoke("init_pty")
        return () => { // runs when component unmounts (disappear from DOM)
            termRef.removeEventListener("click", handleClick);
            resizeObserver.disconnect();
            dataListener.dispose();
            term.dispose();
            termInstance.current = null;
            fitAddon.current = null;
            unlistenPromise.then((unlisten) => unlisten());
        }
    }, []);

    useEffect(() => {
        if (show && termInstance.current && fitAddon.current) {
            requestAnimationFrame(() => {
                fitAddon.current?.fit();
                termInstance.current?.focus();
            });
        }
    }, [show]);

    return (
        <div
            ref={terminalRef} // this is not `assign null to ref`, it is `here is a box, when create this div put a *direct pointer to it* inside terminalRef.current`
            className="pl-4"
            style={{ width: "100%", height: "100%", overflow: "hidden", background: "black", display: "flex", flexDirection: "column" }}
        />
    );
}

export function CodeWorkbench({ show }: { show: boolean }) {
    const [width, setWidth] = useState(550);
    const horizontalDrag = useRef({ mouseBeganAt: 0, startWidth: 550 });
    const [terminalHeight, setTerminalHeight] = useState(90)
    const verticalDrag = useRef({ mouseBeganAt: 0, startHeight: 90 });
    const [filePath, setFilePath] = useState<string | null>(null);
    const [isUnsaved, setIsUnsaved] = useState(false);
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    function newFile() {
        editorRef.current?.setValue("");
        setIsUnsaved(true);
        setFilePath(null)
    };
    async function openFile() {
        const path = await open({
            multiple: false,
            directory: false,
        });
        if (!path) return;
        setFilePath(path);
        setIsUnsaved(false);
        const content: string = await invoke("read_file", { path });
        if (content !== undefined) {
            editorRef.current?.setValue(content);
        };
    };
    async function saveFile() {
        if (!isUnsaved) return;
        const content = editorRef.current?.getValue();

        // my original idea, newFile will make the filePath be null so this button becomes save as.
        if (!filePath) {
            const path = await save({
                filters: [
                    {
                        name: "All Files",
                        extensions: ["*"],
                    },
                ],
            });
            if (!path) return;
            await invoke("write_file", { path: path, content: content });
            setFilePath(path); // now the newFile is saved, path is no longer null so the next save will be normal save
        } else {
            await invoke("write_file", { path: filePath, content: content }); // if there is already filePath state, we should save normally
        }
        setIsUnsaved(false);
    };

    function startHorizontalDrag(e: React.MouseEvent<HTMLDivElement>) {
        e.preventDefault() // dont fucking select text when I drag with my mouse
        setIsDragging(true);
        horizontalDrag.current = { mouseBeganAt: e.clientX, startWidth: width }
        window.addEventListener("mousemove", onHorizontalMouseMove)
        window.addEventListener("mouseup", onMouseUp)
    };
    function onHorizontalMouseMove(e: MouseEvent) {
        const diff = e.clientX - horizontalDrag.current.mouseBeganAt // clientX is the secret word for current position
        const next = horizontalDrag.current.startWidth + diff
        setWidth(Math.min(1530, Math.max(140, next))) // max 160, next will keep the width at least 160; min 560 is setting the max to 560
    }

    function startVerticalDrag(e: React.MouseEvent<HTMLDivElement>) {
        e.preventDefault() // dont fucking select text when I drag with my mouse
        setIsDragging(true);
        verticalDrag.current = { mouseBeganAt: e.clientY, startHeight: terminalHeight }
        window.addEventListener("mousemove", onVerticalMouseMove)
        window.addEventListener("mouseup", onMouseUp)
    };
    function onVerticalMouseMove(e: MouseEvent) {
        const diff = e.clientY - verticalDrag.current.mouseBeganAt // clientX is the secret word for current position
        const next = verticalDrag.current.startHeight - diff
        setTerminalHeight(Math.min(830, Math.max(90, next))) // max 160, next will keep the width at least 160; min 560 is setting the max to 560
    }
    function onMouseUp() {
        setIsDragging(false);
        window.removeEventListener("mousemove", onHorizontalMouseMove)
        window.removeEventListener("mousemove", onVerticalMouseMove)
        window.removeEventListener("mouseup", onMouseUp)
    };
    return (

        // i checked the syntax and options of Editor and added it into my code by myself, it works
        <div style={{ position: "relative", height: "100vh", width: show ? width : 0, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", flexShrink: 0 }}>
            <div className="flex gap-2 px-4 py-2 justify-left">
                <button
                    onClick={() => newFile()}
                    title="newFile"
                    className={"workbench_button"}
                >
                    <FilePlusCorner />
                </button>
                <button
                    onClick={() => openFile()}
                    title="openFile"
                    className={"workbench_button"}
                >
                    <FolderOpen />
                </button>
                <button
                    onClick={() => saveFile()}
                    title="saveFile"
                    className={"workbench_button"}
                >
                    {isUnsaved ? <SavePen /> : <SaveCheck />}
                </button>
            </div>
            <div
                style={{ background: "black", flex: 1, minHeight: 0 }}>
                <Editor
                    height="100%"
                    defaultLanguage="python"
                    defaultValue=""
                    onChange={(value) => {
                        setIsUnsaved(true);
                    }}
                    onMount={(editor) => {
                        editorRef.current = editor;
                    }}
                    options={{
                        theme: "vs-dark",
                        fontSize: 12,
                        minimap: { enabled: false },
                        wordWrap: "on",
                        automaticLayout: true,
                        tabSize: 4,
                        scrollBeyondLastLine: false,
                        padding: { top: 12, bottom: 12 },
                        lineNumbers: "on",
                        cursorBlinking: "smooth",
                        smoothScrolling: true,
                    }}
                />
            </div>
            <div
                style={{ height: 3, cursor: "ns-resize", background: "rgb(35,35,35)", flexShrink: 0 }}
                onMouseDown={startVerticalDrag}
            >
            </div>

            <div
                style={{ background: "black", height: terminalHeight, flexShrink: 0, overflow: "hidden" }}>
                <EmbeddedTerminal show={show} />
            </div>
            <div
                style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 3, cursor: "ew-resize", background: "rgb(35,35,35)" }}
                onMouseDown={startHorizontalDrag}
            >
            </div>
            {isDragging && (
                <div
                    style={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 9999,
                        cursor: "none", // keeps the resize cursor visible everywhere!
                    }}
                />
            )}
        </div>

    );
}