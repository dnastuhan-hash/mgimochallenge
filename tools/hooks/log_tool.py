#!/usr/bin/env python3
"""PostToolUse-хук: каждое действие агента — строка в журнале активного проекта (прозрачность и учёт).

Пишет коротко: инструмент, цель (файл/команда/URL), признак ошибки. Ошибки помечаются kind=error,
чтобы после сбоя было видно, что не выполнено, и работа возобновлялась без незаметного повтора.
"""
import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKIP = {"TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet"}


def target(tool, inp):
    for k in ("file_path", "url", "pattern", "query", "skill", "subagent_type", "description"):
        if inp.get(k):
            return f"{k}={str(inp[k])[:120]}"
    if inp.get("command"):
        return "cmd=" + " ".join(str(inp["command"]).split())[:140]
    return ""


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return
    tool = data.get("tool_name", "")
    if tool in SKIP:
        return
    act = ROOT / "projects" / ".active"
    if not act.exists():
        return
    pdir = ROOT / "projects" / act.read_text(encoding="utf-8").strip()
    if not (pdir / "log.jsonl").exists():
        return
    inp = data.get("tool_input", {}) or {}
    # не журналируем собственные обращения к журналу — иначе дубли
    if tool == "Bash" and "sfp" in str(inp.get("command", "")) and " log " in f" {inp.get('command', '')} ":
        return
    resp = data.get("tool_response")
    is_err = False
    if isinstance(resp, dict):
        is_err = bool(resp.get("is_error") or resp.get("error") or resp.get("interrupted"))
        if "exit_code" in resp and resp.get("exit_code") not in (0, None):
            is_err = True
    stage = None
    try:
        stage = json.loads((pdir / "state.json").read_text(encoding="utf-8")).get("stage")
    except Exception:
        pass
    row = {"ts": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
           "kind": "error" if is_err else "tool", "stage": stage, "tool": tool,
           "summary": target(tool, inp), "session": data.get("session_id", "")[:8]}
    with (pdir / "log.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
