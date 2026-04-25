"""
hermes-kanban — plugin_api.py

FastAPI backend for the Kanban dashboard plugin.
Registers GET /api/plugins/hermes-kanban/sessions

Returns sessions from the last 24 hours grouped by status:
  - running   → ended_at IS NULL
  - completed → ended successfully
  - failed    → ended with error / timeout / budget exceeded
"""

import sys
import os
import time
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter

# ── Locate hermes_state on sys.path ──────────────────────────────────────────
# The dashboard runtime typically adds the hermes-agent root to sys.path,
# but we guard against the case where it hasn't been added yet.
_HERMES_AGENT_ROOT = Path(__file__).resolve().parents[4] / "hermes-agent"
if str(_HERMES_AGENT_ROOT) not in sys.path and _HERMES_AGENT_ROOT.exists():
    sys.path.insert(0, str(_HERMES_AGENT_ROOT))

from hermes_state import SessionDB  # noqa: E402


# ── Constants ─────────────────────────────────────────────────────────────────

WINDOW_SECONDS = 24 * 60 * 60  # 24 hours
MAX_SESSIONS = 200

FAILED_END_REASONS = frozenset({
    "error",
    "timeout",
    "budget_exceeded",
    "max_iterations",
    "interrupt",
    "exception",
})


# ── Helpers ───────────────────────────────────────────────────────────────────

def _classify(session: Dict[str, Any]) -> str:
    """Determine the Kanban status column for a session."""
    if session.get("ended_at") is None:
        # If no activity for > 1 hour, it's a crashed/zombie session
        last_active = session.get("last_active") or session.get("started_at") or 0
        if time.time() - last_active > 3600:
            session["end_reason"] = "crashed"
            return "failed"
            
        # Check if agent has finished responding and is waiting for user
        if session.get("last_role") == "assistant":
            return "completed"
            
        return "running"
    if session.get("end_reason") in FAILED_END_REASONS:
        return "failed"
    return "completed"


def _get_last_tool(db: SessionDB, session_id: str) -> Optional[str]:
    """
    Return the tool_name of the most recently executed tool call in this
    session, or None if no tool calls have been made.
    """
    try:
        with db._lock:
            cursor = db._conn.execute(
                """
                SELECT tool_name
                FROM messages
                WHERE session_id = ?
                  AND role = 'tool'
                  AND tool_name IS NOT NULL
                ORDER BY timestamp DESC
                LIMIT 1
                """,
                (session_id,),
            )
            row = cursor.fetchone()
        return row["tool_name"] if row else None
    except Exception:
        return None


def _build_card(session: Dict[str, Any], status: str, last_tool: Optional[str]) -> Dict[str, Any]:
    """Convert a raw session row into a Kanban card dict."""
    started_at = session.get("started_at")
    ended_at = session.get("ended_at")

    if started_at is not None:
        end_ts = ended_at if ended_at else time.time()
        duration_seconds = max(0, int(end_ts - started_at))
    else:
        duration_seconds = None

    # Strip provider prefix from model name (e.g. "openai/gpt-4o" → "gpt-4o")
    raw_model = session.get("model") or ""
    model = raw_model.split("/")[-1][:40] if raw_model else ""

    # Truncate preview
    preview = (session.get("preview") or "").strip()
    
    # Strip internal notes (e.g. model switch messages) from preview
    if preview.startswith("[Note:"):
        preview = re.sub(r'^\[Note:.*?\]\s*', '', preview).strip()

    if len(preview) > 80:
        preview = preview[:80] + "…"

    # Derive display title: prefer explicit title, fall back to preview
    title = (session.get("title") or "").strip()
    if not title:
        title = preview[:50] if preview else "Untitled Session"

    cost = session.get("estimated_cost_usd")

    return {
        "id": session["id"],
        "title": title,
        "source": session.get("source") or "unknown",
        "model": model,
        "started_at": started_at,
        "ended_at": ended_at,
        "end_reason": session.get("end_reason"),
        "duration_seconds": duration_seconds,
        "message_count": session.get("message_count") or 0,
        "tool_call_count": session.get("tool_call_count") or 0,
        "api_call_count": session.get("api_call_count") or 0,
        "estimated_cost_usd": round(cost, 6) if cost else None,
        "preview": preview,
        "last_active": session.get("last_active"),
        "status": status,
        "last_tool": last_tool,
    }


# ── Router ────────────────────────────────────────────────────────────────────

router = APIRouter()


@router.get("/sessions")
async def get_kanban_sessions() -> Dict[str, Any]:
    """
    Return all sessions from the last 24 hours (plus any still running)
    grouped into three Kanban columns: running, completed, failed.

    Excludes child sessions (subagents / compression continuations) to keep
    the board clean — only root sessions are shown.
    """
    db = SessionDB()
    try:
        cutoff = time.time() - WINDOW_SECONDS

        with db._lock:
            cursor = db._conn.execute(
                """
                SELECT
                    s.*,
                    COALESCE(
                        (
                            SELECT SUBSTR(
                                REPLACE(REPLACE(m.content, X'0A', ' '), X'0D', ' '),
                                1, 120
                            )
                            FROM messages m
                            WHERE m.session_id = s.id
                              AND m.role = 'user'
                              AND m.content IS NOT NULL
                            ORDER BY m.timestamp ASC
                            LIMIT 1
                        ),
                        ''
                    ) AS preview,
                    COALESCE(
                        (SELECT MAX(m2.timestamp) FROM messages m2 WHERE m2.session_id = s.id),
                        s.started_at
                    ) AS last_active,
                    (
                        SELECT m3.role 
                        FROM messages m3 
                        WHERE m3.session_id = s.id 
                        ORDER BY m3.timestamp DESC 
                        LIMIT 1
                    ) AS last_role
                FROM sessions s
                WHERE s.source != 'subagent'
                  AND (s.end_reason IS NULL OR s.end_reason != 'compression')
                  AND (
                      s.ended_at IS NULL
                      OR s.started_at >= ?
                  )
                ORDER BY
                    CASE WHEN s.ended_at IS NULL THEN 0 ELSE 1 END ASC,
                    s.started_at DESC
                LIMIT ?
                """,
                (cutoff, MAX_SESSIONS),
            )
            rows = cursor.fetchall()

        sessions_raw: List[Dict[str, Any]] = []
        for row in rows:
            s = dict(row)
            # Filter out ancient zombies (older than 24h)
            if s.get("ended_at") is None:
                last_active = s.get("last_active") or s.get("started_at") or 0
                if last_active < cutoff:
                    continue
            sessions_raw.append(s)

        result: Dict[str, List] = {"running": [], "completed": [], "failed": []}

        for s in sessions_raw:
            status = _classify(s)
            last_tool = _get_last_tool(db, s["id"]) if status == "running" else None
            card = _build_card(s, status, last_tool)
            result[status].append(card)

        stats = {
            "total": len(sessions_raw),
            "running": len(result["running"]),
            "completed": len(result["completed"]),
            "failed": len(result["failed"]),
        }

        return {**result, "stats": stats}

    finally:
        db.close()
