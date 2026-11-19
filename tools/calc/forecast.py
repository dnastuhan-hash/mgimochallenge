#!/usr/bin/env python3
"""Собственный прогноз по ключевым показателям рядом с исходной таблицей (план / оценка / без изменений / цель).

  python3 tools/calc/forecast.py --params projects/<id>/calc/params.json [--out projects/<id>/calc]

Раздел "forecast" в параметрах:
{
  "option": "<вариант из economics.options>",   # вклад в ВП берётся из economics.py
  "metrics": [
    {"key": "groups_eoy", "name": "Подключённые группы на конец года", "unit": "групп",
     "plan": 7500, "estimate": 6500, "no_change": 8000, "target": 12000,
     "expr": "8000 + extra_groups", "nd": 0, "explain": "откуда разница с «без изменений»"}
  ]
}
В выражениях доступны: параметры, ключи ранее рассчитанных метрик, econ_net_y1_mln (чистый вклад варианта, млн руб.),
min/max/round. Каждое отличие от «без изменений» должно быть объяснено в explain.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import SCEN_RU, ev, fmt, load, md_table, values, write  # noqa: E402
from economics import run_option  # noqa: E402


def compute(cfg: dict, scen: str) -> dict:
    fc = cfg["forecast"]
    env = dict(values(cfg, scen))
    if fc.get("option"):
        env["econ_net_y1_mln"] = run_option(cfg, fc["option"], scen)["net_y1"] / 1e6
    out = {}
    for m in fc["metrics"]:
        env["no_change"] = m.get("no_change")
        x = ev(m["expr"], env)
        out[m["key"]] = x
        env[m["key"]] = x
    return out


def render(cfg, res) -> str:
    fc = cfg["forecast"]
    rows = []
    for m in fc["metrics"]:
        nd = m.get("nd", 0)
        pct = m.get("unit") == "%"
        f = (lambda x: "—" if x is None else (fmt(x * 100, nd) + " %" if pct else fmt(x, nd)))
        lo, ba, hi = (res[s][m["key"]] for s in ("low", "base", "high"))
        tgt = m.get("target")
        gap = "—" if tgt is None else ("достигнута" if ba >= tgt else f(tgt - ba).replace(" %", " п.п.") if pct else f(tgt - ba))
        rows.append([m["name"], f(m.get("plan")), f(m.get("estimate")), f(m.get("no_change")), f(tgt),
                     f(lo), f"**{f(ba)}**", f(hi), gap])
    t = md_table(["Показатель", "Баз. год: план", "Баз. год: оценка", "План. год: без изменений", "Цель, не ниже",
                  f"Прогноз: {SCEN_RU['low']}", f"Прогноз: {SCEN_RU['base']}", f"Прогноз: {SCEN_RU['high']}",
                  "Разрыв до цели (осн.)"], rows)
    expl = "\n".join(f"- **{m['name']}**: {m.get('explain', '')} Формула: `{m['expr']}`" for m in fc["metrics"])
    return (f"# Прогноз показателей — {cfg.get('meta', {}).get('title', '')}\n\n"
            f"Скрипт: `tools/calc/forecast.py`. Вариант: `{fc.get('option', '—')}`.\n\n{t}\n\n## Откуда разница с «без изменений»\n\n{expl}\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--params", required=True)
    ap.add_argument("--out")
    a = ap.parse_args()
    cfg = load(a.params)
    res = {s: compute(cfg, s) for s in ("low", "base", "high")}
    md = render(cfg, res)
    if a.out:
        print(f"→ {write(a.out, 'forecast_out', md, res)}")
    print(md)


if __name__ == "__main__":
    main()
