#!/usr/bin/env python3
"""Экономика варианта: доп. оплаченные месяцы → валовая прибыль, разрыв до цели, граница решения,
чувствительность, окупаемость и предельные вложения. Помесячная модель на горизонте (по умолчанию 36 мес.).

  python3 tools/calc/economics.py --params projects/<id>/calc/params.json [--option <имя>] [--out projects/<id>/calc]

Раздел "economics" в параметрах:
{
  "rate": "gp_per_paid_month",              # руб. валовой прибыли за доп. оплаченный месяц номера
  "baseline_gp": "gp_no_change_mln",        # ВП планового года без изменений, млн руб.
  "target_gp": "gp_target_mln",             # цель, млн руб.
  "dev_cost": "dev_cost_rub",               # стоимость разработки (может быть неизвестна → предельные вложения)
  "payback_months": 24,
  "boundary": ["имя_параметра", ...],       # для каких параметров искать границу решения
  "options": {"<вариант>": {"title": "...", "streams": [...], "costs": [...]}}
}
Типы потоков (все значения — имена параметров или выражения):
  retention        — покрытые номера (stock в месяц start + inflow в мес.) с меньшим оттоком:
                     {covered_stock, covered_inflow, start_month, [end_month], churn_base, churn_reduction}
  new_numbers      — дополнительные новые номера в месяц, платят с месяца прихода: {per_month, start_month, churn}
  lapse_prevention — предотвращённые остановки (неоплата): {numbers, lapse_rate, prevented_share, months_saved, start_month}
  monthly_gp       — другие доходы/экономия в руб./мес.: {rub_per_month, start_month}
Затраты: {name, rub_per_month, start_month} и/или {name, rub_per_unit, units_per_month, start_month}.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import SCEN_RU, ev, fmt, load, md_table, params_table, values, write  # noqa: E402


def simulate(opt: dict, v: dict, rate: float, horizon: int) -> dict:
    """Возвращает помесячные ряды: доп. оплаченные месяцы, доп. ВП, затраты, чистый вклад (руб.)."""
    months = [0.0] * (horizon + 1)  # индекс 1..horizon
    by_stream = {}
    for s in opt.get("streams", []):
        e = lambda k, d=0: ev(s[k], v) if k in s else d  # noqa: E731
        start = int(e("start_month", 1))
        end = int(e("end_month", horizon))  # после end новые номера/события не добавляются; уже набранные — доживают
        series = [0.0] * (horizon + 1)
        t = s["type"]
        if t == "retention":
            c0 = e("churn_base")
            c1 = c0 * (1 - e("churn_reduction"))
            alive0 = alive1 = 0.0
            for m in range(start, horizon + 1):
                add = ((e("covered_stock") if m == start else 0) + e("covered_inflow", 0)) if m <= end else 0
                alive0 = alive0 * (1 - c0) + add
                alive1 = alive1 * (1 - c1) + add
                series[m] = alive1 - alive0  # номера, которые платят в месяце m только благодаря изменению
        elif t == "new_numbers":
            c = e("churn")
            alive = 0.0
            for m in range(start, horizon + 1):
                alive = alive * (1 - c) + (e("per_month") if m <= end else 0)
                series[m] = alive
        elif t == "lapse_prevention":
            per_m = e("numbers") * e("lapse_rate") * e("prevented_share")
            L = e("months_saved")
            for m in range(start, end + 1):
                # каждое предотвращённое событие даёт L месяцев оплаты, начиная с текущего
                full = int(L)
                for k in range(full):
                    if m + k <= horizon:
                        series[m + k] += per_m
                if L - full > 0 and m + full <= horizon:
                    series[m + full] += per_m * (L - full)
        elif t == "monthly_gp":
            for m in range(start, end + 1):
                series[m] = e("rub_per_month") / rate  # переводим в эквивалент месяцев для единообразия
        else:
            raise ValueError(f"неизвестный тип потока {t}")
        by_stream[s.get("name", t)] = series
        for m in range(horizon + 1):
            months[m] += series[m]
    costs = [0.0] * (horizon + 1)
    for c in opt.get("costs", []):
        e = lambda k, d=0: ev(c[k], v) if k in c else d  # noqa: E731
        for m in range(int(e("start_month", 1)), horizon + 1):
            costs[m] += e("rub_per_month", 0) + e("rub_per_unit", 0) * e("units_per_month", 0)
    gp = [x * rate for x in months]
    net = [g - c for g, c in zip(gp, costs)]
    return {"paid_months": months, "gp": gp, "costs": costs, "net": net, "by_stream": by_stream}


def year_sum(series, y, n=12):
    return sum(series[(y - 1) * n + 1: y * n + 1])


def run_option(cfg, opt_name, scen="base", override=None):
    econ = cfg["economics"]
    v = values(cfg, scen, override)
    rate = ev(econ["rate"], v)
    horizon = int(cfg.get("meta", {}).get("horizon_months", 36))
    sim = simulate(econ["options"][opt_name], v, rate, horizon)
    base = ev(econ["baseline_gp"], v) * 1e6
    target = ev(econ["target_gp"], v) * 1e6
    y1 = year_sum(sim["net"], 1)
    res = {
        "scenario": scen, "rate": rate,
        "paid_months_y1": year_sum(sim["paid_months"], 1),
        "gp_y1": year_sum(sim["gp"], 1), "costs_y1": year_sum(sim["costs"], 1), "net_y1": y1,
        "net_y2": year_sum(sim["net"], 2), "net_y3": year_sum(sim["net"], 3),
        "total_gp_y1_mln": (base + y1) / 1e6, "target_mln": target / 1e6,
        "gap_mln": (target - base - y1) / 1e6, "months_needed_for_gap": (target - base) / rate,
        "by_stream_y1": {k: year_sum(s, 1) for k, s in sim["by_stream"].items()},
        "quarters_net": [sum(sim["net"][q * 3 + 1: q * 3 + 4]) for q in range(horizon // 3)],
    }
    pb = int(econ.get("payback_months", 24))
    res["max_investment_payback"] = sum(sim["net"][1: pb + 1])
    dev_expr = econ["options"][opt_name].get("dev_cost") or econ.get("dev_cost")  # у варианта может быть своя стоимость
    dev = ev(dev_expr, v) if dev_expr else None
    if dev:
        cum, month = 0.0, None
        for m in range(1, horizon + 1):
            cum += sim["net"][m]
            if cum >= dev:
                month = m
                break
        res.update({"dev_cost": dev, "payback_month": month})
    return res


def boundary(cfg, opt_name, param, goal_rub, scen="base"):
    """Значение параметра, при котором чистый вклад года 1 = goal_rub (остальные — по сценарию)."""
    v0 = values(cfg, scen)[param]
    f = lambda x: run_option(cfg, opt_name, scen, {param: x})["net_y1"] - goal_rub  # noqa: E731
    lo, hi = 0.0, max(abs(v0), 1e-9)
    f_lo = f(lo)
    for _ in range(40):  # расширяем вверх до смены знака
        if (f(hi) >= 0) != (f_lo >= 0):
            break
        hi *= 2
        if hi > 1e9:
            return None
    for _ in range(80):
        mid = (lo + hi) / 2
        if (f(mid) >= 0) == (f_lo >= 0):
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def sensitivity(cfg, opt_name):
    rows = []
    base = run_option(cfg, opt_name)["net_y1"]
    for k, p in cfg["params"].items():
        if "low" not in p:
            continue
        lo = run_option(cfg, opt_name, override={k: p["low"]})["net_y1"]
        hi = run_option(cfg, opt_name, override={k: p["high"]})["net_y1"]
        if abs(hi - lo) > 1:
            rows.append((k, lo, hi, abs(hi - lo)))
    rows.sort(key=lambda r: -r[3])
    return base, rows


def render(cfg, opt_name, res_by_scen, bounds, sens) -> str:
    opt = cfg["economics"]["options"][opt_name]
    b = res_by_scen["base"]
    L = [f"## Экономика: {opt.get('title', opt_name)}", ""]
    if opt.get("description"):
        L += [opt["description"], ""]
    hdr = ["Показатель"] + [SCEN_RU[s] for s in ("low", "base", "high")]
    g = lambda k, d=0: [res_by_scen[s][k] for s in ("low", "base", "high")]  # noqa: E731
    rows = [
        ["Доп. оплаченные месяцы, год 1"] + [fmt(x) for x in g("paid_months_y1")],
        ["Доп. валовая прибыль, год 1, млн руб."] + [fmt(x / 1e6, 2) for x in g("gp_y1")],
        ["Новые прямые расходы, год 1, млн руб."] + [fmt(x / 1e6, 2) for x in g("costs_y1")],
        ["**Чистый вклад, год 1, млн руб.**"] + [f"**{fmt(x / 1e6, 2)}**" for x in g("net_y1")],
        ["ВП планового года, млн руб. (цель %s)" % fmt(b["target_mln"], 0)] + [fmt(x, 1) for x in g("total_gp_y1_mln")],
        ["Остаток разрыва до цели, млн руб."] + [fmt(max(x, 0), 2) for x in g("gap_mln")],
        ["Чистый вклад, год 2, млн руб."] + [fmt(x / 1e6, 2) for x in g("net_y2")],
        ["Чистый вклад, год 3, млн руб."] + [fmt(x / 1e6, 2) for x in g("net_y3")],
        [f"Предельные вложения, окупаемые за {cfg['economics'].get('payback_months', 24)} мес., млн руб."]
        + [fmt(x / 1e6, 2) for x in g("max_investment_payback")],
    ]
    if b.get("dev_cost"):
        rows.append(["Стоимость разработки, млн руб."] + [fmt(res_by_scen[s]["dev_cost"] / 1e6, 2) for s in ("low", "base", "high")])
    if "payback_month" in b:
        rows.append(["Месяц окупаемости разработки"] + [str(res_by_scen[s].get("payback_month") or "> горизонта") for s in ("low", "base", "high")])
    L += [md_table(hdr, rows), ""]
    L += ["Вклад потоков в доп. оплаченные месяцы года 1 (основной сценарий): "
          + "; ".join(f"{k} — {fmt(x)}" for k, x in b["by_stream_y1"].items()), ""]
    L += [f"Для закрытия разрыва без новых расходов нужно **{fmt(b['months_needed_for_gap'])}** доп. оплаченных месяцев "
          f"(разрыв ÷ ставка {fmt(b['rate'])} руб.).", ""]
    if bounds:
        L += ["### Граница решения (при каком значении параметра год 1 закрывает разрыв, остальное — основной сценарий)", ""]
        br = []
        for k, x in bounds.items():
            p = cfg["params"][k]
            rng = f"{p.get('low', '—')} … {p.get('high', '—')}"
            if x is None or ("max" in p and x > p["max"]):
                verdict = "**недостижимо**" + (f" (больше физического предела {p['max']})" if x is not None else "")
            elif "low" in p and p["low"] <= x <= p["high"]:
                verdict = "внутри диапазона — **критичное допущение**, проверить первым"
            else:
                verdict = "вне правдоподобного диапазона — цель этим рычагом не достигается"
            br.append([f"`{k}`", p.get("note", ""), p["value"], rng, "—" if x is None else fmt(x, 4 if x < 10 else 0), verdict])
        L += [md_table(["Параметр", "Смысл", "Сейчас", "Диапазон", "Нужно для цели", "Вывод"], br), ""]
    base, srows = sens
    if srows:
        L += ["### Чувствительность чистого вклада года 1 (параметр от low до high, остальное — основной)", ""]
        L += [md_table(["Параметр", "При low, млн", "При high, млн", "Размах, млн"],
                       [[f"`{k}`", fmt(lo / 1e6, 2), fmt(hi / 1e6, 2), fmt(d / 1e6, 2)] for k, lo, hi, d in srows[:10]]), ""]
    qs = b["quarters_net"][:8]
    L += ["### Чистый вклад по кварталам (основной), млн руб.", "",
          md_table([f"Q{i + 1}" for i in range(len(qs))], [[fmt(x / 1e6, 2) for x in qs]]), ""]
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--params", required=True)
    ap.add_argument("--option", action="append", help="вариант (по умолчанию — все)")
    ap.add_argument("--out")
    a = ap.parse_args()
    cfg = load(a.params)
    econ = cfg["economics"]
    names = a.option or list(econ["options"])
    md = [f"# Экономика вариантов — {cfg.get('meta', {}).get('title', '')}", "",
          f"Скрипт: `tools/calc/economics.py`; параметры: `{a.params}`. Сценарии: неблагоприятный / основной / "
          f"благоприятный — каждое допущение берётся с худшего/лучшего края диапазона.", ""]
    data = {}
    summary = []
    for n in names:
        res = {s: run_option(cfg, n, s) for s in ("low", "base", "high")}
        goal = res["base"]["months_needed_for_gap"] * res["base"]["rate"]
        bounds = {k: boundary(cfg, n, k, goal) for k in econ.get("boundary", []) if k in _used_params(econ["options"][n])}
        sens = sensitivity(cfg, n)
        md.append(render(cfg, n, res, bounds, sens))
        data[n] = {"results": res, "boundary": bounds}
        summary.append([econ["options"][n].get("title", n)] + [fmt(res[s]["net_y1"] / 1e6, 2) for s in ("low", "base", "high")]
                       + [fmt(res["base"]["net_y3"] / 1e6, 2)])
    md[4:4] = ["## Сводка: чистый вклад в валовую прибыль, млн руб.", "",
               md_table(["Вариант", "Год 1 неблагопр.", "Год 1 основной", "Год 1 благопр.", "Год 3 основной"], summary), ""]
    md += ["## Параметры", "", params_table(cfg), ""]
    text = "\n".join(md)
    if a.out:
        print(f"→ {write(a.out, 'economics_out', text, data)}")
    print(text)


def _used_params(opt) -> set:
    import re
    s = str(opt)
    return set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", s))


if __name__ == "__main__":
    main()
