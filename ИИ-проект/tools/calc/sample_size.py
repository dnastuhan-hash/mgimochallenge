#!/usr/bin/env python3
"""Размер выборки пилота (сравнение двух долей), эффект дизайна, темп набора, достижимый минимальный эффект.

  python3 tools/calc/sample_size.py --p1 0.12 --p2 0.09 [--alpha 0.05 --power 0.8]
         [--cluster-size 1 --icc 0] [--weekly 250 --weeks 13] [--out projects/<id>/calc]
  python3 tools/calc/sample_size.py --params projects/<id>/calc/params.json --out projects/<id>/calc

p1 — доля события при обычном обслуживании, p2 — ожидаемая при новом (минимально важное улучшение).
Единица — то, что рандомизируется (семья/группа); при метрике по номерам внутри группы задайте
--cluster-size (номеров в группе) и --icc (внутригрупповая корреляция): эффект дизайна 1+(m−1)·ICC.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path
from statistics import NormalDist

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ev, fmt, load, md_table, values, write  # noqa: E402

Z = NormalDist().inv_cdf


def n_per_arm(p1: float, p2: float, alpha=0.05, power=0.8) -> float:
    if p1 == p2:
        return math.inf
    za, zb = Z(1 - alpha / 2), Z(power)
    pbar = (p1 + p2) / 2
    num = za * math.sqrt(2 * pbar * (1 - pbar)) + zb * math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))
    return num ** 2 / (p1 - p2) ** 2


def mde_for_n(p1: float, n: float, alpha=0.05, power=0.8, direction=-1) -> float:
    """Наименьшее обнаружимое изменение доли при n на группу (бисекция). direction=-1 — снижение."""
    lo, hi = 1e-6, (p1 if direction < 0 else 1 - p1) - 1e-6
    for _ in range(100):
        mid = (lo + hi) / 2
        if n_per_arm(p1, p1 + direction * mid, alpha, power) > n:
            lo = mid
        else:
            hi = mid
    return hi


def compute(p1, p2, alpha=0.05, power=0.8, cluster_size=1.0, icc=0.0, weekly=None, weeks=None, observe_weeks=0, arms=2):
    deff = 1 + (cluster_size - 1) * icc
    n = math.ceil(n_per_arm(p1, p2, alpha, power) * deff)
    total = n * arms
    res = {"p1": p1, "p2": p2, "abs_change_pp": round((p2 - p1) * 100, 2), "rel_change_pct": round((p2 / p1 - 1) * 100, 1),
           "alpha": alpha, "power": power, "design_effect": round(deff, 3), "n_per_arm": n, "n_total": total, "arms": arms}
    if weekly:
        need_weeks = total / weekly
        res.update({"weekly_eligible": weekly, "weeks_to_recruit": round(need_weeks, 1),
                    "weeks_total_with_observation": round(need_weeks + observe_weeks, 1)})
        if weeks:
            avail = weekly * weeks
            n_av = avail / arms / deff
            res.update({"weeks_available": weeks, "recruited_in_window": int(avail),
                        "enough": avail >= total,
                        "mde_pp_in_window": round(-mde_for_n(p1, n_av, alpha, power) * 100, 2) if n_av > 0 else None,
                        "weekly_needed": math.ceil(total / weeks)})
    return res


def render(r: dict, title="Размер выборки пилота") -> str:
    rows = [["Доля при обычном обслуживании (p1)", f"{r['p1']:.1%}"],
            ["Ожидаемая доля при новом (p2)", f"{r['p2']:.1%}"],
            ["Изменение", f"{r['abs_change_pp']:+} п.п. ({r['rel_change_pct']:+} % относительно)"],
            ["α (двусторонняя) / мощность", f"{r['alpha']} / {r['power']}"],
            ["Эффект дизайна", r["design_effect"]],
            ["**Нужно на вариант**", f"**{fmt(r['n_per_arm'])}**"],
            ["Всего (вариантов: %d)" % r["arms"], fmt(r["n_total"])]]
    if "weekly_eligible" in r:
        rows += [["Впервые подходящих единиц в неделю", fmt(r["weekly_eligible"])],
                 ["Недель набора нужно", fmt(r["weeks_to_recruit"], 1)],
                 ["+ наблюдение за последними", fmt(r["weeks_total_with_observation"], 1)]]
    if "weeks_available" in r:
        verdict = "хватает" if r["enough"] else "НЕ хватает"
        rows += [["Недель отведено на набор", r["weeks_available"]],
                 ["Наберём за это время", fmt(r["recruited_in_window"])],
                 ["Вывод о темпе", f"**{verdict}**; нужно ≥ {fmt(r['weekly_needed'])} в неделю"],
                 ["Обнаружимое изменение при доступном наборе", f"{r['mde_pp_in_window']} п.п." if r["mde_pp_in_window"] is not None else "—"]]
    formula = ("n = (z₁₋α/₂·√(2p̄(1−p̄)) + z₁₋β·√(p1(1−p1)+p2(1−p2)))² / (p1−p2)² × [1+(m−1)·ICC]")
    return f"## {title}\n\n{md_table(['Показатель', 'Значение'], rows)}\n\nФормула: `{formula}`\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--params")
    ap.add_argument("--p1", type=float); ap.add_argument("--p2", type=float)
    ap.add_argument("--alpha", type=float, default=0.05); ap.add_argument("--power", type=float, default=0.8)
    ap.add_argument("--cluster-size", type=float, default=1); ap.add_argument("--icc", type=float, default=0)
    ap.add_argument("--weekly", type=float); ap.add_argument("--weeks", type=float); ap.add_argument("--observe-weeks", type=float, default=0)
    ap.add_argument("--arms", type=int, default=2)
    ap.add_argument("--out")
    a = ap.parse_args()

    sections, data = [], {}
    if a.params:
        cfg = load(a.params)
        pilot = cfg.get("pilot", {})
        for scen in ("base", "low", "high") if pilot.get("scenarios", True) else ("base",):
            v = values(cfg, scen)
            g = lambda k, d=None: ev(pilot[k], v) if k in pilot else d  # noqa: E731
            r = compute(g("p1"), g("p2"), g("alpha", 0.05), g("power", 0.8), g("cluster_size", 1), g("icc", 0),
                        g("weekly"), g("weeks"), g("observe_weeks", 0), int(g("arms", 2)))
            data[scen] = r
            sections.append(render(r, f"{pilot.get('title', 'Пилот')} — сценарий набора: {scen}"))
    else:
        if a.p1 is None or a.p2 is None:
            ap.error("нужны --p1 и --p2 или --params")
        r = compute(a.p1, a.p2, a.alpha, a.power, a.cluster_size, a.icc, a.weekly, a.weeks, a.observe_weeks, a.arms)
        data["base"] = r
        sections.append(render(r))
    md = "# Расчёт размера выборки\n\nСкрипт: `tools/calc/sample_size.py`\n\n" + "\n".join(sections)
    if a.out:
        print(f"→ {write(a.out, 'sample_size_out', md, data)}")
    print(md)


if __name__ == "__main__":
    main()
