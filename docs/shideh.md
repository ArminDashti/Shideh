# Shideh (SauronHarness)

Shideh is an agent-first build of VS Code. Cold start opens the **Agents window** by default.

## Providers

Built-in extension `extensions/shideh-agent` registers BYOK vendors: OpenCode Go, OpenCode Zen, OpenRouter, OpenAI, Anthropic, Ollama, DeepSeek, and OpenAI-compatible endpoints. Configure API keys via **Shideh Settings** (sidebar gear) or environment variables (`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, etc.).

## Memory

Shideh supports five popular memory framework adapters: **Mem0**, **Zep**, **LangMem**, **Cognee**, and **Graphiti**. Choose `shideh.memory.framework` in settings. Memory is stored under `%USERPROFILE%\.sauronharness\memory\<framework>\active.json` and injected into Shideh agent turns when `shideh.memory.enabled` is on.

## Default MCP servers

On first run, Shideh seeds your user MCP configuration with: **context7**, **github**, **donsetch**, **sequential-thinking**, **ssh-mcp**, and **desktop-commander** (disable with `shideh.mcp.seedDefaults`: false).

## Modes

Use **Ask**, **Build**, or **Plan** from the session toolbar, or set `shideh.defaultInteractionMode`.

## Hub & Stats

Open **Hub** in the sidebar to browse skills and MCP servers. Open **Stats** for session counts, MCP status, memory framework, harnesses, and bookmarked models.

## Favorite models

Run **Shideh: Bookmark Favorite Models** or use **Shideh Settings → Favorite Models**. Bookmarks sync with pinned models in the model picker (`shideh.favoriteModels`).

## Harnesses

`shideh.harnesses` enables **Cursor Plugin** and **Deepseek Harness** remote agent bridges by default (`localhost:3100` and `localhost:3300`). Use **Shideh: Connect Remote Agent** to add hosts.

## Remote agents

**Shideh: Connect Remote Agent** adds Cursor / OpenCode / Devin bridge addresses to `chat.remoteAgentHosts`. Run a compatible Agent Host bridge locally, then connect from Settings.
