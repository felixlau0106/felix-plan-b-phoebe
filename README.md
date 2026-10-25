# Felix's Plan B Phoebe

An AI chatbot app that lets you run local LLMs in a clean, dark UI. Most actions are done using commands (see the Commands section).

The app also supports xAI's Grok API.

## Requirements

- Python 3.12+, [uv](https://docs.astral.sh/uv/), [Bun](https://bun.sh/), and a Rust toolchain for Tauri.
- Linux or Windows. Running local models requires an NVIDIA GPU and a CUDA-enabled `llama-server`.
- An xAI API key for Grok models and web search. Put it in `felix-plan-b-phoebe/.env`:
  ```dotenv
  XAI_KEY=your_api_key
  ```
- For the local Qwen model, put `Qwen3.8-27B-UD-Q4_K_M.gguf` in the repository root.

From the repository root, install the backend and frontend dependencies:
```bash
uv sync
cd frontend
bun install
```

## Linux

### Build llama.cpp with CUDA
From the repository root, build llama.cpp inside `llama/`:
```Bash
cd llama
git clone https://github.com/ggml-org/llama.cpp.git
cd llama.cpp
cmake -S . -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -j$(nproc)
```

Copy the contents of `llama.cpp/build/bin/` into the repository's `llama/` directory so the backend can find `llama-server` and its shared libraries.

### Start Frontend
```bash
cd frontend
WEBKIT_DISABLE_DMABUF_RENDERER=1 bun run tauri dev
```

### Start Backend
```bash
cd backend/app
../../.venv/bin/python main.py
```

## Windows
Download these **two** pre-compiled zip files from the latest llama.cpp GitHub releases and extract them both into the repository's `llama/` folder:
1. `llama-*-bin-win-cuda-*.zip` (The main server binaries)
2. `cudart-llama-bin-win-cuda-*.zip` (The required NVIDIA runtime DLLs)

### Start Frontend
From the repository root:
```bash
cd frontend
bun run tauri dev
```

### Start Backend
From the repository root, run:
```powershell
cd backend/app
..\..\.venv\Scripts\python.exe main.py
```

## Commands
Enter commands in the chat input. Where both forms are listed, they do the same thing.
```bash
# Change companion
-c phoebe / -c grok / -c grok_4.3
--companion phoebe / --companion grok / --companion grok_4.3

# Change AI model
-m qwen / -m grok-4.7 / -m grok-4.3
--model qwen / --model grok-4.7 / --model grok-4.3

# Change reasoning level
-r [low/medium/xhigh]
--reasoning_level [low/medium/xhigh]

# Clear chat history (-c can also select a companion when followed by its name)
-c
--clear

# Save chat history to a JSON file
-s
--save

# Toggle workbench (code editor and terminal)
-w
--workbench

# Toggle SubChat (a side chat panel, mainly for assisting with the main chat's RP)
-sc | -ss
--subchat | --subshell

# Compact chat history (automatic compaction is also enabled)
-cp | -cm
--compaction | --compact

# Restart llama-server
--reboot

# Kill llama-server
-k
--killengine

# Default Mode (Phoebe) + Qwen + low reasoning level
-p
--phoebe

# Default Mode (Grok 4.7) + low reasoning level
-g
--grok

# Default Mode (Grok 4.3) + low reasoning level
-g43
--grok43

# Exit
-e
-q
-exit
-quit
```

## Models
Supported models:
- `Qwen3.8-27B-UD-Q4_K_M` (local; requires the GGUF file and `llama-server`)
- `grok-4.7` and `grok-4.3` (xAI API; require `XAI_KEY`)

The fallback model is `grok-4.7` when no saved settings exist. To change or add models, update `backend/app/main.py` and the model command map in `frontend/src/hooks/useChat.ts`.

## Companions
You can add more companions by editing `backend/app/companions.py` and the companion command map in `frontend/src/hooks/useChat.ts`. The app comes with three:
- Phoebe: A female companion that has a sweet and warm personality
- Grok: xAI's Grok in a warm loving tone.
- Grok 4.3: A system prompt I personally found working better with Grok 4.3 model.

## Tools
- `get_current_project_root`: For letting the AI know where this project is located in your PC
- `read_file`: Let AI read a text file
- `list_dir`: Let AI see what files and folders are in a specific location
- `get_file_tree`: Draw a visual tree of the files/folders structure of a specific location
- `web_search`: Uses xAI's web search API; local Qwen receives a search report from Grok.