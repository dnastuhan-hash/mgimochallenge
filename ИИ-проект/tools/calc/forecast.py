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


def compute(cfg: dict, scen: str, option: str | None = None) -> dict:
    fc = cfg["forecast"]
    option = option or fc.get("option")
    env = dict(values(cfg, scen))
    if option and option in cfg.get("economics", {}).get("options", {}):
        env["econ_net_y1_mln"] = run_option(cfg, option, scen)["net_y1"] / 1e6
    for k, expr in fc.get("option_vars", {}).get(option, {}).items():  # переменные варианта (x_*)
        env[k] = ev(expr, env)
    out = {}
    for m in fc["metrics"]:
        env["no_change"] = m.get("no_change")
        x = ev(m["expr"], env)
        out[m["key"]] = x
        env[m["key"]] = x
    return out


def render(cfg, res, option=None) -> str:
    fc = cfg["forecast"]
    option = option or fc.get("option")
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
            f"Скрипт: `tools/calc/forecast.py`. Вариант: `{option or '—'}`.\n\n{t}\n\n## Откуда разница с «без изменений»\n\n{expl}\n")


def compare(cfg) -> tuple[str, dict]:
    """Сравнение вариантов по всем показателям: основной сценарий и вилка [неблагопр. … благопр.]."""
    fc = cfg["forecast"]
    opts = list(fc.get("option_vars", {}))
    data, rows = {}, []
    for o in opts:
        r = {s: compute(cfg, s, o) for s in ("low", "base", "high")}
        data[o] = r
        title = cfg.get("economics", {}).get("options", {}).get(o, {}).get("title", o)
        cells = [title]
        for m in fc["metrics"]:
            nd, pct = m.get("nd", 0), m.get("unit") == "%"
            f = (lambda x: fmt(x * 100, nd) if pct else fmt(x, nd))
            lo, ba, hi = r["low"][m["key"]], r["base"][m["key"]], r["high"][m["key"]]
            cells.append(f"**{f(ba)}** [{f(min(lo, hi))}…{f(max(lo, hi))}]")
        rows.append(cells)
    hdr = ["Вариант"] + [m["name"] + (" (%)" if m.get("unit") == "%" else "") for m in fc["metrics"]]
    tgt = ["**Цель**"] + [(fmt(m["target"] * 100, m.get("nd", 0)) if m.get("unit") == "%" else fmt(m["target"], m.get("nd", 0)))
                          if m.get("target") is not None else "—" for m in fc["metrics"]]
    md = ("# Сравнение вариантов по ключевым показателям планового года\n\n"
          "Основной сценарий, в скобках — [неблагоприятный … благоприятный]. Скрипт: `tools/calc/forecast.py --compare`.\n\n"
          + md_table(hdr, rows + [tgt]) + "\n")
    return md, data


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--params", required=True)
    ap.add_argument("--option", help="вариант из forecast.option_vars (по умолчанию forecast.option)")
    ap.add_argument("--compare", action="store_true", help="сравнить все варианты из option_vars")
    ap.add_argument("--out")
    a = ap.parse_args()
    cfg = load(a.params)
    if a.compare:
        md, data = compare(cfg)
        stem = "compare_out"
    else:
        data = {s: compute(cfg, s, a.option) for s in ("low", "base", "high")}
        md = render(cfg, data, a.option)
        stem = f"forecast_{a.option}_out" if a.option else "forecast_out"
    if a.out:
        print(f"→ {write(a.out, stem, md, data)}")
    print(md)


if __name__ == "__main__":
    main()
