#!/usr/bin/env python3
"""sfp — «Стратег Фабрики продуктов»: CLI состояния проекта, реестров и проверок.

Без внешних зависимостей (Python 3.11+). Все данные проекта — в projects/<id>/:
  project.json     метаданные и политика источников
  state.json       текущий шаг процесса, следующее действие, открытые вопросы
  sources.jsonl    реестр источников (откуда известно)
  claims.jsonl     реестр утверждений (что известно / предполагается) с типом и связями
  decisions.jsonl  реестр решений, обязательств и условий пересмотра
  log.jsonl        журнал действий агента, вмешательств человека и стоимости

Запуск: python3 tools/sfp.py --help
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import re
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECTS = ROOT / "projects"
ACTIVE_FILE = PROJECTS / ".active"
KNOWLEDGE = ROOT / "knowledge"
PRICING_FILE = ROOT / "tools" / "pricing.json"

STAGES = [
    ("01_framing", "Постановка задачи"),
    ("02_materials", "Сбор материалов"),
    ("03_research", "План и проведение исследования"),
    ("04_situation", "Картина ситуации: известно / откуда / неизвестно"),
    ("05_options", "Варианты и сильные возражения"),
    ("06_choice", "Выбор руководителя"),
    ("07_strategy", "Продуктовая и коммуникационная стратегии"),
    ("08_validation", "План проверки (пилот)"),
    ("09_plan", "План по кварталам, ресурсы, риски"),
    ("10_deliverable", "Итоговый документ"),
    ("11_decisions", "Поддержка решений и пересмотр при новых данных"),
]
STAGE_IDS = [s for s, _ in STAGES]
HUMAN_CHECKPOINTS = {"01_framing", "06_choice", "10_deliverable"}

CLAIM_TYPES = {
    "fact": "факт — подтверждён внешним источником или материалом пользователя",
    "assumption": "допущение — значение, принятое для расчёта до проверки",
    "hypothesis": "гипотеза — проверяемое предположение",
    "forecast": "прогноз — расчёт на будущее (желателен диапазон)",
    "inference": "вывод — заключение агента из других утверждений",
    "synthetic": "синтетика — ответ модельного респондента, не доказательство",
}
SOURCE_KINDS = {
    "brief": "бриф / постановка задачи от заказчика",
    "user_doc": "документ пользователя",
    "table": "таблица / данные",
    "web": "открытая веб-страница",
    "interview": "реальное интервью (с согласия, без ПДн)",
    "media": "изображение / аудио / видео",
    "calc": "воспроизводимый расчёт (скрипт в репозитории)",
    "synthetic": "модельный респондент (ИИ)",
    "agent": "текст, написанный агентом",
    "human": "решение или ответ руководителя в чате",
}
# Источники, которые НЕ могут подтверждать факт
NON_FACT_SOURCES = {"synthetic", "agent"}
STATUSES = {"active", "superseded", "retracted"}
REF_RE = re.compile(r"\b([CSD])-(\d{3,})\b")


# ----------------------------------------------------------------- utils
def now() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def today() -> str:
    return dt.date.today().isoformat()


def die(msg: str, code: int = 1):
    print(f"ошибка: {msg}", file=sys.stderr)
    sys.exit(code)


def read_json(p: Path, default=None):
    if not p.exists():
        return default
    return json.loads(p.read_text(encoding="utf-8"))


def write_json(p: Path, data):
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(p)  # атомарная запись: сбой не оставит полуфайл


def read_jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    out = []
    for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError as e:
            die(f"{p.name}:{i}: повреждённая строка JSONL ({e})")
    return out


def write_jsonl(p: Path, rows: list[dict]):
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    tmp.replace(p)


def append_jsonl(p: Path, row: dict):
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def next_id(rows: list[dict], prefix: str) -> str:
    n = 0
    for r in rows:
        m = re.match(rf"{prefix}-(\d+)$", r.get("id", ""))
        if m:
            n = max(n, int(m.group(1)))
    return f"{prefix}-{n + 1:03d}"


def split_list(v) -> list[str]:
    if not v:
        return []
    if isinstance(v, list):
        return v
    return [x.strip() for x in re.split(r"[,\s]+", v) if x.strip()]


# ----------------------------------------------------------------- project
class Project:
    def __init__(self, pid: str):
        self.id = pid
        self.dir = PROJECTS / pid
        if not self.dir.exists():
            die(f"проект «{pid}» не найден в {PROJECTS}")

    # пути
    def p(self, name: str) -> Path:
        return self.dir / name

    @property
    def meta(self):
        return read_json(self.p("project.json"), {})

    @property
    def state(self):
        return read_json(self.p("state.json"), {})

    def save_state(self, st):
        st["updated"] = now()
        write_json(self.p("state.json"), st)

    def sources(self):
        return read_jsonl(self.p("sources.jsonl"))

    def claims(self):
        return read_jsonl(self.p("claims.jsonl"))

    def decisions(self):
        return read_jsonl(self.p("decisions.jsonl"))

    def log(self, kind: str, summary: str, **extra):
        row = {"ts": now(), "kind": kind, "stage": self.state.get("stage"), "summary": summary}
        row.update({k: v for k, v in extra.items() if v not in (None, "")})
        append_jsonl(self.p("log.jsonl"), row)


def active_project(explicit: str | None = None) -> Project:
    pid = explicit or os.environ.get("SFP_PROJECT")
    if not pid and ACTIVE_FILE.exists():
        pid = ACTIVE_FILE.read_text(encoding="utf-8").strip()
    if not pid:
        die("нет активного проекта: выполните `sfp init <id>` или `sfp use <id>`")
    return Project(pid)


# ----------------------------------------------------------------- commands
def cmd_init(a):
    pid = a.id
    if not re.fullmatch(r"[a-z0-9][a-z0-9\-]{1,60}", pid):
        die("id проекта: латиница в нижнем регистре, цифры и дефис")
    d = PROJECTS / pid
    if d.exists():
        die(f"проект «{pid}» уже существует")
    for sub in ("sources", "work", "deliverables", "calc", "interviews"):
        (d / sub).mkdir(parents=True)
    write_json(d / "project.json", {
        "id": pid,
        "title": a.title or pid,
        "created": now(),
        "owner": a.owner or "",
        "source_policy": {
            "mode": "allowlist",  # allowlist | open
            "allowed_domains": [],
            "denied_domains": [],
            "note": "Веб-источники подтягиваются только после обоснования необходимости и согласия пользователя.",
        },
    })
    write_json(d / "state.json", {
        "stage": STAGE_IDS[0],
        "stages": {s: "todo" for s in STAGE_IDS},
        "next_action": "Провести постановку задачи (skill: framing): вопрос, цель, получатель, ограничения, данные.",
        "open_questions": [],
        "blocked_on_human": None,
        "updated": now(),
    })
    for f in ("sources.jsonl", "claims.jsonl", "decisions.jsonl", "log.jsonl"):
        (d / f).touch()
    ACTIVE_FILE.write_text(pid + "\n", encoding="utf-8")
    Project(pid).log("action", f"Создан проект «{a.title or pid}»")
    print(f"Создан проект {pid} → {d.relative_to(ROOT)} (активный)")


def cmd_use(a):
    Project(a.id)
    ACTIVE_FILE.write_text(a.id + "\n", encoding="utf-8")
    print(f"Активный проект: {a.id}")


def cmd_list(a):
    cur = ACTIVE_FILE.read_text().strip() if ACTIVE_FILE.exists() else ""
    for d in sorted(PROJECTS.iterdir()):
        if d.is_dir() and (d / "project.json").exists():
            m = read_json(d / "project.json", {})
            st = read_json(d / "state.json", {})
            mark = "*" if d.name == cur else " "
            print(f"{mark} {d.name:28} {st.get('stage', '?'):16} {m.get('title', '')}")


def stage_title(sid):
    return dict(STAGES).get(sid, sid)


def cmd_status(a):
    pr = active_project(a.project)
    st, meta = pr.state, pr.meta
    claims, sources, decs = pr.claims(), pr.sources(), pr.decisions()
    marks = {"todo": "·", "in_progress": "▶", "done": "✓", "waiting_human": "⏸", "skipped": "–", "revisit": "↺"}
    print(f"Проект: {meta.get('title')}  [{pr.id}]")
    print(f"Обновлено: {st.get('updated', '?')}")
    print()
    for sid, title in STAGES:
        s = st.get("stages", {}).get(sid, "todo")
        cur = "  ← текущий" if sid == st.get("stage") else ""
        human = " (человек)" if sid in HUMAN_CHECKPOINTS else ""
        print(f"  {marks.get(s, '?')} {sid:15} {title}{human}{cur}")
    print()
    by_type = Counter(c["type"] for c in claims if c.get("status") == "active")
    print(f"Источники: {len(sources)}   Утверждения (активные): {sum(by_type.values())} "
          f"({', '.join(f'{k}:{v}' for k, v in sorted(by_type.items())) or '—'})   Решения: {len(decs)}")
    if st.get("blocked_on_human"):
        print(f"\n⏸ ЖДЁМ РЕШЕНИЯ ЧЕЛОВЕКА: {st['blocked_on_human']}")
    print(f"\nСледующее действие: {st.get('next_action', '—')}")
    oq = st.get("open_questions") or []
    if oq:
        print("Открытые вопросы:")
        for q in oq:
            print(f"  - {q}")
    due = [d for d in decs if d.get("review_by") and d["review_by"] <= today() and d.get("status") != "closed"]
    if due:
        print("\nПора пересмотреть решения: " + ", ".join(f"{d['id']} ({d['review_by']})" for d in due))
    tail = read_jsonl(pr.p("log.jsonl"))[-a.tail:] if a.tail else []
    if tail:
        print(f"\nПоследние записи журнала:")
        for r in tail:
            print(f"  {r['ts'][:16]} [{r['kind']}] {r['summary']}")


def cmd_stage(a):
    pr = active_project(a.project)
    st = pr.state
    if a.id not in STAGE_IDS:
        die(f"неизвестный шаг {a.id}; допустимы: {', '.join(STAGE_IDS)}")
    st.setdefault("stages", {})[a.id] = a.status
    if a.status in ("in_progress", "waiting_human", "revisit"):
        st["stage"] = a.id
    if a.status == "done" and st.get("stage") == a.id:
        i = STAGE_IDS.index(a.id)
        if i + 1 < len(STAGE_IDS):
            st["stage"] = STAGE_IDS[i + 1]
    if a.status == "waiting_human":
        st["blocked_on_human"] = a.note or "требуется выбор руководителя"
    elif st.get("blocked_on_human") and a.status in ("done", "in_progress"):
        st["blocked_on_human"] = None
    if a.next:
        st["next_action"] = a.next
    pr.save_state(st)
    pr.log("stage", f"{a.id} → {a.status}" + (f": {a.note}" if a.note else ""))
    print(f"{a.id}: {a.status}; текущий шаг: {st['stage']}")


def cmd_next(a):
    pr = active_project(a.project)
    st = pr.state
    st["next_action"] = a.text
    pr.save_state(st)
    print("Следующее действие записано.")


def cmd_question(a):
    pr = active_project(a.project)
    st = pr.state
    qs = st.setdefault("open_questions", [])
    if a.close:
        before = len(qs)
        st["open_questions"] = [q for q in qs if a.text not in q]
        print(f"Закрыто вопросов: {before - len(st['open_questions'])}")
    else:
        qs.append(a.text)
        print("Вопрос добавлен.")
    pr.save_state(st)


# --- sources
def cmd_source_add(a):
    pr = active_project(a.project)
    rows = pr.sources()
    if a.kind not in SOURCE_KINDS:
        die(f"kind ∈ {', '.join(SOURCE_KINDS)}")
    sha = None
    path = a.path
    if path:
        fp = (ROOT / path) if not Path(path).is_absolute() else Path(path)
        if not fp.exists():
            die(f"файл не найден: {path}")
        sha = hashlib.sha256(fp.read_bytes()).hexdigest()[:16]
        path = str(fp.resolve().relative_to(ROOT)) if fp.resolve().is_relative_to(ROOT) else str(fp)
        dup = [r for r in rows if r.get("sha256") == sha]
        if dup:
            print(f"Уже зарегистрирован как {dup[0]['id']} (тот же хэш) — повтор не создан.")
            return
    if a.url:
        dup = [r for r in rows if r.get("url") == a.url]
        if dup and not a.force:
            print(f"URL уже зарегистрирован как {dup[0]['id']} — повтор не создан (--force для новой версии).")
            return
    row = {
        "id": next_id(rows, "S"), "title": a.title, "kind": a.kind,
        "path": path, "url": a.url, "sha256": sha,
        "retrieved": a.retrieved or today(), "added": now(),
        "reliability": a.reliability, "note": a.note,
    }
    row = {k: v for k, v in row.items() if v not in (None, "")}
    append_jsonl(pr.p("sources.jsonl"), row)
    pr.log("source", f"{row['id']} {a.title}")
    print(row["id"])


def cmd_source_refresh(a):
    """Файл источника изменился (пересчёт, новая версия): зафиксировать новый хэш и показать, что затронуто."""
    pr = active_project(a.project)
    rows = pr.sources()
    for r in rows:
        if r["id"] == a.id:
            if not r.get("path"):
                die(f"{a.id}: у источника нет файла")
            new = hashlib.sha256((ROOT / r["path"]).read_bytes()).hexdigest()[:16]
            if new == r.get("sha256"):
                print(f"{a.id}: файл не менялся")
                return
            r.setdefault("versions", []).append({"sha256": r.get("sha256"), "until": now()})
            r["sha256"], r["updated"] = new, now()
            write_jsonl(pr.p("sources.jsonl"), rows)
            pr.log("revision", f"{a.id}: новая версия файла — {a.reason}")
            print(f"{a.id}: зафиксирована новая версия. Проверьте зависимые утверждения:")
            impact_report(pr, a.id)
            return
    die(f"{a.id} не найден")


def cmd_source_list(a):
    pr = active_project(a.project)
    for s in pr.sources():
        loc = s.get("url") or s.get("path") or ""
        print(f"{s['id']}  [{s['kind']:9}] {s['title']}  {loc}")


# --- claims
def cmd_claim_add(a):
    pr = active_project(a.project)
    rows = pr.claims()
    if a.type not in CLAIM_TYPES:
        die(f"type ∈ {', '.join(CLAIM_TYPES)}")
    row = {
        "id": next_id(rows, "C"), "text": a.text, "type": a.type,
        "sources": split_list(a.sources), "depends_on": split_list(a.depends),
        "value": a.value, "low": a.low, "high": a.high, "unit": a.unit, "period": a.period,
        "confidence": a.confidence, "verify": a.verify, "tags": split_list(a.tags),
        "status": "active", "created": now(),
    }
    row = {k: v for k, v in row.items() if v not in (None, "", [])}
    problems = validate_claim(row, {s["id"]: s for s in pr.sources()}, {c["id"]: c for c in rows})
    errs = [m for lvl, m in problems if lvl == "error"]
    if errs and not a.force:
        die("утверждение не записано:\n  " + "\n  ".join(errs))
    append_jsonl(pr.p("claims.jsonl"), row)
    pr.log("claim", f"{row['id']} [{a.type}] {a.text[:90]}")
    for lvl, m in problems:
        print(f"{lvl}: {m}", file=sys.stderr)
    print(row["id"])


def cmd_claim_list(a):
    pr = active_project(a.project)
    for c in pr.claims():
        if a.type and c["type"] != a.type:
            continue
        if not a.all and c.get("status") != "active":
            continue
        if a.tag and a.tag not in c.get("tags", []):
            continue
        rng = ""
        if "value" in c or "low" in c:
            rng = f"  = {c.get('value', '')}" + (f" [{c.get('low')}…{c.get('high')}]" if "low" in c else "") + f" {c.get('unit', '')}"
        st = "" if c.get("status") == "active" else f" ({c['status']})"
        src = ",".join(c.get("sources", [])) or "—"
        dep = ",".join(c.get("depends_on", []))
        print(f"{c['id']} [{c['type']:10}] {c['text']}{rng}  ⟵ {src}{(' ⇠ ' + dep) if dep else ''}{st}")


def _set_claim_status(a, status):
    pr = active_project(a.project)
    rows = pr.claims()
    hit = [r for r in rows if r["id"] == a.id]
    if not hit:
        die(f"{a.id} не найдено")
    c = hit[0]
    c["status"] = status
    c["status_reason"] = a.reason
    c["updated"] = now()
    new_id = None
    if status == "superseded":
        new = {k: v for k, v in c.items() if k not in ("id", "status", "status_reason", "updated", "created", "superseded_by")}
        new.update({"id": next_id(rows, "C"), "status": "active", "created": now(), "supersedes": c["id"]})
        if a.text:
            new["text"] = a.text
        for fld in ("value", "low", "high", "type"):
            v = getattr(a, fld, None)
            if v not in (None, ""):
                new[fld] = v
        if a.sources:
            new["sources"] = split_list(a.sources)
        if getattr(a, "depends", None):
            new["depends_on"] = split_list(a.depends)
        c["superseded_by"] = new["id"]
        rows.append(new)
        new_id = new["id"]
    write_jsonl(pr.p("claims.jsonl"), rows)
    pr.log("revision", f"{a.id} → {status}" + (f" (новое {new_id})" if new_id else "") + f": {a.reason}")
    print(f"{a.id}: {status}" + (f" → {new_id}" if new_id else ""))
    print("\nЗатронуто:")
    impact_report(pr, a.id)


def cmd_claim_retract(a):
    _set_claim_status(a, "retracted")


def cmd_claim_supersede(a):
    _set_claim_status(a, "superseded")


def validate_claim(c, sources: dict, claims: dict) -> list[tuple[str, str]]:
    out = []
    cid, t = c.get("id", "?"), c.get("type")
    src_ids = c.get("sources", [])
    for s in src_ids:
        if s not in sources:
            out.append(("error", f"{cid}: источник {s} не зарегистрирован"))
    for d in c.get("depends_on", []):
        if d not in claims and d != cid:
            out.append(("error", f"{cid}: зависимость {d} не найдена"))
    kinds = {sources[s]["kind"] for s in src_ids if s in sources}
    if t == "fact":
        if not src_ids:
            out.append(("error", f"{cid}: факт без источника"))
        elif kinds and kinds <= NON_FACT_SOURCES:
            out.append(("error", f"{cid}: факт опирается только на ответ агента/синтетику — это не факт"))
    if "synthetic" in kinds and t not in ("hypothesis", "synthetic"):
        out.append(("error", f"{cid}: синтетические ответы могут поддерживать только гипотезу/синтетику, не «{t}»"))
    if t == "inference" and not (c.get("depends_on") or src_ids):
        out.append(("error", f"{cid}: вывод без оснований (depends_on/sources)"))
    if t == "assumption" and not c.get("verify"):
        out.append(("warn", f"{cid}: допущение без способа проверки (--verify)"))
    if t == "forecast" and "low" not in c:
        out.append(("warn", f"{cid}: прогноз без диапазона (--low/--high)"))
    if t == "hypothesis" and not c.get("verify"):
        out.append(("warn", f"{cid}: гипотеза без наблюдения, которое её опровергнет (--verify)"))
    return out


# --- graph / impact
def build_dependents(pr: Project):
    """Обратный граф: кто зависит от X (утверждения, решения, файлы)."""
    rev = defaultdict(set)
    for c in pr.claims():
        for d in c.get("depends_on", []):
            rev[d].add(c["id"])
        for s in c.get("sources", []):
            rev[s].add(c["id"])
    for d in pr.decisions():
        for g in d.get("grounds", []):
            rev[g].add(d["id"])
    files = defaultdict(set)
    for f in list(pr.dir.glob("work/**/*.md")) + list(pr.dir.glob("deliverables/**/*.md")):
        txt = f.read_text(encoding="utf-8")
        for m in REF_RE.finditer(txt):
            files[m.group(0)].add(str(f.relative_to(pr.dir)))
    return rev, files


def impact_closure(pr: Project, start: str):
    rev, files = build_dependents(pr)
    seen, order, stack = {start}, [], [start]
    while stack:
        x = stack.pop()
        for y in sorted(rev.get(x, ())):
            if y not in seen:
                seen.add(y)
                order.append(y)
                stack.append(y)
    affected_files = defaultdict(set)
    for x in [start] + order:
        for f in files.get(x, ()):
            affected_files[f].add(x)
    return order, affected_files


def impact_report(pr: Project, start: str):
    order, affected_files = impact_closure(pr, start)
    claims = {c["id"]: c for c in pr.claims()}
    decs = {d["id"]: d for d in pr.decisions()}
    if not order and not affected_files:
        print("  ничего не зависит от", start)
        return
    for x in order:
        if x in claims:
            st = claims[x].get("status", "active")
            if st != "active" and not getattr(impact_report, "show_all", False):
                continue  # заменённые/отозванные уже не действуют — не шумим
            mark = "" if st == "active" else f" ({st})"
            print(f"  утверждение {x} [{claims[x]['type']}]{mark} {claims[x]['text'][:100]}")
        elif x in decs:
            print(f"  РЕШЕНИЕ {x}: {decs[x]['title']} (ответственный: {decs[x].get('owner', '?')})")
    for f, ids in sorted(affected_files.items()):
        print(f"  файл {f}  (ссылки: {', '.join(sorted(ids))})")


def cmd_impact(a):
    pr = active_project(a.project)
    print(f"Что затронет изменение {a.id}:")
    impact_report(pr, a.id)


# --- decisions
def cmd_decision_add(a):
    pr = active_project(a.project)
    rows = pr.decisions()
    row = {
        "id": next_id(rows, "D"), "title": a.title, "choice": a.choice,
        "owner": a.owner, "decided_by": a.decided_by, "date": a.date or today(),
        "grounds": split_list(a.grounds), "metrics": a.metric or [],
        "review_by": a.review_by, "review_triggers": a.trigger or [],
        "commitments": [], "status": a.status, "created": now(),
    }
    row = {k: v for k, v in row.items() if v not in (None, "")}
    claims = {c["id"] for c in pr.claims()}
    missing = [g for g in row.get("grounds", []) if g not in claims]
    if missing:
        die(f"основания не найдены в реестре утверждений: {', '.join(missing)}")
    append_jsonl(pr.p("decisions.jsonl"), row)
    pr.log("decision", f"{row['id']} {a.title} — {a.status}")
    print(row["id"])


def cmd_decision_commit(a):
    pr = active_project(a.project)
    rows = pr.decisions()
    for d in rows:
        if d["id"] == a.id:
            d.setdefault("commitments", []).append(
                {"what": a.what, "owner": a.owner, "due": a.due, "status": "open", "added": now()})
            write_jsonl(pr.p("decisions.jsonl"), rows)
            pr.log("commitment", f"{a.id}: {a.what} → {a.owner} до {a.due}")
            print("Обязательство добавлено.")
            return
    die(f"{a.id} не найдено")


def cmd_decision_set(a):
    pr = active_project(a.project)
    rows = pr.decisions()
    for d in rows:
        if d["id"] == a.id:
            if a.status:
                d["status"] = a.status
            if a.commitment is not None:
                d["commitments"][a.commitment]["status"] = a.commitment_status or "done"
            d["updated"] = now()
            write_jsonl(pr.p("decisions.jsonl"), rows)
            pr.log("decision", f"{a.id} обновлено: {a.status or ''} {a.note or ''}".strip())
            print("Обновлено.")
            return
    die(f"{a.id} не найдено")


def cmd_decision_list(a):
    pr = active_project(a.project)
    claims = {c["id"]: c for c in pr.claims()}
    for d in pr.decisions():
        print(f"{d['id']} [{d.get('status')}] {d['title']}")
        if d.get("choice"):
            print(f"    выбор: {d['choice']}")
        print(f"    ответственный: {d.get('owner', '—')}; пересмотр до: {d.get('review_by', '—')}")
        for g in d.get("grounds", []):
            c = claims.get(g)
            flag = "" if c and c.get("status") == "active" else "  ⚠ ОСНОВАНИЕ УСТАРЕЛО" if c else "  ⚠ нет в реестре"
            print(f"    основание {g}: {(c or {}).get('text', '?')[:90]}{flag}")
        for m in d.get("metrics", []):
            print(f"    показатель: {m}")
        for t in d.get("review_triggers", []):
            print(f"    пересмотреть, если: {t}")
        for i, cm in enumerate(d.get("commitments", [])):
            print(f"    [{i}] {cm['status']:5} {cm['what']} — {cm.get('owner')} до {cm.get('due')}")


# --- check
def cmd_check(a):
    pr = active_project(a.project)
    sources = {s["id"]: s for s in pr.sources()}
    claims_l = pr.claims()
    claims = {c["id"]: c for c in claims_l}
    decs = pr.decisions()
    problems: list[tuple[str, str]] = []

    ids = Counter(c["id"] for c in claims_l)
    problems += [("error", f"дублирующийся id {i}") for i, n in ids.items() if n > 1]
    for c in claims_l:
        if c.get("type") not in CLAIM_TYPES:
            problems.append(("error", f"{c['id']}: неизвестный тип {c.get('type')}"))
        if c.get("status") != "active":
            continue
        problems += validate_claim(c, sources, claims)
        for d in c.get("depends_on", []):
            if d in claims and claims[d].get("status") != "active":
                problems.append(("warn", f"{c['id']}: опирается на {d}, которое {claims[d]['status']} — пересмотреть"))
    # циклы
    def has_cycle(start):
        stack, seen = [(start, iter(claims.get(start, {}).get("depends_on", [])))], {start}
        while stack:
            node, it = stack[-1]
            nxt = next(it, None)
            if nxt is None:
                stack.pop()
                continue
            if nxt == start:
                return True
            if nxt in claims and nxt not in seen:
                seen.add(nxt)
                stack.append((nxt, iter(claims[nxt].get("depends_on", []))))
        return False
    for cid in claims:
        if has_cycle(cid):
            problems.append(("error", f"{cid}: циклическая зависимость"))
    # решения
    for d in decs:
        for g in d.get("grounds", []):
            if g not in claims:
                problems.append(("error", f"{d['id']}: основание {g} не найдено"))
            elif claims[g].get("status") != "active":
                problems.append(("warn", f"{d['id']}: основание {g} {claims[g]['status']} — решение требует пересмотра"))
        if d.get("review_by") and d["review_by"] <= today() and d.get("status") not in ("closed",):
            problems.append(("warn", f"{d['id']}: наступил срок пересмотра {d['review_by']}"))
        for cm in d.get("commitments", []):
            if cm.get("status") == "open" and cm.get("due") and cm["due"] < today():
                problems.append(("warn", f"{d['id']}: просрочено обязательство «{cm['what']}» ({cm.get('owner')})"))
    # ссылки в документах
    for f in list(pr.dir.glob("work/**/*.md")) + list(pr.dir.glob("deliverables/**/*.md")):
        rel = f.relative_to(pr.dir)
        txt = f.read_text(encoding="utf-8")
        for m in REF_RE.finditer(txt):
            ref = m.group(0)
            if ref.startswith("C-"):
                if ref not in claims:
                    problems.append(("error", f"{rel}: ссылка на несуществующее {ref}"))
                elif claims[ref].get("status") != "active":
                    problems.append(("warn", f"{rel}: ссылка на {ref} ({claims[ref]['status']}) — обновить текст"))
            elif ref.startswith("S-") and ref not in sources:
                problems.append(("error", f"{rel}: ссылка на несуществующий источник {ref}"))
            elif ref.startswith("D-") and ref not in {d["id"] for d in decs}:
                problems.append(("error", f"{rel}: ссылка на несуществующее решение {ref}"))
    # файлы источников
    for s in sources.values():
        if s.get("path") and not (ROOT / s["path"]).exists():
            problems.append(("error", f"{s['id']}: файл источника отсутствует: {s['path']}"))
        elif s.get("path") and s.get("sha256"):
            h = hashlib.sha256((ROOT / s["path"]).read_bytes()).hexdigest()[:16]
            if h != s["sha256"]:
                problems.append(("warn", f"{s['id']}: файл источника изменился после регистрации — проверить выводы (sfp impact {s['id']})"))

    errs = [m for l, m in problems if l == "error"]
    warns = [m for l, m in problems if l == "warn"]
    for m in errs:
        print(f"ОШИБКА  {m}")
    for m in warns:
        if not a.quiet:
            print(f"внимание {m}")
    print(f"\nПроверка: {len(errs)} ошибок, {len(warns)} предупреждений; "
          f"утверждений {len(claims_l)}, источников {len(sources)}, решений {len(decs)}")
    sys.exit(1 if errs else 0)


# --- log & cost
def load_pricing():
    return read_json(PRICING_FILE, {"models": {}})


def estimate_cost(model, tin, tout):
    pr = load_pricing().get("models", {}).get(model or "", None)
    if not pr or tin is None:
        return None
    return round((tin * pr["input_per_mtok"] + (tout or 0) * pr["output_per_mtok"]) / 1e6, 4)


def cmd_log(a):
    pr = active_project(a.project)
    cost = a.cost_usd
    if cost is None:
        cost = estimate_cost(a.model, a.tokens_in, a.tokens_out)
    pr.log(a.kind, a.summary, model=a.model, tokens_in=a.tokens_in, tokens_out=a.tokens_out,
           cost_usd=cost, minutes=a.minutes, tool=a.tool)
    print("Записано в журнал.")


def cmd_cost(a):
    pr = active_project(a.project)
    rows = read_jsonl(pr.p("log.jsonl"))
    by_stage = defaultdict(lambda: {"usd": 0.0, "tin": 0, "tout": 0, "min": 0.0, "tools": 0, "human": 0})
    for r in rows:
        b = by_stage[r.get("stage") or "—"]
        b["usd"] += r.get("cost_usd") or 0
        b["tin"] += r.get("tokens_in") or 0
        b["tout"] += r.get("tokens_out") or 0
        b["min"] += r.get("minutes") or 0
        b["tools"] += 1 if r.get("kind") == "tool" else 0
        b["human"] += 1 if r.get("kind") == "human" else 0
    print(f"{'шаг':16} {'$':>8} {'вход ток.':>10} {'выход ток.':>10} {'мин':>6} {'инстр.':>7} {'человек':>8}")
    tot = defaultdict(float)
    for sid in STAGE_IDS + ["—"]:
        if sid not in by_stage:
            continue
        b = by_stage[sid]
        print(f"{sid:16} {b['usd']:8.2f} {b['tin']:10} {b['tout']:10} {b['min']:6.0f} {b['tools']:7} {b['human']:8}")
        for k, v in b.items():
            tot[k] += v
    print(f"{'ИТОГО':16} {tot['usd']:8.2f} {int(tot['tin']):10} {int(tot['tout']):10} {tot['min']:6.0f} "
          f"{int(tot['tools']):7} {int(tot['human']):8}")
    print("\nСтоимость — по записям журнала (точные токены сессии: /cost в Claude Code).")


def cmd_history(a):
    pr = active_project(a.project)
    rows = read_jsonl(pr.p("log.jsonl"))
    if a.kind:
        rows = [r for r in rows if r.get("kind") == a.kind]
    for r in rows[-a.n:]:
        extra = f" ({r['tool']})" if r.get("tool") else ""
        print(f"{r['ts'][:19]} {r.get('stage') or '—':15} [{r['kind']}]{extra} {r['summary']}")


# --- search (формулировка + смысл через символьные n-граммы + связи)
def _chunks():
    """Фрагменты для поиска: разделы md из knowledge/ и активного проекта, утверждения, источники."""
    out = []
    files = sorted(KNOWLEDGE.glob("**/*.md"))
    pr = None
    try:
        pr = active_project(None)
    except SystemExit:
        pr = None
    if pr:
        files += sorted(pr.dir.glob("work/**/*.md")) + sorted(pr.dir.glob("deliverables/**/*.md"))
        files += sorted(pr.dir.glob("sources/**/*.md")) + sorted(pr.dir.glob("interviews/**/*.md"))
    for f in files:
        rel = str(f.relative_to(ROOT))
        txt = f.read_text(encoding="utf-8")
        parts = re.split(r"(?m)^(#{1,3} .+)$", txt)
        head = rel
        buf = parts[0]
        if buf.strip():
            out.append((rel, head, buf))
        for i in range(1, len(parts), 2):
            head = parts[i].lstrip("# ").strip()
            out.append((rel, head, parts[i] + "\n" + (parts[i + 1] if i + 1 < len(parts) else "")))
    if pr:
        for c in pr.claims():
            tag = "" if c.get("status") == "active" else f" [{c['status'].upper()}]"
            out.append((f"claims:{c['id']}", f"{c['id']} [{c['type']}]{tag}", c["text"] + " " + " ".join(c.get("tags", []))))
        for s in pr.sources():
            out.append((f"sources:{s['id']}", f"{s['id']} [{s['kind']}]", s["title"] + " " + s.get("note", "")))
    return out


def _norm(t):
    return re.sub(r"[^\w\s]", " ", t.lower().replace("ё", "е"))


def _grams(t, n_min=3, n_max=5):
    g = Counter()
    for w in _norm(t).split():
        w = f" {w} "
        for n in range(n_min, n_max + 1):
            for i in range(len(w) - n + 1):
                g[w[i:i + n]] += 1
    return g


def search(query: str, k: int = 8):
    chunks = _chunks()
    docs = [_grams(c[1] + " " + c[2]) for c in chunks]
    df = Counter()
    for d in docs:
        df.update(d.keys())
    N = len(docs) or 1
    idf = {g: math.log((N + 1) / (n + 1)) + 1 for g, n in df.items()}
    q = _grams(query)
    qv = {g: v * idf.get(g, 0) for g, v in q.items()}
    qn = math.sqrt(sum(v * v for v in qv.values())) or 1
    words = set(_norm(query).split())
    res = []
    for (loc, head, body), d in zip(chunks, docs):
        dv = {g: v * idf[g] for g, v in d.items()}
        dn = math.sqrt(sum(v * v for v in dv.values())) or 1
        score = sum(qv[g] * dv.get(g, 0) for g in qv) / (qn * dn)
        exact = sum(1 for w in words if w in _norm(body))  # точная формулировка — бонус
        score += 0.05 * exact
        res.append((score, loc, head, body))
    res.sort(key=lambda x: -x[0])
    return res[:k]


def cmd_search(a):
    for score, loc, head, body in search(a.query, a.k):
        snippet = re.sub(r"\s+", " ", body).strip()[:220]
        print(f"{score:.3f}  {loc} › {head}\n       {snippet}")
        refs = sorted(set(m.group(0) for m in REF_RE.finditer(body)))
        if refs:
            print(f"       связи: {', '.join(refs[:12])}")


# --- routing
ROUTING_FILE = ROOT / "tools" / "routing.json"


def route(task: str) -> dict:
    cfg = read_json(ROUTING_FILE, {})
    t = _norm(task)
    best, best_hits = None, 0
    for r in cfg.get("routes", []):
        matched = [k for k in r["keywords"] if k in t]
        hits = len(matched) + sum(len(k) for k in matched) / 100  # при равенстве — более конкретное совпадение
        if hits > best_hits:
            best, best_hits = r, hits
    res = dict(best or cfg.get("default", {}))
    n = int(best_hits)
    res["matched_keywords"] = n
    res["confidence"] = "high" if n >= 2 else "low" if n == 1 else "none"
    return res


def cmd_route(a):
    cfg = read_json(ROUTING_FILE, {})
    if a.escalate:
        order = cfg.get("escalation", ["haiku", "sonnet", "opus"])
        cur = a.escalate
        nxt = order[order.index(cur) + 1] if cur in order and order.index(cur) + 1 < len(order) else None
        if nxt:
            print(f"Эскалация: {cur} → {nxt}. Повторите шаг с моделью {nxt} и запишите: "
                  f"sfp log \"эскалация {cur}→{nxt}: <причина>\" --kind note")
        else:
            print(f"{cur} — верхняя ступень; нужен человек: уточнить задачу или данные.")
        return
    r = route(a.task)
    print(f"Процесс (навык): {r.get('skill')}\nИсполнитель: {r.get('agent')}\nМодель: {r.get('model')}\n"
          f"Почему: {r.get('why')}\nУверенность маршрута: {r['confidence']}")
    if r["confidence"] != "high":
        print("Маршрут неочевиден — главный агент выбирает сам и записывает выбор в журнал.")
    print(f"Порог качества evaluator: {cfg.get('quality_threshold')}; ниже — `sfp route --escalate {r.get('model')}`")



# ----------------------------------------------------------------- export
def _md_inline(t: str, refs: dict) -> str:
    import html as _h
    codes: list[str] = []
    t = re.sub(r"`([^`]+)`", lambda m: codes.append(m.group(1)) or f"\x00{len(codes)-1}\x00", t)
    t = _h.escape(t, quote=False)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)", r"<em>\1</em>", t)
    t = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", r'<a href="\2">\1</a>', t)

    def ref(m):
        rid = m.group(0)
        tip = refs.get(rid)
        return f'<span class="ref" title="{_h.escape(tip)}">{rid}</span>' if tip else rid
    t = re.sub(r"\b[CSD]-\d{3}\b", ref, t)
    return re.sub("\x00(\\d+)\x00", lambda m: f"<code>{_h.escape(codes[int(m.group(1))])}</code>", t)


def md_to_html(md: str, refs: dict | None = None) -> str:
    """Минимальный Markdown → HTML (заголовки, абзацы, списки, таблицы, цитаты, код, hr) без зависимостей."""
    import html as _h
    refs = refs or {}
    out: list[str] = []
    lines = md.splitlines()
    i = 0
    para: list[str] = []

    def flush():
        if para:
            out.append("<p>" + _md_inline(" ".join(x.strip() for x in para), refs) + "</p>")
            para.clear()
    while i < len(lines):
        ln = lines[i]
        st = ln.strip()
        if st.startswith("```"):
            flush(); j = i + 1; buf = []
            while j < len(lines) and not lines[j].strip().startswith("```"):
                buf.append(lines[j]); j += 1
            out.append("<pre><code>" + _h.escape("\n".join(buf)) + "</code></pre>"); i = j + 1; continue
        if not st:
            flush(); i += 1; continue
        if re.fullmatch(r"-{3,}|\*{3,}", st):
            flush(); out.append("<hr>"); i += 1; continue
        m = re.match(r"(#{1,6})\s+(.*)", st)
        if m:
            flush(); n = len(m.group(1)); out.append(f"<h{n}>{_md_inline(m.group(2), refs)}</h{n}>"); i += 1; continue
        if st.startswith("|") and i + 1 < len(lines) and re.fullmatch(r"\|?\s*:?-{2,}.*", lines[i + 1].strip()):
            flush()
            cells = lambda r: [c.strip() for c in r.strip().strip("|").split("|")]
            head = cells(ln); i += 2; rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(cells(lines[i])); i += 1
            h = "".join(f"<th>{_md_inline(c, refs)}</th>" for c in head)
            b = "".join("<tr>" + "".join(f"<td>{_md_inline(c, refs)}</td>" for c in r) + "</tr>" for r in rows)
            out.append(f'<div class="tw"><table><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table></div>'); continue
        if st.startswith(">"):
            flush(); buf = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                buf.append(lines[i].strip()[1:].strip()); i += 1
            out.append("<blockquote>" + _md_inline(" ".join(buf), refs) + "</blockquote>"); continue
        m = re.match(r"(\s*)([-*]|\d+\.)\s+(.*)", ln)
        if m:
            flush(); tag = "ol" if m.group(2)[0].isdigit() else "ul"; items = []
            while i < len(lines):
                mm = re.match(r"(\s*)([-*]|\d+\.)\s+(.*)", lines[i])
                if mm:
                    items.append(mm.group(3)); i += 1
                elif lines[i].strip() and lines[i].startswith("  ") and items:
                    items[-1] += " " + lines[i].strip(); i += 1
                else:
                    break
            out.append(f"<{tag}>" + "".join(f"<li>{_md_inline(x, refs)}</li>" for x in items) + f"</{tag}>"); continue
        para.append(ln); i += 1
    flush()
    return "\n".join(out)


EXPORT_CSS = """:root{--bg:#fff;--fg:#1d1d1f;--mut:#6e6e73;--line:#d2d2d7;--acc:#0a5bd3;--head:#f5f5f7}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#ececf0;--mut:#a1a1a6;--line:#3a3a3e;--acc:#6aa6ff;--head:#222226}}
body{background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;max-width:980px;margin:0 auto;padding:24px 16px}
h1{font-size:1.7em}h2{margin-top:2em;border-bottom:1px solid var(--line);padding-bottom:.2em}h3{margin-top:1.5em}
.tw{overflow-x:auto}table{border-collapse:collapse;margin:1em 0;font-size:.92em}th,td{border:1px solid var(--line);padding:6px 8px;vertical-align:top;text-align:left}
th{background:var(--head)}code{background:var(--head);padding:0 4px;border-radius:4px}pre{background:var(--head);padding:12px;overflow-x:auto}
blockquote{border-left:3px solid var(--acc);margin:1em 0;padding:.2em 1em;color:var(--mut)}a{color:var(--acc)}
.ref{color:var(--acc);border-bottom:1px dotted var(--acc);cursor:help}footer{color:var(--mut);font-size:.85em;margin-top:3em}"""


def cmd_export(a):
    """Итоговый документ (или любой .md проекта) → автономный HTML рядом с исходником."""
    import html as _h
    pr = active_project(a.project)
    src = Path(a.file) if a.file else pr.p("deliverables/strategy.md")
    if not src.is_absolute() and not src.exists():
        src = pr.dir / src
    if not src.exists():
        sys.exit(f"нет файла {src}")
    refs = {c["id"]: f"{c['type']}: {c['text']}" + ("" if c.get("status") == "active" else f" [{c.get('status')}]")
            for c in pr.claims()}
    refs |= {s["id"]: f"{s.get('kind')}: {s.get('title')}" for s in pr.sources()}
    refs |= {d["id"]: f"решение: {d.get('title')} — {d.get('choice') or ''}" for d in pr.decisions()}
    md = src.read_text(encoding="utf-8")
    title = next((l.lstrip("# ").strip() for l in md.splitlines() if l.startswith("# ")), src.stem)
    body = md_to_html(md, refs)
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    doc = (f'<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
           f"<title>{_h.escape(title)}</title><style>{EXPORT_CSS}</style></head><body>{body}"
           f"<footer>Экспорт: sfp export, {now}. Наведите на [C-…]/[S-…]/[D-…], чтобы увидеть тип и текст записи реестра.</footer></body></html>")
    out = Path(a.out) if a.out else src.with_suffix(".html")
    out.write_text(doc, encoding="utf-8")
    pr.log("action", f"export {src.name} → {out.name}")
    print(out)


# ----------------------------------------------------------------- argparse
def build_parser():
    p = argparse.ArgumentParser(prog="sfp", description="Стратег Фабрики продуктов — состояние, реестры, проверки")
    p.add_argument("-P", "--project", help="id проекта (по умолчанию — активный)")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("init", help="создать проект"); s.add_argument("id"); s.add_argument("--title"); s.add_argument("--owner"); s.set_defaults(f=cmd_init)
    s = sub.add_parser("use", help="сделать проект активным"); s.add_argument("id"); s.set_defaults(f=cmd_use)
    s = sub.add_parser("list", help="список проектов"); s.set_defaults(f=cmd_list)
    s = sub.add_parser("status", help="где мы и что дальше"); s.add_argument("--tail", type=int, default=5); s.set_defaults(f=cmd_status)
    s = sub.add_parser("stage", help="сменить статус шага")
    s.add_argument("id"); s.add_argument("status", choices=["todo", "in_progress", "done", "waiting_human", "skipped", "revisit"])
    s.add_argument("--note"); s.add_argument("--next"); s.set_defaults(f=cmd_stage)
    s = sub.add_parser("next", help="записать следующее действие"); s.add_argument("text"); s.set_defaults(f=cmd_next)
    s = sub.add_parser("question", help="открытый вопрос (добавить/закрыть)"); s.add_argument("text"); s.add_argument("--close", action="store_true"); s.set_defaults(f=cmd_question)

    src = sub.add_parser("source", help="реестр источников").add_subparsers(dest="sub", required=True)
    s = src.add_parser("add"); s.add_argument("title"); s.add_argument("--kind", required=True)
    s.add_argument("--path"); s.add_argument("--url"); s.add_argument("--retrieved"); s.add_argument("--reliability", choices=["high", "medium", "low"])
    s.add_argument("--note"); s.add_argument("--force", action="store_true"); s.set_defaults(f=cmd_source_add)
    s = src.add_parser("list"); s.set_defaults(f=cmd_source_list)
    s = src.add_parser("refresh", help="файл источника обновлён: новый хэш + что затронуто"); s.add_argument("id"); s.add_argument("--reason", required=True); s.set_defaults(f=cmd_source_refresh)

    cl = sub.add_parser("claim", help="реестр утверждений").add_subparsers(dest="sub", required=True)
    s = cl.add_parser("add"); s.add_argument("text"); s.add_argument("--type", required=True)
    s.add_argument("--sources"); s.add_argument("--depends"); s.add_argument("--value", type=float)
    s.add_argument("--low", type=float); s.add_argument("--high", type=float); s.add_argument("--unit"); s.add_argument("--period")
    s.add_argument("--confidence", choices=["high", "medium", "low"]); s.add_argument("--verify"); s.add_argument("--tags")
    s.add_argument("--force", action="store_true"); s.set_defaults(f=cmd_claim_add)
    s = cl.add_parser("list"); s.add_argument("--type"); s.add_argument("--tag"); s.add_argument("--all", action="store_true"); s.set_defaults(f=cmd_claim_list)
    s = cl.add_parser("retract", help="отозвать (неверно)"); s.add_argument("id"); s.add_argument("--reason", required=True); s.set_defaults(f=cmd_claim_retract)
    s = cl.add_parser("supersede", help="заменить новой версией"); s.add_argument("id"); s.add_argument("--reason", required=True)
    s.add_argument("--text"); s.add_argument("--type"); s.add_argument("--value", type=float); s.add_argument("--low", type=float); s.add_argument("--high", type=float)
    s.add_argument("--sources"); s.add_argument("--depends", help="новые основания (C-…)"); s.set_defaults(f=cmd_claim_supersede)

    s = sub.add_parser("impact", help="что затронет изменение утверждения/источника"); s.add_argument("id"); s.set_defaults(f=cmd_impact)

    dc = sub.add_parser("decision", help="реестр решений").add_subparsers(dest="sub", required=True)
    s = dc.add_parser("add"); s.add_argument("title"); s.add_argument("--choice"); s.add_argument("--owner"); s.add_argument("--decided-by")
    s.add_argument("--date"); s.add_argument("--grounds"); s.add_argument("--metric", action="append"); s.add_argument("--review-by")
    s.add_argument("--trigger", action="append"); s.add_argument("--status", default="proposed", choices=["proposed", "made", "revisit", "closed"])
    s.set_defaults(f=cmd_decision_add)
    s = dc.add_parser("commit", help="добавить обязательство"); s.add_argument("id"); s.add_argument("what"); s.add_argument("--owner", required=True); s.add_argument("--due", required=True); s.set_defaults(f=cmd_decision_commit)
    s = dc.add_parser("set"); s.add_argument("id"); s.add_argument("--status", choices=["proposed", "made", "revisit", "closed"])
    s.add_argument("--commitment", type=int); s.add_argument("--commitment-status", choices=["open", "done", "dropped"]); s.add_argument("--note"); s.set_defaults(f=cmd_decision_set)
    s = dc.add_parser("list"); s.set_defaults(f=cmd_decision_list)

    s = sub.add_parser("check", help="проверить целостность и правила доказательности"); s.add_argument("--quiet", action="store_true"); s.set_defaults(f=cmd_check)
    s = sub.add_parser("log", help="запись в журнал"); s.add_argument("summary")
    s.add_argument("--kind", default="action", choices=["action", "tool", "human", "error", "cost", "note"])
    s.add_argument("--model"); s.add_argument("--tool"); s.add_argument("--tokens-in", type=int); s.add_argument("--tokens-out", type=int)
    s.add_argument("--cost-usd", type=float); s.add_argument("--minutes", type=float); s.set_defaults(f=cmd_log)
    s = sub.add_parser("cost", help="время и стоимость по шагам"); s.set_defaults(f=cmd_cost)
    s = sub.add_parser("export", help="Markdown-документ → автономный HTML (по умолчанию deliverables/strategy.md)")
    s.add_argument("file", nargs="?"); s.add_argument("--out"); s.set_defaults(f=cmd_export)
    s = sub.add_parser("history", help="журнал действий"); s.add_argument("-n", type=int, default=30); s.add_argument("--kind"); s.set_defaults(f=cmd_history)
    s = sub.add_parser("search", help="поиск по знаниям и проекту"); s.add_argument("query"); s.add_argument("-k", type=int, default=8); s.set_defaults(f=cmd_search)
    s = sub.add_parser("route", help="выбрать процесс, исполнителя и модель для задачи")
    s.add_argument("task", nargs="?", default=""); s.add_argument("--escalate", metavar="MODEL", help="следующая ступень после неудачи")
    s.set_defaults(f=cmd_route)
    return p


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    a = build_parser().parse_args(argv)
    a.f(a)


if __name__ == "__main__":
    main()
