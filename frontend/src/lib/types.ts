// src/lib/types.ts
export interface ChatMessage {
    id: string
    role: "user" | "assistant"
    content: string;
    thinking?: string;
}

export interface Settings {
    companion: string;
    model: string;
    reasoning_level: string;
}