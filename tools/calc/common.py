"""Общие функции расчётов: параметры со сценариями, вывод в Markdown/JSON.

Формат файла параметров (JSON):
{
  "meta": {"title": "...", "months_in_plan_year": 12, "horizon_months": 36},
  "params": {
    "имя": {"value": 500, "low": 400, "high": 600, "unit": "руб.", "type": "fact|assumption|decision",
            "source": "S-001 / C-003 / обоснование", "better": "higher|lower", "max": 1, "note": "..."}
                                       # max — физический предел (доля ≤ 1), для границы решения
  },
  "economics": {...}, "metrics": [...], "pilot": {...}
}

Сценарии: base — value; low (неблагоприятный) — для better=higher берётся low, для better=lower — high;
high (благоприятный) — наоборот. Факт без low/high одинаков во всех сценариях.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

SCENARIOS = ("low", "base", "high")
SCEN_RU = {"low": "неблагоприятный", "base": "основной", "high": "благоприятный"}


def load(path: str | Path) -> dict:
    cfg = json.loads(Path(path).read_text(encoding="utf-8"))
    for k, p in cfg.get("params", {}).items():
        if "value" not in p:
            raise ValueError(f"параметр {k}: нет value")
        if p.get("type") == "assumption" and ("low" not in p or "high" not in p):
            raise ValueError(f"допущение {k}: нужен диапазон low/high")
        if "low" in p and "high" in p and not (p["low"] <= p["value"] <= p["high"]):
            raise ValueError(f"параметр {k}: нарушено low ≤ value ≤ high")
    return cfg


def values(cfg: dict, scenario: str = "base", override: dict | None = None) -> dict:
    out = {}
    for k, p in cfg["params"].items():
        v = p["value"]
        if scenario != "base" and "low" in p:
            pess = p["low"] if p.get("better", "higher") == "higher" else p["high"]
            opt = p["high"] if p.get("better", "higher") == "higher" else p["low"]
            v = pess if scenario == "low" else opt
        out[k] = v
    if override:
        out.update(override)
    return out


def ev(expr, env: dict):
    """Число или выражение над параметрами (файлы параметров — материалы проекта, не внешний ввод)."""
    if isinstance(expr, (int, float)):
        return float(expr)
    if expr in env:
        return float(env[expr])
    safe = {"min": min, "max": max, "round": round, "abs": abs, "math": math}
    return float(eval(expr, {"__builtins__": {}}, {**safe, **env}))  # noqa: S307


def fmt(x, nd=0):
    if x is None:
        return "—"
    if isinstance(x, float) and math.isinf(x):
        return "∞"
    s = f"{x:,.{nd}f}".replace(",", " ")
    return s.replace(".", ",") if nd else s


def md_table(header: list[str], rows: list[list]) -> str:
    out = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def params_table(cfg: dict, names: list[str] | None = None) -> str:
    rows = []
    for k, p in cfg["params"].items():
        if names and k not in names:
            continue
        rng = f"{p['low']} … {p['high']}" if "low" in p else "—"
        rows.append([f"`{k}`", p.get("note", ""), p["value"], rng, p.get("unit", ""), p.get("type", ""), p.get("source", "")])
    return md_table(["Параметр", "Смысл", "Значение", "Диапазон", "Ед.", "Тип", "Источник / обоснование"], rows)


def write(out_dir: str | Path, stem: str, md: str, data: dict):
    d = Path(out_dir)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{stem}.md").write_text(md, encoding="utf-8")
    (d / f"{stem}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return d / f"{stem}.md"
