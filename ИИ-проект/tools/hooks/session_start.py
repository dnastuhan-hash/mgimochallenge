#!/usr/bin/env python3
"""SessionStart-хук: вывод попадает в контекст агента — новый чат сразу знает, где остановились.

Показывает статус активного проекта, незавершённые/ошибочные действия из журнала и проверку целостности.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SFP = [sys.executable, str(ROOT / "tools" / "sfp.py")]


def run(*args):
    r = subprocess.run(SFP + list(args), capture_output=True, text=True, cwd=ROOT)
    return (r.stdout + r.stderr).strip()


def main():
    act = ROOT / "projects" / ".active"
    print("=== Стратег Фабрики продуктов: состояние при старте сессии ===")
    if not act.exists():
        print("Активного проекта нет. Спроси пользователя о задаче и создай проект: ./sfp init <id> --title \"…\"")
        print("Список проектов:\n" + run("list"))
        return
    print(run("status", "--tail", "8"))
    pid = act.read_text(encoding="utf-8").strip()
    log = ROOT / "projects" / pid / "log.jsonl"
    if log.exists():
        rows = [json.loads(l) for l in log.read_text(encoding="utf-8").splitlines() if l.strip()]
        errs = [r for r in rows[-50:] if r.get("kind") == "error"]
        if errs:
            print("\nНедавние ошибки инструментов (проверь, выполнено ли действие, прежде чем повторять):")
            for r in errs[-5:]:
                print(f"  {r['ts'][:16]} {r.get('tool')}: {r.get('summary')}")
    chk = run("check", "--quiet")
    print("\n" + chk.splitlines()[-1] if chk else "")
    print("\nДействуй по AGENTS.md §0: кратко доложи пользователю и продолжай с «Следующее действие», не повторяя сделанное.")


if __name__ == "__main__":
    main()
