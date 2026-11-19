#!/usr/bin/env python3
"""PreToolUse-хук: (1) веб-доступ только к разрешённым доменам активного проекта;
(2) файлы состояния проекта меняются только через tools/sfp.py (не прямой правкой).

Код выхода 2 = блокировать вызов; текст из stderr Claude Code показывает агенту.
"""
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
PROTECTED = re.compile(r"projects/[^/]+/(claims|sources|decisions|log)\.jsonl$|projects/[^/]+/state\.json$")


def active_policy():
    act = ROOT / "projects" / ".active"
    if not act.exists():
        return None, None
    pid = act.read_text(encoding="utf-8").strip()
    meta = ROOT / "projects" / pid / "project.json"
    if not meta.exists():
        return pid, None
    return pid, json.loads(meta.read_text(encoding="utf-8")).get("source_policy", {})


def domain_allowed(host: str, allowed: list[str]) -> bool:
    host = (host or "").lower()
    return any(host == d or host.endswith("." + d) for d in allowed)


def block(msg: str):
    print(msg, file=sys.stderr)
    sys.exit(2)


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # не мешаем работе при неожиданном формате
    tool = data.get("tool_name", "")
    inp = data.get("tool_input", {}) or {}

    if tool in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
        path = str(inp.get("file_path", "")).replace("\\", "/")
        if PROTECTED.search(path):
            block("Файлы состояния и реестров меняются только через `python3 tools/sfp.py` "
                  "(claim/source/decision/stage/log) — так сохраняются проверки и журнал.")
        sys.exit(0)

    if tool not in ("WebFetch", "WebSearch"):
        sys.exit(0)
    pid, pol = active_policy()
    if pol is None:
        sys.exit(0)
    if pol.get("mode") == "open":
        denied = pol.get("denied_domains", [])
        host = urlparse(inp.get("url", "")).hostname if tool == "WebFetch" else ""
        if host and domain_allowed(host, denied):
            block(f"Домен {host} запрещён политикой проекта {pid}.")
        sys.exit(0)
    allowed = pol.get("allowed_domains", [])
    if tool == "WebFetch":
        host = urlparse(inp.get("url", "")).hostname or ""
        if not domain_allowed(host, allowed):
            block(f"Домен «{host}» не разрешён в проекте {pid}. По правилам: сначала обоснуй пользователю, "
                  f"какой вопрос закрывает источник и как может изменить решение; после согласия добавь домен в "
                  f"projects/{pid}/project.json → source_policy.allowed_domains.")
    else:  # WebSearch
        if not allowed:
            block(f"Веб-поиск в проекте {pid} не согласован (allowed_domains пуст). Обоснуй необходимость и получи согласие.")
        doms = inp.get("allowed_domains") or []
        if not doms or not all(domain_allowed(d, allowed) for d in doms):
            block(f"Веб-поиск разрешён только по доменам проекта: передай allowed_domains из {allowed}.")
    sys.exit(0)


if __name__ == "__main__":
    main()
