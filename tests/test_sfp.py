"""Тесты CLI sfp: правила доказательности, пересмотр, анализ влияния, продолжение."""
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SFP = ROOT / "tools" / "sfp.py"
PID = "zz-test-project"


def run(*args, ok=True):
    r = subprocess.run([sys.executable, str(SFP), "-P", PID, *args], capture_output=True, text=True, cwd=ROOT)
    if ok and r.returncode != 0:
        raise AssertionError(f"{args} → {r.returncode}\n{r.stdout}\n{r.stderr}")
    return r


@pytest.fixture(autouse=True)
def project():
    d = ROOT / "projects" / PID
    active = ROOT / "projects" / ".active"
    saved = active.read_text() if active.exists() else None
    shutil.rmtree(d, ignore_errors=True)
    run("init", PID, "--title", "Тест")
    yield d
    shutil.rmtree(d, ignore_errors=True)
    if saved is not None:
        active.write_text(saved)
    elif active.exists():
        active.unlink()


def add_brief(d):
    f = d / "sources" / "brief.md"
    f.write_text("Активных групп 4 000 при плане 5 000.", encoding="utf-8")
    return run("source", "add", "Бриф", "--kind", "brief", "--path", str(f)).stdout.strip()


def test_fact_requires_source():
    r = run("claim", "add", "Рынок 100 тыс.", "--type", "fact", ok=False)
    assert r.returncode != 0 and "без источника" in r.stderr


def test_agent_answer_is_not_a_fact(project):
    f = project / "work" / "note.md"
    f.write_text("вывод агента", encoding="utf-8")
    s = run("source", "add", "Заметка агента", "--kind", "agent", "--path", str(f)).stdout.strip()
    r = run("claim", "add", "Спрос высокий", "--type", "fact", "--sources", s, ok=False)
    assert r.returncode != 0 and "не факт" in r.stderr


def test_synthetic_only_supports_hypothesis(project):
    f = project / "interviews" / "syn1.md"
    f.write_text("СИНТЕТИКА", encoding="utf-8")
    s = run("source", "add", "Модельный респондент 1", "--kind", "synthetic", "--path", str(f)).stdout.strip()
    assert run("claim", "add", "Люди хотят X", "--type", "forecast", "--sources", s, ok=False).returncode != 0
    assert run("claim", "add", "Возможно, люди хотят X", "--type", "hypothesis", "--sources", s,
               "--verify", "интервью").returncode == 0


def test_duplicate_source_not_reregistered(project):
    s1 = add_brief(project)
    r = run("source", "add", "Бриф ещё раз", "--kind", "brief", "--path", str(project / "sources" / "brief.md"))
    assert s1 in r.stdout and "повтор не создан" in r.stdout


def test_impact_and_supersede(project):
    s = add_brief(project)
    c1 = run("claim", "add", "Активных групп 4 000", "--type", "fact", "--sources", s, "--value", "4000").stdout.strip()
    c2 = run("claim", "add", "Отставание 20 %", "--type", "inference", "--depends", c1).stdout.strip()
    run("decision", "add", "Запустить пилот", "--grounds", c2, "--owner", "Руководитель")
    (project / "work" / "04_situation.md").write_text(f"Отставание [{c2}] из-за [{c1}]", encoding="utf-8")
    out = run("impact", c1).stdout
    assert c2 in out and "D-001" in out and "04_situation.md" in out

    out = run("claim", "supersede", c1, "--reason", "новая оценка", "--value", "4200", "--text", "Активных групп 4 200").stdout
    assert "C-003" in out
    chk = run("check", ok=False)
    assert "опирается на" in chk.stdout  # зависимый вывод помечен к пересмотру
    assert "04_situation.md" in chk.stdout  # и документ со ссылкой на устаревшее


def test_check_catches_dangling_reference(project):
    (project / "work" / "x.md").write_text("ссылка на [C-999]", encoding="utf-8")
    r = run("check", ok=False)
    assert r.returncode == 1 and "C-999" in r.stdout


def test_resume_state_persists(project):
    run("stage", "01_framing", "done", "--next", "Собрать материалы")
    st = json.loads((project / "state.json").read_text())
    assert st["stage"] == "02_materials" and st["next_action"] == "Собрать материалы"
    run("stage", "06_choice", "waiting_human", "--note", "выбрать вариант")
    out = run("status").stdout
    assert "ЖДЁМ РЕШЕНИЯ ЧЕЛОВЕКА" in out and "выбрать вариант" in out


def test_search_finds_by_meaning_variant(project):
    add_brief(project)
    (project / "work" / "03_research.md").write_text("## Удержание\nОтток участников семейных групп", encoding="utf-8")
    out = run("search", "семейная группа отток").stdout
    assert "03_research.md" in out
