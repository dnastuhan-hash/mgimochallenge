"""Тесты расчётов: сверка с числами брифа и аналитическими ответами."""
import copy
import json
import math
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "calc"))
from common import load, values  # noqa: E402
from economics import boundary, run_option, simulate  # noqa: E402
from forecast import compute as forecast_compute  # noqa: E402
from sample_size import compute, mde_for_n, n_per_arm  # noqa: E402

EX = ROOT / "tools" / "calc" / "example_params.json"


def test_sample_size_brief_example():
    # бриф: снижение доли ограничений 12 % → 9 %; стандартные α=0,05, мощность 0,8
    n = n_per_arm(0.12, 0.09)
    assert 1600 < n < 1700
    r = compute(0.12, 0.09, weekly=100, weeks=6)  # пример брифа: 600 групп за 6 недель
    assert r["recruited_in_window"] == 600 and not r["enough"]


def test_design_effect_and_mde_inverse():
    base = compute(0.12, 0.09)["n_per_arm"]
    clustered = compute(0.12, 0.09, cluster_size=3, icc=0.1)["n_per_arm"]
    assert clustered == math.ceil(n_per_arm(0.12, 0.09) * 1.2)
    assert abs(mde_for_n(0.12, base) - 0.03) < 0.001  # обратная задача возвращает исходный эффект


def test_gap_is_12000_paid_months():
    cfg = load(EX)
    r = run_option(cfg, "alert")
    assert r["months_needed_for_gap"] == pytest.approx(12000)  # (285 − 279) млн ÷ 500 руб.


def test_retention_matches_closed_form():
    v = {"N": 1000, "c": 0.02, "red": 0.5}
    opt = {"streams": [{"type": "retention", "covered_stock": "N", "covered_inflow": 0, "start_month": 1,
                        "churn_base": "c", "churn_reduction": "red"}]}
    sim = simulate(opt, v, rate=500, horizon=12)
    expected = sum(1000 * ((1 - 0.01) ** k - (1 - 0.02) ** k) for k in range(12))
    assert sum(sim["paid_months"][1:13]) == pytest.approx(expected)


def test_last_month_gives_at_most_one_month():
    # бриф: работа, начатая в последнем месяце года, даёт в этом году максимум один доп. месяц на номер
    v = {"n": 100}
    opt = {"streams": [{"type": "new_numbers", "per_month": "n", "start_month": 12, "churn": 0}]}
    sim = simulate(opt, v, rate=500, horizon=24)
    assert sum(sim["paid_months"][1:13]) == 100


def test_brief_example_100_numbers_two_months():
    # бриф: 100 номеров остаются на два оплаченных месяца дольше → 100 000 руб.
    v = {"n": 100, "p": 1, "s": 1, "L": 2}
    opt = {"streams": [{"type": "lapse_prevention", "numbers": "n", "lapse_rate": "p", "prevented_share": "s",
                        "months_saved": "L", "start_month": 11}]}
    sim = simulate(opt, v, rate=500, horizon=24)
    # события в мес. 11 (оба месяца в году: 100×2) и в мес. 12 (в году только 1 месяц: 100×1), мес. 13+ — следующий год
    assert sum(sim["gp"][1:13]) == pytest.approx(100 * 2 * 500 + 100 * 1 * 500)
    assert sim["paid_months"][11] == 100 and sim["paid_months"][12] == 200


def test_scenarios_respect_better_direction():
    cfg = load(EX)
    lo, hi = values(cfg, "low"), values(cfg, "high")
    assert lo["reduction"] == 0.05 and hi["reduction"] == 0.35
    assert lo["sms_cost"] == 3 and hi["sms_cost"] == 1  # затраты: хуже — выше
    assert run_option(cfg, "alert", "low")["net_y1"] < run_option(cfg, "alert", "high")["net_y1"]


def test_boundary_solves_goal():
    cfg = load(EX)
    goal = 1_000_000
    x = boundary(cfg, "alert", "covered", goal)
    assert run_option(cfg, "alert", override={"covered": x})["net_y1"] == pytest.approx(goal, rel=1e-3)


def test_forecast_uses_economics():
    cfg = load(EX)
    gp = forecast_compute(cfg, "base")["gp"]
    assert gp == pytest.approx(279 + run_option(cfg, "alert")["net_y1"] / 1e6)


def test_assumption_without_range_rejected(tmp_path):
    cfg = json.loads(EX.read_text(encoding="utf-8"))
    del cfg["params"]["churn"]["low"]
    f = tmp_path / "p.json"
    f.write_text(json.dumps(cfg), encoding="utf-8")
    with pytest.raises(ValueError, match="диапазон"):
        load(f)
