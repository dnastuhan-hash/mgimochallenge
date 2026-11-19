#!/usr/bin/env python3
"""Сборка описания работы (PDF со скриншотами) из docs/*.md и живого состояния демо-проекта.

  python3 docs/build_pdf.py            → docs/description.pdf (+ docs/img/*.png)

Нужны: Python 3.11+, Node с пакетом playwright и Chromium (для скриншотов и печати в PDF).
Скриншоты терминала — реальный вывод команд ./sfp, отрисованный в HTML; скриншоты документа — экспорт strategy.html.
"""
from __future__ import annotations

import html
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
IMG = DOCS / "img"
sys.path.insert(0, str(ROOT / "tools"))
import sfp  # noqa: E402

SECTIONS = [
    ("Обзор и быстрый старт", ROOT / "README.md"),
    ("Архитектура", DOCS / "architecture.md"),
    ("Что реализовано", DOCS / "capabilities.md"),
    ("Модели, сервисы и инструменты", DOCS / "models-and-tools.md"),
    ("Ключевые промпты", DOCS / "prompts.md"),
    ("Время, расходы, ошибки, помощь человека", DOCS / "costs.md"),
    ("Сравнение с обычным чатом", ROOT / "eval" / "comparison.md"),
    ("Возможности и ограничения", DOCS / "limitations.md"),
]
TERMINAL = [
    ("status", ["status"], "Продолжение после перерыва: состояние проекта, шаг, следующее действие (то же печатает хук при старте сессии)"),
    ("decisions", ["decision", "list"], "Поддержка решений: основания, показатель, срок пересмотра, обязательства"),
    ("impact", ["impact", "C-030"], "Пересмотр: что затронет изменение гипотезы о причинах перебоев"),
    ("cost", ["cost"], "Прозрачность: время и стоимость по шагам"),
    ("check", ["check"], "Проверка доказательности и целостности реестров"),
]


def sh(args: list[str]) -> str:
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "sfp.py"), "-P", "family-connect", *args],
                       capture_output=True, text=True, cwd=ROOT)
    return (r.stdout + r.stderr).rstrip()


def term_html(cmd: str, out: str) -> str:
    lines = out.splitlines()[:40]
    body = html.escape("\n".join(lines) + ("\n…" if len(out.splitlines()) > 40 else ""))
    return (f"<!doctype html><meta charset=utf-8><body style='margin:0;background:#1e1e1e'>"
            f"<pre style='margin:0;padding:18px;color:#d4d4d4;font:13px/1.45 Menlo,Consolas,monospace;white-space:pre-wrap;width:1100px'>"
            f"<span style='color:#6a9955'>$ ./sfp {html.escape(cmd)}</span>\n{body}</pre></body>")


def main():
    IMG.mkdir(exist_ok=True)
    sh(["export"])  # свежий strategy.html
    jobs = []
    for name, args, _ in TERMINAL:
        f = IMG / f"term_{name}.html"
        f.write_text(term_html(" ".join(args), sh(args)), encoding="utf-8")
        jobs.append({"html": str(f), "png": str(IMG / f"term_{name}.png"), "full": True})
    strat = ROOT / "projects/family-connect/deliverables/strategy.html"
    jobs.append({"html": str(strat), "png": str(IMG / "strategy_top.png"), "clip": 0})
    jobs.append({"html": str(strat), "png": str(IMG / "strategy_promises.png"), "anchor": "Обещание ↔ функция ↔ условие"})
    jobs.append({"html": str(strat), "png": str(IMG / "strategy_validation.png"), "anchor": "3.2 План проверки"})

    blocks = [("Итоговый документ (sfp export): резюме и ссылки на реестр", "img/strategy_top.png"),
              ("Таблица «обещание ↔ функция ↔ условие»", "img/strategy_promises.png"),
              ("План проверки пилота", "img/strategy_validation.png")]
    blocks += [(caption, f"img/term_{name}.png") for name, _, caption in TERMINAL]

    parts = ["<h1>Стратег Фабрики продуктов — описание работы</h1>",
             "<p>ИИ-агент (папка с инструкциями, знаниями и инструментами) для руководителя цифрового продукта: от размытого "
             "запроса до проверяемой продуктовой и коммуникационной стратегии и сопровождения решений. "
             "Демо-проект — бриф МегаФона «Связь для близких и собственных устройств».</p>",
             "<h2>Содержание</h2><ol>" + "".join(f"<li>{html.escape(t)}</li>" for t, _ in SECTIONS)
             + "<li>Скриншоты</li></ol>"]
    for title, path in SECTIONS:
        md = path.read_text(encoding="utf-8")
        md = "\n".join(l for l in md.splitlines() if not l.startswith("# "))  # заголовок раздела задаём сами
        parts.append(f'<section class="sec"><h1>{html.escape(title)}</h1>'
                     f'<p class="src">Файл: {html.escape(str(path.relative_to(ROOT)))}</p>{sfp.md_to_html(md)}</section>')
    shots = "".join(f'<figure><img src="{src}"><figcaption>{html.escape(cap)}</figcaption></figure>' for cap, src in blocks)
    parts.append(f'<section class="sec"><h1>Скриншоты</h1>{shots}</section>')
    css = sfp.EXPORT_CSS + """
@media print{.sec{page-break-before:always}} figure{margin:1.2em 0;page-break-inside:avoid} img{max-width:100%;border:1px solid #ccc}
figcaption{font-size:.9em;color:#555;margin-top:4px} .src{color:#888;font-size:.85em} pre code{white-space:pre-wrap}
body{max-width:none} table{font-size:.8em} :root{--bg:#fff;--fg:#111;--head:#f3f3f3;--line:#ccc}"""
    doc = DOCS / "description.html"
    doc.write_text(f"<!doctype html><html lang=ru><meta charset=utf-8><title>Стратег Фабрики продуктов — описание работы</title>"
                   f"<style>{css}</style><body>{''.join(parts)}</body></html>", encoding="utf-8")

    js = r"""
const {chromium}=require('playwright');
(async()=>{const jobs=JSON.parse(process.argv[1]);const b=await chromium.launch();
for(const j of jobs){const p=await b.newPage({viewport:{width:1140,height:900},deviceScaleFactor:2});
 await p.goto('file://'+j.html);
 if(j.full){await p.screenshot({path:j.png,fullPage:true});}
 else if(j.anchor){const y=await p.evaluate(a=>{const el=[...document.querySelectorAll('h2,h3,p,strong')].find(e=>e.textContent.includes(a));return el?el.getBoundingClientRect().top+window.scrollY-10:0},j.anchor);
   await p.evaluate(y=>window.scrollTo(0,y),y);await p.screenshot({path:j.png});}
 else {await p.screenshot({path:j.png});}
 await p.close();}
const p=await b.newPage();await p.goto('file://'+process.argv[2]);
await p.pdf({path:process.argv[3],format:'A4',printBackground:true,margin:{top:'14mm',bottom:'14mm',left:'12mm',right:'12mm'}});
await b.close();})();
"""
    pdf = DOCS / "description.pdf"
    subprocess.run(["node", "-e", js, json.dumps(jobs), str(doc), str(pdf)], check=True, cwd=ROOT)
    for f in IMG.glob("term_*.html"):
        f.unlink()
    print(pdf)


if __name__ == "__main__":
    main()
