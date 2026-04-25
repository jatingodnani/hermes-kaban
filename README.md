# hermes-kanban

A live **Kanban board** dashboard plugin for [Hermes Agent](https://github.com/NousResearch/hermes-agent) — shows the real-time status of all agent sessions in a clean three-column board.

![hermes-kanban screenshot](https://raw.githubusercontent.com/jatingodnani/hermes-kanban/main/screenshot.png)

---

## Features

- **3-column board** — Running ⚡ · Completed ✓ · Failed ✕
- **Auto-refresh every 4 seconds**, pauses when the tab is hidden
- **Live duration timer** on running cards (counts up in real time)
- **Last active tool badge** on running cards (`💻 terminal`, `🌐 browser`, etc.)
- **Per-platform source badges** with distinct colors (CLI, Telegram, Discord, Slack, Batch, API, WhatsApp, Email…)
- **Session cost + message/tool-call counts** on every card
- **Click any card** → jumps to that session in the Sessions tab
- **Fully theme-aware** — uses Hermes dashboard CSS variables, automatically reskins with any active theme
- **Zero build step** — pure drop-in, no npm, no bundler

---

## Installation

### Option A — user install (recommended for trying it out)

```bash
mkdir -p ~/.hermes/plugins
cp -r hermes-kanban ~/.hermes/plugins/
```

Then either restart the Hermes web UI or trigger a hot-reload:

```bash
curl http://127.0.0.1:9119/api/dashboard/plugins/rescan
```

Open the dashboard — a **Kanban** tab will appear after the Sessions tab.

### Option B — repo install (for contributors / always-on)

Copy the plugin into the hermes-agent plugins directory:

```bash
cp -r hermes-kanban /path/to/hermes-agent/plugins/
```

The plugin is auto-discovered on next startup.

---

## File structure

```
hermes-kanban/
└── dashboard/
    ├── manifest.json      ← Tab registration (icon, label, position)
    ├── plugin_api.py      ← FastAPI backend — reads SessionDB, serves /api/plugins/hermes-kanban/sessions
    └── dist/
        ├── index.js       ← Kanban UI (single IIFE, uses window.__HERMES_PLUGIN_SDK__)
        └── style.css      ← Theme-aware styles (CSS variables only)
```

**No build step.** Drop the four files in and you're done.

---

## How it works

```
SessionDB (SQLite)
    ↓  reads last 24h of sessions
plugin_api.py  →  GET /api/plugins/hermes-kanban/sessions
    ↓  every 4s (pauses when tab hidden)
KanbanPage (React via SDK)
    ↓
KanbanColumn × 3   [Running | Completed | Failed]
    ↓
AgentCard × N
```

### Session classification

| Condition | Column |
|-----------|--------|
| `ended_at IS NULL` and active within last hour | **Running** |
| `ended_at IS NULL` and no activity > 1h | **Failed** (crashed/zombie) |
| `end_reason` in `error / timeout / budget_exceeded / max_iterations / interrupt / exception` | **Failed** |
| everything else | **Completed** |

Subagent sessions and compression continuations are filtered out — only root sessions are shown.

---

## API response shape

```
GET /api/plugins/hermes-kanban/sessions

{
  "running":   [ ...cards ],
  "completed": [ ...cards ],
  "failed":    [ ...cards ],
  "stats": { "total": 10, "running": 2, "completed": 7, "failed": 1 }
}
```

Each card:

```json
{
  "id": "sess_abc123",
  "title": "Write a Python script that...",
  "source": "cli",
  "model": "claude-opus-4",
  "started_at": 1745600000.0,
  "ended_at": null,
  "end_reason": null,
  "duration_seconds": 272,
  "message_count": 14,
  "tool_call_count": 6,
  "estimated_cost_usd": 0.012,
  "preview": "Write a Python script that...",
  "last_tool": "terminal",
  "status": "running"
}
```

---

## Theming

The plugin uses only Hermes dashboard CSS variables — no hardcoded colors. It automatically adapts to any active theme:

| Token | Used for |
|-------|----------|
| `--color-success` | Running state (green) |
| `--color-destructive` | Failed state (red) |
| `--color-warning` | API/email badge color |
| `--color-foreground` | Completed accent, text |
| `--color-card` | Card backgrounds |
| `--color-muted` / `--color-border` | Subdued surfaces |

---

## Requirements

- Hermes Agent with the web dashboard enabled (`hermes web` or `hermes --web`)
- Python 3.10+
- No extra pip dependencies — uses `hermes_state.SessionDB` which is part of Hermes core

---

## License

MIT — see [LICENSE](LICENSE)
# hermes-kanban
# hermes-kaban
