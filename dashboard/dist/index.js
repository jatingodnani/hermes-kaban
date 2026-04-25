
(function () {
  "use strict";

  // ── SDK wiring ─────────────────────────────────────────────────────────────
  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK) {
    console.error("[hermes-kanban] __HERMES_PLUGIN_SDK__ not found.");
    return;
  }

  const { React } = SDK;
  const { useState, useEffect, useCallback, useRef } = SDK.hooks || React;
  const e = React.createElement;

  // Fetch helper — falls back to plain fetch if SDK doesn't expose fetchJSON
  const fetchJSON = SDK.fetchJSON
    ? (path) => SDK.fetchJSON(path)
    : (path) => fetch(path).then((r) => r.json());

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function formatDuration(seconds) {
    if (seconds == null || seconds < 0) return "—";
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${(m % 60).toString().padStart(2, "0")}m`;
  }

  function formatCost(usd) {
    if (usd == null || usd === 0) return null;
    if (usd < 0.0001) return "<$0.0001";
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(3)}`;
  }

  function secondsSince(unixTs) {
    if (!unixTs) return 0;
    return Math.max(0, Math.floor(Date.now() / 1000 - unixTs));
  }

  /** Strip leading [Note: ...] system annotations from a string */
  function stripNotes(str) {
    if (!str) return str;
    return str.replace(/^\[Note:[^\]]*\]\s*/gi, "").trim();
  }

  /** Format a Unix timestamp as a human-readable time string */
  function formatTime(unixTs) {
    if (!unixTs) return "—";
    const d = new Date(unixTs * 1000);
    const now = new Date();
    // Same day? Show HH:mm, otherwise show MMM DD HH:mm
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // ── Source badge variants ────────────────────────────────────────────────────
  // Each maps to a .hk-badge--<name> CSS class
  const KNOWN_SOURCES = new Set([
    "cli", "telegram", "discord", "slack", "batch",
    "api", "whatsapp", "email", "matrix",
  ]);

  function getSourceVariant(source) {
    const key = (source || "").toLowerCase();
    return KNOWN_SOURCES.has(key) ? key : "muted";
  }

  // ── Tool emojis ──────────────────────────────────────────────────────────────
  const TOOL_EMOJI_MAP = {
    terminal: "💻", shell: "💻", bash: "💻", execute: "💻",
    browser: "🌐", web: "🌐", navigate: "🌐", scrape: "🌐",
    search: "🔍", google: "🔍", bing: "🔍",
    file: "📁", read: "📄", write: "✏️", edit: "✏️",
    memory: "🧠", remember: "🧠",
    image: "🖼️", screenshot: "📸", vision: "👁️",
    email: "📧", send: "📤",
    todo: "✅", task: "✅",
    code: "⚙️", python: "🐍",
    api: "🔌", http: "🔌", request: "🔌",
  };

  function getToolEmoji(toolName) {
    if (!toolName) return "🔧";
    const lower = toolName.toLowerCase();
    for (const [key, emoji] of Object.entries(TOOL_EMOJI_MAP)) {
      if (lower.includes(key)) return emoji;
    }
    return "🔧";
  }

  // ── Components ───────────────────────────────────────────────────────────────

  /** Animated dot on running cards */
  function LivePulse() {
    return e("span", { className: "hk-live-pulse" });
  }

  /** Colored pill showing which platform the agent is running on */
  function SourceBadge({ source }) {
    const variant = getSourceVariant(source);
    return e(
      "span",
      { className: `hk-source-badge hk-badge--${variant}` },
      source || "unknown"
    );
  }

  /** Live counting duration for running sessions — counts up in real time */
  function LiveDuration({ startedAt }) {
    const [sec, setSec] = useState(() => secondsSince(startedAt));
    useEffect(() => {
      if (!startedAt) return;
      const id = setInterval(() => setSec(secondsSince(startedAt)), 1000);
      return () => clearInterval(id);
    }, [startedAt]);
    return e("span", { className: "hk-meta-value" }, formatDuration(sec));
  }

  /** Individual agent card */
  function AgentCard({ session }) {
    const isRunning = session.status === "running";
    const isFailed = session.status === "failed";
    const isComplete = session.status === "completed";

    const cardClass = [
      "hk-card",
      isRunning ? "hk-card--running" : "",
      isFailed ? "hk-card--failed" : "",
      isComplete ? "hk-card--completed" : "",
    ].filter(Boolean).join(" ");

    function handleClick() {
      window.location.href = `/sessions?highlight=${session.id}`;
    }

    const cost = formatCost(session.estimated_cost_usd);
    const title = stripNotes(session.title) || "Untitled Session";
    const preview = stripNotes(session.preview) || "";

    return e(
      "div",
      { className: cardClass, onClick: handleClick, title: "Open session" },

      // ── Card header: source badge + status indicator
      e(
        "div",
        { className: "hk-card-header" },
        e(SourceBadge, { source: session.source }),
        isRunning && e(LivePulse),
        isFailed && e("span", { className: "hk-failed-icon" }, "✕")
      ),

      // ── Title
      e("div", { className: "hk-card-title" }, title),

      // ── Model (mono, muted)
      session.model &&
      e("div", { className: "hk-card-model" }, session.model),

      // ── Preview (first user message excerpt)
      preview &&
      e("div", { className: "hk-card-preview" }, preview),

      // ── Divider
      e("div", { className: "hk-card-divider" }),

      // ── Meta row
      e(
        "div",
        { className: "hk-card-meta" },

        // Duration
        e(
          "div",
          { className: "hk-meta-item" },
          e("span", { className: "hk-meta-label" }, "⏱"),
          isRunning
            ? e(LiveDuration, { startedAt: session.started_at })
            : e("span", { className: "hk-meta-value" }, formatDuration(session.duration_seconds))
        ),

        // Messages
        session.message_count > 0 &&
        e(
          "div",
          { className: "hk-meta-item" },
          e("span", { className: "hk-meta-label" }, "💬"),
          e("span", { className: "hk-meta-value" }, session.message_count)
        ),

        // Tool calls
        session.tool_call_count > 0 &&
        e(
          "div",
          { className: "hk-meta-item" },
          e("span", { className: "hk-meta-label" }, "🔧"),
          e("span", { className: "hk-meta-value" }, session.tool_call_count)
        ),

        // Cost
        cost &&
        e(
          "div",
          { className: "hk-meta-item" },
          e("span", { className: "hk-meta-label" }, "💰"),
          e("span", { className: "hk-meta-value" }, cost)
        ),

        // Start time (on completed / failed cards)
        !isRunning && session.started_at &&
        e(
          "div",
          { className: "hk-meta-item" },
          e("span", { className: "hk-meta-label" }, "🕐"),
          e("span", { className: "hk-meta-value" }, formatTime(session.started_at))
        )
      ),

      // ── Currently active tool (running sessions)
      isRunning && session.last_tool &&
      e(
        "div",
        { className: "hk-last-tool" },
        e("span", { className: "hk-last-tool-emoji" }, getToolEmoji(session.last_tool)),
        e("span", { className: "hk-last-tool-name" }, session.last_tool)
      ),

      // ── End/failure reason (failed sessions)
      isFailed && session.end_reason &&
      e("div", { className: "hk-end-reason" }, session.end_reason)
    );
  }

  /** A single Kanban column */
  function KanbanColumn({ title, icon, sessions, colorClass, emptyMsg, emptyIcon }) {
    return e(
      "div",
      { className: `hk-column ${colorClass}` },

      // Header
      e(
        "div",
        { className: "hk-column-header" },
        e("span", { className: "hk-column-icon" }, icon),
        e("span", { className: "hk-column-title" }, title),
        e("span", { className: "hk-column-count" }, sessions.length)
      ),

      // Cards list
      e(
        "div",
        { className: "hk-column-body" },
        sessions.length === 0
          ? e(
            "div",
            { className: "hk-empty" },
            e("span", null, emptyIcon || "—"),
            e("span", null, emptyMsg)
          )
          : sessions.map((s) => e(AgentCard, { key: s.id, session: s }))
      )
    );
  }

  /** Compact stat tile */
  function StatTile({ icon, value, label, variant }) {
    return e(
      "div",
      { className: `hk-stat${variant ? ` hk-stat--${variant}` : ""}` },
      e("span", { className: "hk-stat-icon" }, icon),
      e(
        "div",
        { className: "hk-stat-info" },
        e("span", { className: "hk-stat-value" }, value ?? "—"),
        e("span", { className: "hk-stat-label" }, label)
      )
    );
  }

  /** Top summary strip */
  function StatsBar({ stats }) {
    if (!stats) return null;
    return e(
      "div",
      { className: "hk-stats-bar" },
      e(StatTile, { icon: "📋", value: stats.total, label: "Total" }),
      e(StatTile, { icon: "⚡", value: stats.running, label: "Running", variant: "running" }),
      e(StatTile, { icon: "✓", value: stats.completed, label: "Done" }),
      e(StatTile, { icon: "✕", value: stats.failed, label: "Failed", variant: "failed" })
    );
  }

  // ── Main page component ──────────────────────────────────────────────────────

  function KanbanPage() {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [lastFetchTs, setLastFetchTs] = useState(null);
    const [secSince, setSecSince] = useState(0);

    // ── Fetch ─────────────────────────────────────────────────────────────────
    const fetchData = useCallback(async () => {
      try {
        const result = await fetchJSON("/api/plugins/hermes-kanban/sessions");
        setData(result);
        setLastFetchTs(Date.now());
        setSecSince(0);
        setError(null);
      } catch (err) {
        setError(err?.message || "Failed to load sessions");
      } finally {
        setLoading(false);
      }
    }, []);

    // ── Poll every 4s, pause when tab is hidden ───────────────────────────────
    useEffect(() => {
      fetchData();
      const id = setInterval(() => {
        if (!document.hidden) fetchData();
      }, 4000);
      return () => clearInterval(id);
    }, [fetchData]);

    // ── "Updated X seconds ago" ticker ───────────────────────────────────────
    useEffect(() => {
      const id = setInterval(() => setSecSince((s) => s + 1), 1000);
      return () => clearInterval(id);
    }, []);

    // ── Loading state ─────────────────────────────────────────────────────────
    if (loading) {
      return e(
        "div",
        { className: "hk-root hk-loading" },
        e("div", { className: "hk-loading-spinner" }),
        e("p", null, "Loading agent sessions…")
      );
    }

    // ── Error state (no stale data) ───────────────────────────────────────────
    if (error && !data) {
      return e(
        "div",
        { className: "hk-root hk-error" },
        e("div", { className: "hk-error-icon" }, "⚠️"),
        e("p", null, `Could not load sessions: ${error}`),
        e("button", { className: "hk-retry-btn", onClick: fetchData }, "↻ Retry")
      );
    }

    const running = data?.running || [];
    const completed = data?.completed || [];
    const failed = data?.failed || [];
    const stats = data?.stats || { total: 0, running: 0, completed: 0, failed: 0 };

    const updatedLabel =
      !lastFetchTs ? ""
        : secSince < 5 ? "Just updated"
          : secSince < 60 ? `${secSince}s ago`
            : `${Math.floor(secSince / 60)}m ago`;

    // ── Render ────────────────────────────────────────────────────────────────
    return e(
      "div",
      { className: "hk-root" },

      // Header
      e(
        "div",
        { className: "hk-header" },
        e(
          "div",
          { className: "hk-header-left" },
          e("h1", { className: "hk-title" }, "Agent Kanban"),
          e(
            "div",
            { className: "hk-live-indicator" },
            e("span", { className: "hk-live-dot" }),
            e("span", { className: "hk-live-label" }, "Live")
          )
        ),
        e(
          "div",
          { className: "hk-header-right" },
          updatedLabel && e("span", { className: "hk-updated-label" }, updatedLabel),
          e(
            "button",
            { className: "hk-refresh-btn", onClick: fetchData, title: "Refresh now" },
            "↻ Refresh"
          )
        )
      ),

      // Stats
      e(StatsBar, { stats }),

      // Soft error banner (stale data + new error)
      error &&
      e(
        "div",
        {
          style: {
            padding: "0.45rem 0.8rem",
            background: "color-mix(in srgb, var(--color-destructive) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-destructive) 25%, transparent)",
            borderRadius: "var(--radius, 6px)",
            fontSize: "0.75rem",
            color: "var(--color-destructive)",
          },
        },
        `⚠️ Refresh failed: ${error} — showing last known state`
      ),

      // Board
      e(
        "div",
        { className: "hk-board" },
        e(KanbanColumn, {
          title: "Running",
          icon: "⚡",
          sessions: running,
          colorClass: "hk-col--running",
          emptyMsg: "No agents running right now",
          emptyIcon: "😴",
        }),
        e(KanbanColumn, {
          title: "Completed",
          icon: "✅",
          sessions: completed,
          colorClass: "hk-col--completed",
          emptyMsg: "No completed sessions in last 24h",
          emptyIcon: "📭",
        }),
        e(KanbanColumn, {
          title: "Failed",
          icon: "❌",
          sessions: failed,
          colorClass: "hk-col--failed",
          emptyMsg: "No failures — all good!",
          emptyIcon: "🎉",
        })
      )
    );
  }

  // ── Register with the dashboard shell ────────────────────────────────────────
  if (window.__HERMES_PLUGINS__ && typeof window.__HERMES_PLUGINS__.register === "function") {
    window.__HERMES_PLUGINS__.register("hermes-kanban", KanbanPage);
  } else {
    console.error("[hermes-kanban] __HERMES_PLUGINS__.register not found — plugin not loaded.");
  }
})();
