"""Разложение отставания активных групп базового года (план vs оценка) по данным брифа [S-001, стр. 3].
Активные = подключённые на конец года × доля активных. Разложение по Шепли-подобной схеме (среднее двух порядков)."""
import json, pathlib
p = {"plan": {"connected": 7500, "active": 5000}, "estimate": {"connected": 6500, "active": 4000},
     "no_change_next": {"connected": 8000, "active": 5000}, "target_next": {"connected": 12000, "active": 8000}}
r = {k: v["active"] / v["connected"] for k, v in p.items()}
Np, Ne, rp, re_ = p["plan"]["connected"], p["estimate"]["connected"], r["plan"], r["estimate"]
gap = p["plan"]["active"] - p["estimate"]["active"]
# порядок 1: сначала число групп, потом доля; порядок 2 — наоборот; берём среднее
vol = ((Np - Ne) * rp + (Np - Ne) * re_) / 2
rate = ((rp - re_) * Ne + (rp - re_) * Np) / 2
out = {"gap_active": gap, "share_active": {k: round(v, 4) for k, v in r.items()},
       "from_fewer_connected": round(vol), "from_lower_activity_share": round(rate),
       "check_sum": round(vol + rate)}
here = pathlib.Path(__file__).parent
(here / "gap_decomposition_out.json").write_text(json.dumps(out, ensure_ascii=False, indent=2))
md = f"""# Разложение отставания активных групп (базовый год)
Отставание: {gap} активных групп (план 5 000, оценка 4 000).
Доля активных среди подключённых: план {r['plan']:.1%}, оценка {r['estimate']:.1%}; без изменений в след. году {r['no_change_next']:.1%}; цель {r['target_next']:.1%}.
- из-за меньшего числа подключённых групп (6 500 вместо 7 500): ≈ {round(vol)}
- из-за меньшей доли активных: ≈ {round(rate)}
Сумма: {round(vol+rate)}. Схема: среднее двух порядков разложения (единицы — группы, последний месяц года).
"""
(here / "gap_decomposition_out.md").write_text(md); print(md)
