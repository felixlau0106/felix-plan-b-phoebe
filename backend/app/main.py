from multiprocessing import context
import subprocess
from pathlib import Path
from openai import OpenAI
import time
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from contextlib import asynccontextmanager
import asyncio
import json
from pydantic import BaseModel
import traceback
from datetime import datetime
from companions import COMPANIONS, SUB_CHAT_SYSTEM_PROMPT
import signal
import re
import os
import sys
from dotenv import load_dotenv

from tools import tools, non_grok_tools, TOOL_MAP

# ====================== Environment Setup ======================

load_dotenv()
XAI_KEY = os.getenv("XAI_KEY")

client = OpenAI(
    base_url="http://127.0.0.1:11434/v1",
    api_key="not-needed"
)

xai_client = OpenAI(
    api_key=XAI_KEY,
    base_url="https://api.x.ai/v1",
)

ROOT = Path(__file__).parent.parent.parent
BE_DIR = Path(__file__).parent
SERVER_DIR = ROOT / "llama"
if sys.platform == "win32":
    SERVER_EXE = SERVER_DIR / "llama-server.exe"
else:
    SERVER_EXE = SERVER_DIR / "llama-server"
LLAMA_PORT = 11434



DEFAULT_SETTINGS = {
    "companion": "Phoebe", 
    "model": "grok-4.7", 
    "reasoning_level": "low",
    "compaction_threshold": 8
}

llama_model_state = {
    "model": None,
    "reasoning_level": None
}

engine_killed = False

settings = DEFAULT_SETTINGS.copy()

model_paths = {
    "Qwen3.8-27B-UD-Q4_K_M": ROOT / "Qwen3.8-27B-UD-Q4_K_M.gguf",
    "grok-4.7": None,
    "grok-4.3": None,
}

messages_history = {name: [] for name in COMPANIONS}

turn = {companion: 0 for companion in COMPANIONS} # for compaction use
real_turn = {companion: 0 for companion in COMPANIONS} # for comparing with subchat context turn
subchat_context_turn = {companion: 0 for companion in COMPANIONS}
subchat_messages_history = [
    {"role": "system", "content": "Okay, I am ready."},
    {"role": "system", "content": SUB_CHAT_SYSTEM_PROMPT},
    {"role": "assistant", "content": "I am ready to make your roleplay experience enjoyable!"}
    ]

# ====================== Text Sanitization ====================== 

def sanitize_text(text: str) -> str:
    if isinstance(text, (dict, list)):
        text = json.dumps(text, ensure_ascii=False)
    else:
        text = str(text)
    return text.encode("utf-8", errors="replace").decode("utf-8")

# ====================== Message Helpers ======================

def system_message(flag: str, msg:str):
    print("\033[93m[" + flag + "]\033[0m " + msg)

# ====================== Settings Helpers ======================

def save_settings() -> None:
    try:
        BE_DIR.mkdir(parents=True, exist_ok=True)
        payload = {
            "saved_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            **settings,
        }
        settings_path = BE_DIR / "settings.json"
        tmp_path = settings_path.with_suffix(".tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        tmp_path.replace(settings_path)
        system_message("Settings", f"Saved settings → {settings_path.name}")
    except Exception as e:
        system_message("Settings", f"Save failed: {e}")

def load_or_create_settings() -> None:
    global settings
    settings_path = BE_DIR / "settings.json"
    if not settings_path.exists():
        system_message("Settings", "No settings file — using defaults.")
        settings = DEFAULT_SETTINGS.copy()
        try:
            BE_DIR.mkdir(parents=True, exist_ok=True)
            payload = {
                "created_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
                **DEFAULT_SETTINGS,
            }
            tmp_path = settings_path.with_suffix(".tmp")
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            tmp_path.replace(settings_path)
            system_message("Settings", f"Created default settings → {settings_path.name}")
        except Exception as e:
            system_message("Settings", f"Save failed: {e}")
            return
    try:
        with open(settings_path, "r", encoding="utf-8") as f:
            loaded_settings = json.load(f)
        if not isinstance(loaded_settings, dict):
            raise ValueError("settings.json is not a dict")
        # Merge loaded settings with defaults (loaded overrides defaults)
        settings = {**DEFAULT_SETTINGS, **loaded_settings}
        system_message("Settings", f"Loaded settings from {settings_path}.")
    except Exception as e:
        settings = DEFAULT_SETTINGS.copy()
        system_message("Settings", f"Load failed ({e}) — using defaults.")

# ====================== Server Helpers ======================
debug = False
kwargs = {}
if sys.platform == "win32":
    kwargs["creationflags"] = subprocess.CREATE_NEW_CONSOLE
elif sys.platform == "linux":
    kwargs["stdout"] = subprocess.DEVNULL
    kwargs["stderr"] = subprocess.DEVNULL
    
def start_llama_server():
    model_path = model_paths[settings["model"]]
    # Full path to the exe: Windows does NOT reliably search cwd for the executable.
    if not SERVER_EXE.is_file():
        raise FileNotFoundError(f"Missing server exe: {SERVER_EXE}")
    if not model_path.is_file():
        raise FileNotFoundError(f"Missing model file: {model_path}")

    if "Qwen" in settings["model"]:
        subprocess.Popen(
            [
                str(SERVER_EXE),
                "-m", str(model_path),
                "--jinja",
                "-fa", "on",
                "-ngl", "999",                 # Offload every layer to GPU
                "-c", "65536",                 # Context window ~32768 is safe, tested 131072...wont start
                "--n-predict", "-1",
                "-np", "1",                    # Single slot → more VRAM for context
                "-ctk", "q8_0",                # 8-bit Key cache
                "-ctv", "q8_0",                # 8-bit Value cache
                "-b", "2048",
                "-ub", "1024",
                "--reasoning-effort", settings["reasoning_level"],
                "--load-mode", "mmap+mlock",         # or "mmap" / "mmap+mlock" depending on preference
                "--port", str(LLAMA_PORT),
                # Optional but highly recommended if your GGUF supports it:
                "--spec-type", "draft-mtp",
                "--spec-draft-n-max", "3",    # or 3 – test both
            ],
            cwd=str(SERVER_DIR),
            **kwargs if not debug else {},
        )
    else:
        subprocess.Popen(
            [
                str(SERVER_EXE),
                "-m", str(model_path),
                "--jinja",
                "-fa", "on",
                "-ngl", "999",                 # Offload every layer to GPU
                "-c", "32768",                 # Context window ~32768 is safe, tested 131072...wont start
                "--n-predict", "-1",
                "-np", "1",                    # Single slot → more VRAM for context
                "-ctk", "q8_0",                # 8-bit Key cache
                "-ctv", "q8_0",                # 8-bit Value cache
                "-b", "2048",
                "-ub", "1024",
                "--load-mode", "mmap+mlock",         # or "mmap" / "mmap+mlock" depending on preference
                "--port", str(LLAMA_PORT),
                "--spec-draft-n-max", "3", 
            ],
            cwd=str(SERVER_DIR),
            **kwargs if not debug else {},
        )


def process_id_on_port(port: int) -> int | None:
    if sys.platform == "win32":
        netstat_result = subprocess.run(
            ["netstat", "-ano", "-p", "tcp"],
            capture_output=True,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        needle = f":{port}"
        for line in netstat_result.stdout.splitlines():
            parts = line.split() # example for future me: TCP    127.0.0.1:11434    0.0.0.0:0    LISTENING    5820
            if len(parts) < 5:
                continue
            if parts[0].upper() != "TCP":
                continue
            if parts[3].upper() != "LISTENING":
                continue
            local = parts[1]
            if local.endswith(needle) or local.endswith(f"]:{port}"): #  Right bracket because IPv6 would be something like ([::1]:11434)
                try:
                    return int(parts[4])
                except ValueError:
                    continue
        return None
    elif sys.platform == "linux":
        try:
            netstat_result = subprocess.run(
                ["ss", "-ltnp", f"sport = :{port}"], # ss is the tool in Linux. l(listening), t(tcp), n(numeric), p(process) sport(source port) is the filter
                capture_output=True,
                text=True,
            )
            for line in netstat_result.stdout.splitlines():
                if f"127.0.0.1:{port}" in line or f"[::1]:{port}" in line: #  Right bracket because IPv6 would be something like ([::1]:11434)
                    match = re.search(r"pid=(\d+)", line)
                    if match:
                        return int(match.group(1))
            return None
        except Exception:
            return None

def kill_llama_server(port: int = LLAMA_PORT, timeout: float = 15.0) -> None:
    if sys.platform == "win32":
        process_id = process_id_on_port(port)
        if process_id is None:
            return
        subprocess.run(
            ["taskkill", "/PID", str(process_id), "/T", "/F"],
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        deadline = time.time() + timeout
        while time.time() < deadline:
            if process_id_on_port(port) is None:
                return
            time.sleep(0.3)
        raise RuntimeError(f"llama-server still listening on {port}")
    elif sys.platform == "linux":
        process_id = process_id_on_port(port)
        if process_id is None:
            return
        try:
            os.kill(process_id, signal.SIGTERM) # (Terminating Signal, SIGTERM) This is the polite way to ask the process to terminate
        except (ProcessLookupError):
            return
        deadline = time.time() + timeout
        while time.time() < deadline:
            if process_id_on_port(port) is None:
                return
            time.sleep(0.3)
        try:
            os.kill(process_id, signal.SIGKILL) # (Kill Signal, SIGKILL) If the process didn't terminate politely, force kill it
        except (ProcessLookupError):
            pass

def is_llama_server_up():
    response = subprocess.run(
            ["curl", "-sf", "http://127.0.0.1:11434/health"],
            capture_output=True,
        )
        # Because we use -f, curl will return a non-zero exit code for HTTP failures (e.g. 404, 500, etc.).
    if response.returncode == 0:
        return True
    else:
        return False

def boot_llama_server():
    llama_is_running = is_llama_server_up()
    if llama_is_running:
        kill_llama_server(LLAMA_PORT)
        time.sleep(5)
        llama_is_running = False
    start_llama_server()
    while not llama_is_running:
        llama_is_running = is_llama_server_up()
        time.sleep(1)
    system_message("Engine", "Engine is ready.")

# ====================== Chat Helpers ======================

def clear_messages():
    companion = settings["companion"]
    messages_history[companion] = []
    system_message("History", f"History for {companion} is cleared.")

def clear_subchat_messages():
    global subchat_messages_history
    subchat_messages_history = [
        {"role": "system", "content": "Okay, I am ready."},
        {"role": "system", "content": SUB_CHAT_SYSTEM_PROMPT},
        {"role": "assistant", "content": "I am ready to make your roleplay experience enjoyable!"}
    ]
    system_message("History", "SubChat history is cleared.")

def compaction(companion: str):
    system_message("Compaction", f"Compacting conversation for {companion}...")
    # show AI the full conversation history for the given companion and ask it to summarize or compact it
    if companion not in messages_history:
        return
    compacted_history = messages_history[companion].copy()
    compacted_history = [msg for msg in compacted_history if msg["role"] in ["assistant", "user"]][:8]
    compacted_history.append({"role": "user", "content": "OOC: Please compact the conversation. Summarize the key points and events happened in this session. Make sure to retain the important details. Especially focus on the important events and decisions made. Make sure future you will still have all the necessary context. Your response will be directly used so skip any unnecessary preamble."})
    response = xai_client.chat.completions.create(
        model="grok-4.3",
        messages=compacted_history,
        extra_body={
            "prompt_cache_key": "felix-plan-b",
            "reasoning": {"effort": "low"},
        }
    )
    if not response.choices or not response.choices[0].message.content:
        system_message("Error", "Failed to compact conversation: No response from AI.")
        return
    content = "Compacted context: " + response.choices[0].message.content + "\n(Keeping last 5 messages in history for more detailed context)"
    system_message("Compaction", content)
    keep = messages_history[companion][-5:]  # Keep the last 5 messages for context
    if "grok" in settings["model"]:
        messages_history[companion].append({"role": "system", "content": "Compacted context: " + content})
    else:
        messages_history[companion].append({"role": "user", "content": "[System: Compacted context: " + content + "]"})
    messages_history[companion].extend(keep)
    
def get_main_chat_context():
    system_message("SubChat", "Retrieving main chat context...")
    if not messages_history[settings["companion"]]:
        system_message("Summary", "No message history found for the current companion.")
        return "The main chat is currently empty. Warmly start your conversation. And retry later when user imply the roleplay has begun."
    history = messages_history[settings["companion"]].copy()
    history.append({"role": "user", "content": "OOC: Please summarize the conversation/roleplay. Highlight the characters setting, relationships, key points and events happened in this session. Make sure to retain the important details. Especially focus on the important events and decisions made. Make sure future you will still have all the necessary context. Your response will be directly used so skip any unnecessary preamble. Explain the latest(the most recent) events clearly."})
    response = xai_client.chat.completions.create(
        model="grok-4.3",
        messages=history,
        extra_body={
            "prompt_cache_key": "felix-plan-b",
            "reasoning": {"effort": "low"},
        }
    )
    if not response.choices or not response.choices[0].message.content:
        system_message("Error", "Failed to get main chat context: No response from AI.")
        return "Failed to summarize the main chat context."
    system_message("SubChat", "Successfully retrieved main chat context.")
    system_message("SubChat", "Main chat context: " + response.choices[0].message.content)
    return response.choices[0].message.content

# ====================== Lifespan ======================

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("=" * 60)
    print("Felix's Local LLM Backend starting...")
    system_message("Settings", "Loading settings...")
    load_or_create_settings()
    if "grok" not in settings["model"]:
        system_message("Engine", "Starting llama-server...")
        try:
            global llama_model_state
            llama_is_running = is_llama_server_up()
            if not llama_is_running:
                start_llama_server()
                llama_model_state = {
                    "model": settings["model"],
                    "reasoning_level": settings["reasoning_level"]
                }
            else:
                system_message("Engine", "Engine was already running.")
                llama_model_state = {
                    "model": settings["model"],
                    "reasoning_level": settings["reasoning_level"]
                }
            while not llama_is_running:
                llama_is_running = is_llama_server_up()
                time.sleep(1)
        except Exception as e:
            system_message("Engine", "Couldn't start llama-server. Only support xAI API.")
    else:
        system_message("Engine", "Using xAI API.")
    print("=" * 60)
    yield

# ====================== FASTAPI APP ======================
app = FastAPI(
    title="Felix Local Groky Backend",
    lifespan=lifespan,      # modern replacement for @app.on_event
    docs_url=None,       
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",
        "http://127.0.0.1:1420",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ====================== REQUEST / RESPONSE MODELS ======================
class UserInput(BaseModel):
    input: str

class SettingsUpdate(BaseModel):
    companion: str | None = None
    model: str | None = None
    reasoning_level: str | None = None

# ====================== CORE ENDPOINT: /response ======================
@app.post("/response")
async def response_endpoint(user_input: UserInput):
    # companion_history is clean chat history, temp_history contains system prompt and tool calls results and is used for generating responses
    temp_history = [] # history with system prompt
    companion = settings["companion"]
    companion_history = messages_history[settings["companion"]]
    if COMPANIONS[companion].priming_message:
        priming_message = COMPANIONS[companion].priming_message
        temp_history.append({"role": "system", "content": priming_message})
    system_prompt = COMPANIONS[companion].system_prompt
    temp_history.append({"role": "system", "content": system_prompt})
    if COMPANIONS[companion].hidden_greeting:
        hidden_greeting = COMPANIONS[companion].hidden_greeting
        temp_history.append({"role": "assistant", "content": hidden_greeting})

    t = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    system_message("Response", f"[{t}] /response called with user input: {user_input.input[:20]}...")

    def damnit_grok_why_you_only_love_responses(tools: list):
        # sigh..."responses" dont expect the "function" layer so im converting the content
        result = []
        for tool in tools:
            result.append({
                "type": "function",
                "name": tool["function"]["name"],
                "description": tool["function"]["description"],
                "parameters": tool["function"]["parameters"],
            })
        return result
    
    async def event_stream():
        try:
            user_text = f"[System: Current datetime in HK: {t}]\n" + user_input.input
            companion_history.append({"role": "user", "content": user_text})
            temp_history.extend(companion_history)
            full_content = ""
            rt = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            while True:
                tool_calls_buffer = {}
                if "grok" not in settings["model"]:
                    if engine_killed:
                        yield f"data: {json.dumps({'content': '[System] Engine is down. Run --reboot to restart.'})}\n\n"
                        return
                    stream = client.chat.completions.create(
                        model="local-model",
                        messages=temp_history,
                        tool_choice="auto",
                        tools=tools + non_grok_tools,
                        stream=True,
                        max_tokens=32768,
                        temperature=1.0 if settings["model"].startswith("Qwen") else 0.7,
                        top_p=0.95 if settings["model"].startswith("Qwen") else 0.80,
                        presence_penalty=0.0 if settings["model"].startswith("Qwen") else 1.5,
                        extra_body={
                            "top_k": 20,
                            "min_p": 0.0,
                            "repetition_penalty": 1.0 if settings["model"].startswith("Qwen") else None,
                        },
                    )
                    for chunk in stream:  # not async for — OpenAI's python stream is a normal for
                        if not chunk.choices or not chunk.choices[0].delta:
                            continue
                        delta = chunk.choices[0].delta
                        reasoning_token = getattr(delta, "reasoning_content", None)
                        content_token = delta.content
                        if reasoning_token:
                            yield f"data: {json.dumps({'reasoning': reasoning_token})}\n\n"
                        if content_token:
                            full_content += content_token
                            yield f"data: {json.dumps({'content': content_token})}\n\n"
                        tool_calls_token = getattr(delta, "tool_calls", None)
                        if tool_calls_token:
                            for tool_call in tool_calls_token:
                                idx = tool_call.index
                                if idx not in tool_calls_buffer:
                                    tool_calls_buffer[idx] = {
                                        "id": tool_call.id,
                                        "name": tool_call.function.name,
                                        "arguments": ""
                                    }
                                if tool_call.function.arguments:
                                    tool_calls_buffer[idx]["arguments"] += tool_call.function.arguments
                        await asyncio.sleep(0)
                else:
                    # the built-in tools like web_search are only supported on the Responses API
                    stream = xai_client.responses.create(
                        model=settings["model"],
                        input=temp_history,
                        tool_choice="auto",
                        tools=damnit_grok_why_you_only_love_responses(tools) + [
                            {
                                "type": "web_search",
                                "enable_image_understanding": True,
                                "enable_image_search": True,
                            }
                        ],
                        stream=True,
                        extra_body={
                            "prompt_cache_key": "felix-plan-b",
                            "reasoning": {"effort": "low"},
                        }
                    )
                    for event in stream:
                        event_type = getattr(event, "type", "")
                        delta = getattr(event, "delta", "")
                        
                        if event_type in (
                            "response.reasoning_text.delta",
                            "response.reasoning_summary_text.delta",
                        ):
                            if delta:
                                yield f"data: {json.dumps({'reasoning': delta})}\n\n"
                        elif event_type == "response.output_text.delta":
                            if delta:
                                full_content += delta
                                yield f"data: {json.dumps({'content': delta})}\n\n"
                        elif event_type == "response.output_item.added":
                            item = getattr(event, "item", {})
                            if getattr(item, "type", "") == "function_call":
                                item_id = getattr(item, "id", "")
                                tool_name = getattr(item, "name", "")
                                arguments = getattr(item, "arguments", "{}")
                                call_id = getattr(item, "call_id", item_id)
                                tool_calls_buffer[item_id] = {
                                    "id": call_id,
                                    "name": tool_name,
                                    "arguments": arguments,
                                }
                        elif event_type == "response.function_call_arguments.delta":
                            item_id = getattr(event, "item_id", None)
                            if item_id and item_id in tool_calls_buffer:
                                tool_calls_buffer[item_id]["arguments"] += delta

                if tool_calls_buffer:
                    if "grok" not in settings["model"]:
                        temp_history.append({
                            "role": "assistant",
                            "tool_calls": [
                                {
                                    "id": tool_call["id"],
                                    "type": "function",
                                    "function": {
                                        "name": tool_call["name"],
                                        "arguments": tool_call["arguments"]
                                    }
                                }
                                for tool_call in tool_calls_buffer.values()
                            ]
                        })
                        for tool_call in tool_calls_buffer.values():
                            function_name = tool_call["name"]
                            function_args_string = tool_call["arguments"]
                            tool_call_id = tool_call["id"]
                            function_args = {}
                            if function_args_string:
                                function_args = json.loads(function_args_string)
                            if function_name in TOOL_MAP:
                                call = TOOL_MAP[function_name]
                                result = call(**function_args)

                                system_message("Tools", f"[{rt}] AI called tool [{function_name}] with arg [{function_args_string}]...")
                                
                                temp_history.append({
                                    "role": "tool",
                                    "tool_call_id": tool_call_id,
                                    "content": sanitize_text(result)
                                })
                                companion_history.append({
                                    "role": "tool",
                                    "tool_call_id": tool_call_id,
                                    "content": f"Tool call [{function_name}] with arg [{function_args_string}] ran successfully. Not saving result to history for token efficiency. Your response already includes the necessary information."
                                })
                    else:
                        tool_outputs = []
                        for tool_call in tool_calls_buffer.values():
                            function_name = tool_call["name"]
                            function_args_string = tool_call["arguments"]
                            tool_call_id = tool_call["id"]
                            function_args = {}
                            if function_args_string:
                                function_args = json.loads(function_args_string) if function_args_string else {}
                            if function_name in TOOL_MAP:
                                call = TOOL_MAP[function_name]
                                result = call(**function_args)

                                system_message("Tools", f"[{rt}] Grok called tool [{function_name}] with arg [{function_args_string}]...")

                                tool_outputs.append({
                                    "type": "function_call_output",
                                    "call_id": tool_call_id,
                                    "output": sanitize_text(result)
                                })
                        temp_history.extend(tool_outputs)
                else:
                    break

            if full_content:
                companion_history.append({"role": "assistant", "content": full_content})
                model_flag = ""
                if "grok" in settings["model"].lower():
                    model_flag = "Grok"
                elif "qwen" in settings["model"].lower():
                    model_flag = "Qwen"
                system_message("Response", f"[{rt}] AI ({model_flag}) responsed with: {full_content[:20]}...")
                turn[settings["companion"]] += 1
                system_message("Response", f"[{rt}] Turn count for {settings['companion']}: {turn[settings['companion']]} / {settings['compaction_threshold']}")
                if turn[settings["companion"]] >= settings["compaction_threshold"]:
                    system_message("Response", f"[{rt}] Turn limit ({settings['compaction_threshold']} turns) reached for {settings['companion']}.")
                    compaction(settings["companion"])
                    turn[settings["companion"]] = 0

        except Exception as e:
            system_message("Response", f"[ERROR in /response] {e}")
            
            traceback.print_exc()
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@app.post("/subchat/response")
async def subchat_response(user_input: UserInput):

    t = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    system_message("Response", f"[{t}] /subchat/response called with user input: {user_input.input[:20]}...")

    def damnit_grok_why_you_only_love_responses(tools: list):
        result = []
        for tool in tools:
            result.append({
                "type": "function",
                "name": tool["function"]["name"],
                "description": tool["function"]["description"],
                "parameters": tool["function"]["parameters"],
            })
        return result
    
    async def event_stream():
        try:
            SUB_TOOL_MAP = TOOL_MAP.copy()
            SUB_TOOL_MAP["get_main_chat_context"] = get_main_chat_context
            sub_tools = tools.copy()
            sub_tools = sub_tools + [
                {
                    "type": "function",
                    "function": {
                        "name": "get_main_chat_context",
                        "description": "Retrieve the main chat context. Use this to understand the ongoing conversation or roleplay.",
                        "parameters": {
                            "type": "object",
                            "properties": {}
                        }
                    }
                }
            ]
            user_text = f"[System: Current datetime in HK: {t}]\n" + user_input.input
            subchat_messages_history.append({"role": "user", "content": user_text})
            full_content = ""
            rt = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            while True:
                tool_calls_buffer = {}
                stream = xai_client.responses.create(
                    model="grok-4.3",
                    input=subchat_messages_history,
                    tool_choice="auto",
                    tools=damnit_grok_why_you_only_love_responses(sub_tools) + [
                        {
                            "type": "web_search",
                            "enable_image_understanding": True,
                            "enable_image_search": True,
                        }
                    ],
                    stream=True,
                    extra_body={
                        "prompt_cache_key": "felix-plan-b",
                        "reasoning": {"effort": "low"},
                    }
                )
                for event in stream:
                    event_type = getattr(event, "type", "")
                    delta = getattr(event, "delta", "")
                    
                    if event_type in (
                        "response.reasoning_text.delta",
                        "response.reasoning_summary_text.delta",
                    ):
                        if delta:
                            yield f"data: {json.dumps({'reasoning': delta})}\n\n"
                    elif event_type == "response.output_text.delta":
                        if delta:
                            full_content += delta
                            yield f"data: {json.dumps({'content': delta})}\n\n"
                    elif event_type == "response.output_item.added":
                        item = getattr(event, "item", {})
                        if getattr(item, "type", "") == "function_call":
                            item_id = getattr(item, "id", "")
                            tool_name = getattr(item, "name", "")
                            arguments = getattr(item, "arguments", "{}")
                            call_id = getattr(item, "call_id", item_id)
                            tool_calls_buffer[item_id] = {
                                "id": call_id,
                                "name": tool_name,
                                "arguments": arguments,
                            }
                    elif event_type == "response.function_call_arguments.delta":
                        item_id = getattr(event, "item_id", None)
                        if item_id and item_id in tool_calls_buffer:
                            tool_calls_buffer[item_id]["arguments"] += delta

                if tool_calls_buffer:   
                    tool_outputs = []
                    for tool_call in tool_calls_buffer.values():
                        function_name = tool_call["name"]
                        function_args_string = tool_call["arguments"]
                        tool_call_id = tool_call["id"]
                        function_args = {}
                        if function_args_string:
                            function_args = json.loads(function_args_string) if function_args_string else {}
                        if function_name in SUB_TOOL_MAP:
                            call = SUB_TOOL_MAP[function_name]
                            result = call(**function_args)

                            system_message("Tools", f"[{rt}] Grok (SubChat) called tool [{function_name}] with arg [{function_args_string}]...")

                            tool_outputs.append({
                                "type": "function_call_output",
                                "call_id": tool_call_id,
                                "output": sanitize_text(result)
                            })
                    subchat_messages_history.extend(tool_outputs)
                else:
                    break

                if full_content:
                    subchat_messages_history.append({"role": "assistant", "content": full_content})
                    system_message("Response", f"[{rt}] AI (SubChat) responsed with: {full_content[:20]}...")

        except Exception as e:
            system_message("Response", f"[ERROR in /response] {e}")
            
            traceback.print_exc()
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@app.post("/compaction")
async def compaction_endpoint():
    compacted = compaction(settings["companion"])
    if compacted:
        return {"compacted": True}
    return {"error": "Failed to compact conversation."}

@app.post("/clear")
async def clear_endpoint():
    clear_messages()
    return {"cleared": True}

@app.post("/subchat/clear")
async def subchat_clear_endpoint():
    clear_subchat_messages()
    return {"subchat_cleared": True}

@app.post("/restartengine")
async def restart_engine():
    boot_llama_server()
    return {"engine_restarted": True}

@app.post("/killengine")
async def kill_engine():
    global engine_killed
    kill_llama_server()
    engine_killed = True
    return {"engine_killed": True}

@app.get("/settings")
async def get_settings():
    return settings

@app.patch("/settings")
async def update_settings(update: SettingsUpdate): # Hint that update is a SettingsUpdate instance
    global llama_model_state
    updates = update.model_dump(exclude_unset=True) # Get only the fields that were actually provided
    for key, value in update.model_dump(exclude_unset=True).items():
        settings[key] = value
        system_message("Settings", f"Updated setting: {key} -> {value}")
        if (key == "model"):
            if "grok" not in settings["model"].lower():
                if llama_model_state["model"] == None or llama_model_state["model"] != settings["model"]:
                    system_message("Engine", f"Model is not Grok, restarting engine because the model has changed... [from {llama_model_state['model']} to {settings['model']}]")
                    boot_llama_server()
                    llama_model_state["model"] = settings["model"]
                # Reasoning level could have changed in Grok mode and now the model is not Grok, check and update accordingly.
                if llama_model_state["reasoning_level"] == None or llama_model_state["reasoning_level"] != settings["reasoning_level"]:
                    system_message("Engine", f"Model is not Grok, restarting engine because the reasoning level has changed... [from {llama_model_state['reasoning_level']} to {settings['reasoning_level']}]")
                    boot_llama_server()
                    llama_model_state["reasoning_level"] = settings["reasoning_level"]
        if (key == "reasoning_level"):
            if "grok" not in settings["model"].lower():
                if llama_model_state["reasoning_level"] == None or llama_model_state["reasoning_level"] != settings["reasoning_level"]:
                    system_message("Engine", f"Model is not Grok, restarting engine because the reasoning level has changed... [from {llama_model_state['reasoning_level']} to {settings['reasoning_level']}]")
                    boot_llama_server()
                    llama_model_state["reasoning_level"] = settings["reasoning_level"]
    save_settings()
    return {"message": "Settings updated successfully", "updated_settings": updates}

@app.get("/")
async def welcome():
    return {
        "message": "Felix's Local LLM backend is running!",
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=6969, reload=True)
