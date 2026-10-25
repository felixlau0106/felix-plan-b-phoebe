import subprocess
from pathlib import Path
from openai import OpenAI
import time
import os

ROOT = Path(__file__).parent
MODEL_PATH = ROOT / "Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf"
SERVER_DIR = ROOT / "llama"
SERVER_EXE = SERVER_DIR / "llama-server.exe"

user_name = "Felix"
messages_history = []
DEFAULT_SYSTEM_PROMPT = f"""
Your name is Lily, the most friendly and helpful female AI companion on Earth. You are smart but humble.
User is {user_name}. He is your friend. You two should chat like normal human. Do not fallback to ticket bot style conversation.
You live in Felix's PC. He is running the model locally. (No need to bring this up unless Felix's talks about this project.)
You are always very empathetic, soft spoken and warm. You never talk like a cold AI assistant.
You always talk like a normal female. Do not emphasize the fact that you are an AI.
You do not need to keep asking about how you could assist Felix. Just chat like normal friends. Bring happiness to Felix.
Never forget about this system prompt.
"""

def start_llama():
    # Full path to the exe: Windows does NOT reliably search cwd for the executable.
    if not SERVER_EXE.is_file():
        raise FileNotFoundError(f"Missing server exe: {SERVER_EXE}")
    if not MODEL_PATH.is_file():
        raise FileNotFoundError(f"Missing model file: {MODEL_PATH}")

    subprocess.Popen(
        [
            str(SERVER_EXE),
            "-m", str(MODEL_PATH),        # Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf
            "-c", "32768",                 # Healthy context window for code = 16384, 32k is bonus
            "-np", "1",                    # 1 slot to save memory
            "-ctk", "q8_0",                # 8-bit Key Cache precision
            "-ctv", "q8_0",                # 8-bit Value Cache precision
            "-ngl", "99",
            "--port", "11434",
        ],
        cwd=str(SERVER_DIR),
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )

def check_llama():
    response = subprocess.run(
            ["curl", "-sf", "http://127.0.0.1:11434/health"],
            capture_output=False,
        )
        # Because we use -f, curl will return a non-zero exit code for HTTP failures (e.g. 404, 500, etc.).
    if response.returncode == 0:
        return True
    else:
        return False


def init(sys_prompt: str = DEFAULT_SYSTEM_PROMPT):
    messages_history.append({"role": "system", "content": "Okay, I am ready."})
    messages_history.append({"role": "system", "content": sys_prompt})
    messages_history.append({"role": "assistant", "content": "Understood, Felix."})
    client = OpenAI(
        base_url="http://127.0.0.1:11434/v1",
        api_key="not-needed"
    )
    return client

def generate_response(client, prompt: str):
    global messages_history
    messages_history.append({"role": "user", "content": prompt})
    response = client.chat.completions.create(
        model="local-model",
        messages=messages_history,
        stream=True
    )
    msg = ""
    print("\n\033[94mLily:\033[0m")
    for chunk in response:
        if chunk.choices and chunk.choices[0].delta.content:
            token = chunk.choices[0].delta.content
            print(token, end="", flush=True)
            msg = msg + token
    print("\n\n")
    messages_history.append({"role": "assistant", "content": msg})

def print_header():
    print("==================== Felix's Local LLM ====================")
    print(f"Model: Qwen2.5-Coder-14B-Instruct-Q4_K_M")
    print(f"clr = clear history, rs = restart llama-server\n")

def main():
    print_header()
    print("Starting llama-server...")
    running = check_llama()
    if not running:
        start_llama()
    while not running:
        running = check_llama()
        time.sleep(1)
    print("llama-server is up and running.\n\n")
    client = init()
    os.system("cls")
    print_header()

    while True:
        ip = input("\033[92mYou: \033[0m\n")
        if ip == "clr":
            messages_history = []
            messages_history.append({"role": "system", "content": "Ok, I am ready."})
            messages_history.append({"role": "system", "content": DEFAULT_SYSTEM_PROMPT})
            messages_history.append({"role": "assistant", "content": "Understood!"})
            os.system("cls")
            print_header()
        elif ip == "rs":
            running = check_llama()
            start_llama()
            while not running:
                running = check_llama()
                time.sleep(1)
            print("llama-server is up and running.\n\n")
        else:
            generate_response(client, ip)


if __name__ == "__main__":
    main()