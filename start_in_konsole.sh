#!/bin/bash

# Remember to update the path :D
konsole --noclose -e bash -c "
cd ~/Desktop/programming_projects/felix-plan-b-phoebe/frontend && WEBKIT_DISABLE_DMABUF_RENDERER=1 bun run tauri dev &
cd ~/Desktop/programming_projects/felix-plan-b-phoebe/backend/app && uv run main.py
"