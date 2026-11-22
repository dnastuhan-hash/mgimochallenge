'use strict';
/* Страницы кабинета студента. */

// ---------- Общие куски ----------
const roomLink = (room) => (isVisible('map') && /^[АБВ]-\d/.test(room || '') ? html`<a href="#/map?room=${encodeURIComponent(room)}">${ic('pin', 'tiny-ic')}${room}</a>` : html`<span>${room || ''}</span>`);
const CHANGE_LABEL = { cancel: 'Отменено', room: 'Новая аудитория', replace: 'Замена', add: 'Перенос / доп. занятие' };
function lessonRow(l, opts = {}) {
  const now = Date.now();
  const live = l.startAt <= now && now < l.endAt && l.change?.kind !== 'cancel';
  return html`<div class="lesson ${l.change?.kind === 'cancel' ? 'cancel' : ''} ${live ? 'now' : ''}">
    <div class="time">${l.start}<small>${l.end}</small></div>
    <div>
      <div class="between"><span class="subj">${l.subject}</span>${live ? pill('Идёт', 'primary') : ''}</div>
      <div class="meta"><span>${l.kind}</span>${roomLink(l.room)}<span>${l.teacher}</span>${opts.pairNo ? html`<span class="faint">${l.pair}-я пара</span>` : ''}</div>
      ${l.change ? html`<div class="change ${l.change.kind}">${ic(l.change.kind === 'cancel' ? 'x' : l.change.kind === 'add' ? 'plus' : 'alert')}<span>${CHANGE_LABEL[l.change.kind]}${l.change.old ? ` (было: ${l.change.old})` : ''}${l.change.note ? ` · ${l.change.note}` : ''}</span></div>` : ''}
    </div></div>`;
}
const markClass = (m) => (/^[2-5]$/.test(m) ? `m${m}` : m === 'зачтено' ? 'm5 z' : m === 'не зачтено' ? 'm2 z' : 'z');
const barKind = (p) => (p >= 85 ? 'ok' : p >= 70 ? '' : p >= 40 ? 'warn' : 'danger');
const tabs = (items, active, attr = 'data-tab') => html`<div class="tabs" role="tablist">${items.map(([k, t]) => html`<button role="tab" aria-selected="${k === active}" class="${k === active ? 'active' : ''}" ${raw(attr)}="${k}">${t}</button>`)}</div>`;
const CAT = {
  schedule: ['calendar', 'warn', 'Расписание'], request: ['doc', 'ok', 'Заявки'], deadline: ['clock', 'danger', 'Тесты'], grades: ['chart', '', 'Оценки'],
  official: ['info', '', 'Деканат'], news: ['news', 'teal', 'Новости'], event: ['star', 'teal', 'События'], chat: ['chat', '', 'Чат'],
};

// ---------- Главная ----------
page(/^\/home$/, async (main) => {
  setTitle('Главная');
  const d = await api('/api/home');
  const hour = mskParts(Date.now()).hh;
  const hello = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  const t = dateOf(d.today.date);
  const n = d.next;
  const live = n && n.startAt <= Date.now();
  const quick = [
    ['requests', '#/requests/new', 'doc', 'Заказать справку'],
    ['card', '#/card', 'id', 'Студбилет'],
    ['chat', '#/chat', 'chat', 'Написать в деканат'],
    ['schedule', '#/calendar', 'calendar', 'Пары в календарь'],
    ['map', '#/map', 'map', 'Найти аудиторию'],
    ['assistant', '#/assistant', 'sparkles', 'Спросить помощника'],
  ].filter((q) => isVisible(q[0]));
  const todayLessons = d.today.lessons;
  const st = d.stipend;
  main.innerHTML = html`<div class="stack-lg fade-in">
    <div><h2>${hello}, ${firstName(state.me.fullName)}!</h2><p class="muted small">${WD_LONG[t.wd]}, ${t.d} ${MONTHS[t.m]} · ${state.me.group}</p></div>

    ${isVisible('schedule') ? html`<a class="card hero tap" href="#/schedule">
      ${n ? html`<div class="between"><span class="pill">${live ? 'Идёт сейчас' : n.date === d.today.date ? `Через ${until(n.startAt)}` : `${n.weekday}, ${fmtDate(n.date)}`}</span><span class="small muted">${n.start}–${n.end}</span></div>
        <h2 style="margin:12px 0 4px">${n.subject}</h2>
        <p class="muted">${n.kind} · ауд. ${n.room} · ${n.teacher}</p>
        ${n.change ? html`<p style="margin-top:8px;font-weight:650">⚠ ${CHANGE_LABEL[n.change.kind]}${n.change.note ? ': ' + n.change.note : ''}</p>` : ''}`
      : html`<h2>Ближайших занятий нет</h2><p class="muted">Отдыхайте!</p>`}
    </a>` : ''}

    ${isVisible('tests') && d.hotTests.length ? html`<div class="card ${d.hotTests.some((x) => x.hot) ? 'hot' : ''}">
      <div class="card-h"><h3>${ic('clock')} Тесты, которые ждут вас</h3><a href="#/tests">Все ${ic('right')}</a></div>
      <div class="list">${d.hotTests.slice(0, 3).map((x) => html`<a class="item" href="#/tests"><div class="tile-ic ${x.hot ? 'danger' : 'warn'}">${ic('tests')}</div><div class="grow"><b style="display:block">${x.title}</b><span class="small muted">${x.subject}</span></div>${pill(`ещё ${until(x.closesAt)}`, x.hot ? 'danger' : 'warn')}</a>`)}</div>
    </div>` : ''}

    ${quick.length ? html`<div class="hscroll">${quick.map((q) => html`<a class="card quick tap" href="${q[1]}"><div class="tile-ic">${ic(q[2])}</div><span>${q[3]}</span></a>`)}</div>` : ''}

    ${isVisible('schedule') && d.changes.length ? html`<div class="card">
      <div class="card-h"><h3>Изменения в расписании</h3><a href="#/schedule?tab=changes">Все ${ic('right')}</a></div>
      <div class="list">${d.changes.map((c) => html`<div class="item"><div class="tile-ic ${c.kind === 'cancel' ? 'danger' : c.kind === 'add' ? 'teal' : 'warn'}">${ic(c.kind === 'cancel' ? 'x' : c.kind === 'add' ? 'plus' : 'alert')}</div><div class="grow"><b>${CHANGE_LABEL[c.kind]}</b> · <span class="small">${fmtDate(c.date, true)}, ${c.pair}-я пара</span><div class="small muted">${[c.subject, c.room && 'ауд. ' + c.room, c.teacher, c.note].filter(Boolean).join(' · ')}</div></div></div>`)}</div>
    </div>` : ''}

    ${isVisible('schedule') ? html`<div class="card">
      <div class="card-h"><h3>${todayLessons.length ? 'Сегодня' : d.nextDay ? `Ближайшие пары · ${fmtDate(d.nextDay.date, true)}` : 'Сегодня пар нет'}</h3><a href="#/schedule">Неделя ${ic('right')}</a></div>
      ${(todayLessons.length ? todayLessons : d.nextDay?.lessons || []).map((l) => lessonRow(l))}
      ${!todayLessons.length && !d.nextDay ? emptyState('calendar', 'Свободная неделя', '') : ''}
    </div>` : ''}

    <div class="grid-cards">
      ${isVisible('requests') ? html`<a class="card tap" href="#/requests"><div class="card-h"><h3>Мои заявки</h3>${ic('right', 'chev')}</div>
        ${d.requests.length ? html`<div class="stack">${d.requests.slice(0, 3).map((r) => html`<div><div class="between"><span class="small ellipsis"><b>${r.title}</b></span>${pill(r.statusLabel, STATUS_KIND[r.status])}</div><div class="steps ${r.status === 'ready' ? 'ok' : ''}" style="margin-top:6px">${[1, 2, 3, 4].map((i) => html`<i class="${i <= STATUS_STEP[r.status] ? 'on' : ''}"></i>`)}</div></div>`)}</div>`
        : html`<p class="small muted">Активных заявок нет. Нужна справка? Это пара касаний.</p>`}</a>` : ''}

      ${isVisible('grades') ? html`<a class="card tap" href="#/grades"><div class="card-h"><h3>Как дела с учёбой</h3>${ic('right', 'chev')}</div>
        <div class="row"><div class="stat"><b>${d.grades.averagePoints}</b><span class="small muted">средний балл из 100</span></div>${d.grades.gpa ? html`<div class="stat"><b>${d.grades.gpa}</b><span class="small muted">средняя оценка</span></div>` : ''}</div>
        ${d.grades.risks.length ? html`<p class="small" style="margin-top:10px;color:var(--warn);font-weight:600">${ic('alert', 'tiny-ic')} Внимание: ${d.grades.risks.map((r) => r.subject).join(', ')}</p>` : html`<p class="small" style="margin-top:10px;color:var(--ok);font-weight:600">Рисков нет — так держать!</p>`}</a>` : ''}

      ${isVisible('stipend') && st.applicable ? html`<a class="card tap" href="#/stipend"><div class="card-h"><h3>Стипендия</h3>${ic('right', 'chev')}</div>
        ${st.eligible ? html`<div class="stat"><b>${money(st.amount)}</b><span class="small muted">через ${st.daysLeft} ${plural(st.daysLeft, 'день', 'дня', 'дней')} · ${fmtDate(st.payDate)}</span></div>` : html`<p class="muted small">Сейчас не назначена</p>`}
        <p class="small" style="margin-top:10px;font-weight:600;color:${st.forecast.keeps ? 'var(--ok)' : 'var(--warn)'}">${st.forecast.keeps ? 'По текущим баллам сохранится' : `Риск потерять: ${st.forecast.threats.length} ${plural(st.forecast.threats.length, 'предмет', 'предмета', 'предметов')}`}</p></a>` : ''}

      ${isVisible('payment') && d.payment ? html`<a class="card tap" href="#/payment"><div class="card-h"><h3>Оплата обучения</h3>${ic('right', 'chev')}</div>
        <div class="stat"><b>${money(d.payment.amount)}</b><span class="small muted">до ${fmtDate(d.payment.due)} · ${d.payment.title}</span></div></a>` : ''}

      ${isVisible('schedule') && d.session ? html`<a class="card tap" href="#/schedule?tab=session"><div class="card-h"><h3>Сессия</h3>${ic('right', 'chev')}</div>
        <div class="stat"><b>${d.session.daysLeft} ${plural(d.session.daysLeft, 'день', 'дня', 'дней')}</b><span class="small muted">до первого испытания: ${d.session.first.kind.toLowerCase()} · ${d.session.first.subject}</span></div></a>` : ''}

      ${isVisible('news') && d.news.length ? html`<a class="card tap" href="#/news"><div class="card-h"><h3>Объявления</h3>${ic('right', 'chev')}</div>
        ${d.news.map((x) => html`<p class="small" style="margin-bottom:6px"><b>${x.title}</b></p>`)}</a>` : ''}
    </div>
    <a class="btn ghost block" href="#/settings/sections">${ic('settings')} Настроить разделы и главную</a>
  </div>`;
}, 'home');

// ---------- Ещё ----------
page(/^\/more$/, async (main) => {
  setTitle('Все разделы');
  const vis = visibleSections();
  const hidden = state.prefs.sections.filter((s) => !s.visible && applies(secById(s.id))).length;
  main.innerHTML = html`<div class="stack fade-in">
    <div class="grid2">${vis.map((s) => html`<a class="card tap" href="#/${s.id}"><div class="tile-ic">${ic(s.icon)}</div><h3 style="margin-top:10px">${s.title}</h3><p class="small muted">${s.desc}</p></a>`)}</div>
    <a class="card tap between" href="#/settings/sections"><div class="row"><div class="tile-ic teal">${ic('settings')}</div><div><b>Разделы кабинета</b><p class="small muted">${hidden ? `Скрыто: ${hidden}. ` : ''}Показать, скрыть, закрепить в меню</p></div></div>${ic('right', 'chev')}</a>
    <a class="card tap between" href="#/notifications"><div class="row"><div class="tile-ic">${ic('bell')}</div><b>Уведомления</b></div>${ic('right', 'chev')}</a>
    <a class="card tap between" href="#/profile"><div class="row"><div class="tile-ic">${ic('user')}</div><b>Профиль и настройки</b></div>${ic('right', 'chev')}</a>
  </div>`;
}, 'more');

// ---------- Расписание ----------
page(/^\/schedule$/, async (main, _m, q) => {
  setTitle('Расписание');
  let tab = q.get('tab') || 'day';
  let week = 0, data, selected = null;
  const load = async () => {
    data = await api(`/api/schedule?week=${week}`);
    if (!selected || !data.days.some((x) => x.date === selected)) {
      const today = data.days.find((x) => x.isToday);
      selected = today ? today.date : data.days.find((x) => x.lessons.length)?.date || data.days[0].date;
    }
  };
  
  if ([0, 6].includes(dateOf(todayIso()).wd)) week = 1; // в выходные сразу показываем следующую неделю
  await load();
  const draw = () => {
    const day = data.days.find((x) => x.date === selected);
    const parity = data.parity === 'odd' ? 'числитель' : 'знаменатель';
    main.innerHTML = html`<div class="stack fade-in">
      ${hiddenBanner('schedule')}
      ${tabs([['day', 'День'], ['week', 'Неделя'], ['changes', `Изменения${data.changes.length ? ' · ' + data.changes.length : ''}`], ['session', 'Сессия']], tab)}
      ${tab === 'day' || tab === 'week' ? html`<div class="between">
        <button class="iconbtn" data-week="-1" aria-label="Предыдущая неделя">${ic('left')}</button>
        <div style="text-align:center"><b>${week === 0 ? 'Эта неделя' : week === 1 ? 'Следующая неделя' : week === -1 ? 'Прошлая неделя' : `${fmtDate(data.days[0].date)} – ${fmtDate(data.days[5].date)}`}</b><div class="small muted">${data.weekNumber}-я учебная неделя · ${parity}</div></div>
        <button class="iconbtn" data-week="1" aria-label="Следующая неделя">${ic('right')}</button></div>` : ''}
      ${tab === 'day' ? html`
        <div class="daystrip">${data.days.map((x) => { const p = dateOf(x.date); return html`<button class="${x.date === selected ? 'active' : ''} ${x.isToday ? 'today' : ''}" data-day="${x.date}" aria-label="${WD_LONG[p.wd]} ${p.d}"><span class="tiny">${WD_SHORT[p.wd]}</span><b>${p.d}</b>${x.lessons.some((l) => l.change) ? html`<i class="mark"></i>` : ''}</button>`; })}</div>
        <div class="card">${day.lessons.length ? day.lessons.map((l) => lessonRow(l, { pairNo: true })) : emptyState('sun', 'Пар нет', 'Свободный день — можно выдохнуть')}</div>` : ''}
      ${tab === 'week' ? data.days.filter((x) => x.lessons.length).map((x) => html`<div class="card"><div class="card-h"><h3>${x.weekday}${x.isToday ? ' · сегодня' : ''}</h3><span class="small muted">${fmtDate(x.date)}</span></div>${x.lessons.map((l) => lessonRow(l))}</div>`) : ''}
      ${tab === 'changes' ? html`<div class="card">${data.changes.length ? html`<div class="list">${data.changes.map((c) => html`<div class="item"><div class="tile-ic ${c.kind === 'cancel' ? 'danger' : c.kind === 'add' ? 'teal' : 'warn'}">${ic(c.kind === 'cancel' ? 'x' : c.kind === 'add' ? 'plus' : 'alert')}</div><div class="grow"><b>${CHANGE_LABEL[c.kind]}</b><div class="small">${fmtDate(c.date, true)}, ${c.pair}-я пара</div><div class="small muted">${[c.subject, c.room && 'ауд. ' + c.room, c.teacher, c.note].filter(Boolean).join(' · ')}</div></div></div>`)}</div>` : emptyState('check', 'Изменений нет', 'Всё по плану. Если что-то поменяется — придёт уведомление.')}</div>` : ''}
      ${tab === 'session' ? html`<div class="card">${data.session.length ? html`<div class="list">${data.session.map((e) => html`<div class="item"><div class="tile-ic ${e.kind === 'Экзамен' ? 'danger' : e.kind === 'Консультация' ? 'teal' : ''}">${ic(e.kind === 'Экзамен' ? 'star' : e.kind === 'Консультация' ? 'chat' : 'check')}</div><div class="grow"><b>${e.subject}</b><div class="small muted">${e.kind} · ${fmtDate(e.date, true)}, ${e.time} · ауд. ${e.room} · ${e.teacher}</div></div></div>`)}</div>` : emptyState('calendar', 'Расписание сессии ещё не опубликовано', '')}</div>` : ''}
      ${isVisible('schedule') ? html`<a class="card tap between" href="#/calendar"><div class="row"><div class="tile-ic teal">${ic('calendar')}</div><div><b>Пары в Google / Яндекс Календаре</b><p class="small muted">Подписка обновляется сама при переносах</p></div></div>${ic('right', 'chev')}</a>` : ''}
    </div>`;
    $$('[data-tab]', main).forEach((b) => b.onclick = () => { tab = b.dataset.tab; history.replaceState(null, '', `#/schedule?tab=${tab}`); draw(); });
    $$('[data-day]', main).forEach((b) => b.onclick = () => { selected = b.dataset.day; draw(); });
    $$('[data-week]', main).forEach((b) => b.onclick = async () => { week += Number(b.dataset.week); selected = null; main.style.opacity = .6; try { await load(); } finally { main.style.opacity = 1; } draw(); });
  };
  draw();
}, 'schedule');

// ---------- Календарь ----------
page(/^\/calendar$/, async (main) => {
  setTitle('Пары в календаре', '#/schedule');
  const c = await api('/api/calendar');
  const draw = (cal) => {
    main.innerHTML = html`<div class="stack fade-in">
      <div class="card"><h3>Расписание в вашем календаре</h3><p class="small muted" style="margin-top:6px">Подпишитесь один раз — пары, переносы и сессия появятся в календаре телефона и будут обновляться сами. Дедлайны тестов в календарь не попадают, о них напомнит кабинет.</p></div>
      ${cal.demo ? html`<div class="card flat" style="background:var(--warn-soft)"><p class="small"><b>Демо-версия без сервера.</b> Подписка требует сервера, к которому обращаются Google и Яндекс, поэтому здесь кнопки подписки отключены. Скачайте файл .ics и импортируйте его в календарь. В серверной версии (npm start) подписка работает и обновляется сама.</p></div>` : ""}
      ${cal.demo ? "" : cal.providers.map((p) => html`<div class="card"><div class="between"><div class="row"><div class="tile-ic ${p.id === 'yandex' ? 'danger' : p.id === 'google' ? '' : 'teal'}">${ic(p.id === 'other' ? 'copy' : 'calendar')}</div><b>${p.name}</b></div>
        <button class="btn sm" data-prov="${p.id}">${p.mode === 'copy' ? 'Скопировать' : 'Подключить'}</button></div>
        <ol class="small muted" style="margin:10px 0 0;padding-left:20px">${p.steps.map((s) => html`<li>${s}</li>`)}</ol></div>`)}
      <div class="card stack">
        <label class="field">Напоминание перед парой<select class="input" id="calrem">${[[0, 'Без напоминания'], [10, 'За 10 минут'], [15, 'За 15 минут'], [30, 'За 30 минут'], [60, 'За 1 час']].map(([v, t]) => html`<option value="${v}" ${state.prefs.calReminder === v ? 'selected' : ''}>${t}</option>`)}</select></label>
        <div class="btns"><button class="btn ghost sm" data-dl>${ic('download')} Скачать .ics</button>${cal.demo ? "" : html`<button class="btn ghost sm" data-copy>${ic('copy')} Ссылка</button>`}</div>
        ${cal.demo ? '' : html`<p class="tiny faint">${ic('shield', 'tiny-ic')} Ссылка личная и открывает только расписание — без оценок и персональных данных. Если поделились ею случайно, сбросьте:</p>
        <button class="btn danger sm" data-reset>${ic('refresh')} Сбросить ссылку</button>`}
      </div></div>`;
    $$('[data-prov]', main).forEach((b) => b.onclick = async () => {
      const p = cal.providers.find((x) => x.id === b.dataset.prov);
      if (p.mode !== 'link') { await copyText(cal.https); toast('Ссылка скопирована'); }
      if (p.mode !== 'copy') window.open(p.href, '_blank', 'noopener');
    });
    $('[data-copy]', main)?.addEventListener('click', async () => { await copyText(cal.https); toast('Ссылка скопирована'); });
    $('[data-dl]', main).onclick = async () => {
      try {
        const r = await fetch(new URL(cal.https).pathname);
        if (!r.ok) throw new Error();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([await r.text()], { type: 'text/calendar' }));
        a.download = 'raspisanie.ics'; document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } catch { toast('Не удалось скачать файл', 'err'); }
    };
    $('#calrem', main).onchange = (e) => { savePrefs({ ...state.prefs, calReminder: Number(e.target.value) }); toast('Сохранено. Календарь обновится при следующей синхронизации'); };
    if ($('[data-reset]', main)) $('[data-reset]', main).onclick = async () => {
      if (!confirm('Старая ссылка перестанет работать, календари нужно будет подключить заново. Сбросить?')) return;
      await api('/api/calendar/reset', { method: 'POST' });
      toast('Новая ссылка создана'); draw(await api('/api/calendar'));
    };
  };
  draw(c);
}, 'schedule');

// ---------- Успеваемость ----------
page(/^\/grades$/, async (main, _m, q) => {
  setTitle('Успеваемость');
  const g = await api('/api/grades');
  let tab = q.get('tab') || 'current';
  const s = g.summary;
  const draw = () => {
    main.innerHTML = html`<div class="stack fade-in">
      ${hiddenBanner('grades')}
      <div class="card hero"><div class="row">
        <div class="ring" style="--p:${s.averagePoints}"><div><b>${s.averagePoints}</b><span>средний<br>балл</span></div></div>
        <div class="grow"><h2>${s.risks.length ? 'Есть над чем поработать' : 'Всё идёт хорошо'}</h2><p class="muted small" style="margin-top:4px">${g.currentSemester}-й семестр · допуск к экзамену от ${g.admission} баллов</p></div></div>
        <div class="kpis" style="margin-top:14px"><div class="kpi"><b>${s.gpa ?? '—'}</b><span>средняя оценка</span></div><div class="kpi"><b>${s.totalCredits}</b><span>з.е. закрыто</span></div><div class="kpi"><b>${s.debts}</b><span>долгов</span></div></div>
      </div>
      ${s.risks.length ? html`<div class="card"><h3 style="margin-bottom:8px">${ic('alert', 'tiny-ic')} Обратите внимание</h3><div class="list">${s.risks.map((r) => html`<div class="item"><div class="tile-ic warn">${ic('alert')}</div><div class="grow"><b>${r.subject}</b><div class="small muted">${r.points} б. · ${r.reason}</div></div></div>`)}</div></div>` : ''}
      ${tabs([['current', 'Текущий семестр'], ['history', 'Зачётная книжка']], tab)}
      ${tab === 'current' ? html`<div class="card">${g.current.map((c) => html`<details class="subject">
        <summary><div class="between"><div class="grow"><b>${c.subject}</b><div class="small muted">${c.control === 'exam' ? 'Экзамен' : c.control === 'diff' ? 'Дифф. зачёт' : 'Зачёт'} · ${c.teacher}</div></div><span class="points">${c.points}</span></div>
        <div class="bar" style="margin-top:8px"><i class="${barKind(c.points)}" style="width:${c.points}%"></i><span class="tick" style="left:${g.admission}%"></span></div>
        <div class="between small" style="margin-top:6px"><span class="muted">Прогноз: <b>${c.forecast}</b> (${c.forecastLabel})</span>${c.toNext ? html`<span class="muted">до «${c.toNext.target}» +${c.toNext.need}</span>` : ''}</div></summary>
        ${c.items.length ? html`<div class="list" style="margin-top:8px">${c.items.map((i) => html`<div class="item small"><span class="grow">${i.title}${i.date ? html` <span class="faint">· ${fmtDate(i.date)}</span>` : ''}</span><b>${i.points} / ${i.max}</b></div>`)}</div>` : html`<p class="small faint" style="margin-top:8px">Детализация появится, когда преподаватель выставит баллы.</p>`}
      </details>`)}<p class="tiny faint" style="margin-top:10px">Шкала: ${g.scale.map((x) => `${x.min}+ — «${x.mark}»`).join(', ')}. Нажмите на дисциплину, чтобы увидеть, из чего складываются баллы.</p></div>` : ''}
      ${tab === 'history' ? (g.history.length ? g.history.map((h) => html`<div class="card"><div class="card-h"><h3>${h.semester}-й семестр</h3>${h.gpa ? pill(`средняя ${h.gpa}`, 'primary') : ''}</div>
        <div class="list">${h.items.map((i) => html`<div class="item"><div class="grow"><b>${i.subject}</b><div class="small muted">${i.control === 'exam' ? 'Экзамен' : i.control === 'diff' ? 'Дифф. зачёт' : 'Зачёт'} · ${i.credits} з.е. · ${fmtDate(i.date)}</div></div><span class="mark ${markClass(i.mark)}">${i.mark === 'зачтено' ? 'зач' : i.mark}</span></div>`)}</div></div>`)
        : html`<div class="card">${emptyState('chart', 'Первая сессия впереди', 'Здесь появятся оценки после зимней сессии. Пока следите за баллами в текущем семестре.')}</div>`) : ''}
    </div>`;
    $$('[data-tab]', main).forEach((b) => b.onclick = () => { tab = b.dataset.tab; draw(); });
  };
  draw();
}, 'grades');

// ---------- Стипендия ----------
page(/^\/stipend$/, async (main) => {
  setTitle('Стипендия');
  const s = await api('/api/stipend');
  if (!s.applicable) { main.innerHTML = html`<div class="card">${emptyState('coins', 'Стипендия не начисляется', 'Вы учитесь по договору. Следите за новостями о именных стипендиях и грантах.')}</div>`; return; }
  main.innerHTML = html`<div class="stack fade-in">${hiddenBanner('stipend')}
    <div class="card hero"><p class="muted small">Ближайшая выплата</p><h1 style="font-size:34px;margin:6px 0">${s.eligible ? money(s.amount) : 'Не назначена'}</h1>
      <p class="muted">${s.eligible ? `${fmtDate(s.payDate)} · через ${s.daysLeft} ${plural(s.daysLeft, 'день', 'дня', 'дней')}` : ''}</p><p style="margin-top:8px">${s.reason}</p></div>
    <div class="card"><h3>Прогноз на следующий семестр</h3>
      ${s.forecast.keeps ? html`<p style="margin-top:8px;color:var(--ok);font-weight:650">${ic('check', 'tiny-ic')} По текущим баллам стипендия сохранится: ${money(s.forecast.amount)}</p>`
      : html`<p class="small muted" style="margin:6px 0 4px">Чтобы сохранить стипендию, подтяните:</p><div class="list">${s.forecast.threats.map((t) => html`<div class="item"><div class="tile-ic warn">${ic('alert')}</div><div class="grow"><b>${t.subject}</b><div class="small muted">сейчас ${t.points} б. — ${t.text}</div></div></div>`)}</div>`}</div>
    <div class="card"><h3>Правила</h3><ul class="small muted" style="padding-left:18px;margin:8px 0 0">${s.rules.map((r) => html`<li>${r}</li>`)}</ul></div>
    ${isVisible('requests') ? html`<a class="btn secondary block" href="#/requests/new/stipend">${ic('doc')} Справка о размере стипендии</a>` : ''}
  </div>`;
}, 'stipend');

// ---------- Оплата ----------
page(/^\/payment$/, async (main) => {
  setTitle('Оплата обучения');
  const p = await api('/api/payments');
  if (!p.applicable) { main.innerHTML = html`<div class="card">${emptyState('wallet', 'Оплата не требуется', 'Вы учитесь на бюджетной основе.')}</div>`; return; }
  const pct = Math.round((p.paid / p.total) * 100);
  main.innerHTML = html`<div class="stack fade-in">${hiddenBanner('payment')}
    <div class="card"><p class="small muted">Оплачено за учебный год</p><h1 style="margin:6px 0">${money(p.paid)} <span class="muted" style="font-size:16px">из ${money(p.total)}</span></h1><div class="bar"><i class="ok" style="width:${pct}%"></i></div></div>
    <div class="card"><div class="list">${p.items.map((i) => html`<div class="item"><div class="tile-ic ${i.paid_at ? 'ok' : 'warn'}">${ic(i.paid_at ? 'check' : 'clock')}</div><div class="grow"><b>${i.title}</b><div class="small muted">${i.paid_at ? `оплачено ${fmtDate(i.paid_at)}` : `до ${fmtDate(i.due)}`}</div></div><b>${money(i.amount)}</b></div>`)}</div></div>
    <button class="btn block" data-pay>${ic('wallet')} Оплатить следующий платёж</button>
    <p class="tiny faint" style="text-align:center">В прототипе оплата не проводится: реальный кабинет передал бы платёж в банк-эквайер вуза.</p>
  </div>`;
  $('[data-pay]', main).onclick = () => toast('Это демо: оплата в прототипе отключена');
}, 'payment');

// ---------- Справки и заявки ----------
const reqCard = (r) => html`<a class="card tap" href="#/requests/${r.id}"><div class="between"><b>${r.title}</b>${pill(r.statusLabel, STATUS_KIND[r.status])}</div>
  <div class="steps ${r.status === 'ready' || r.status === 'done' ? 'ok' : r.status === 'rejected' ? 'bad' : ''}" style="margin:10px 0 6px">${[1, 2, 3, 4].map((i) => html`<i class="${i <= STATUS_STEP[r.status] ? 'on' : ''}"></i>`)}</div>
  <p class="tiny faint">№ ${r.id} · обновлено ${relTime(r.updated_at)}</p></a>`;
page(/^\/requests$/, async (main) => {
  setTitle('Справки и заявки');
  const list = await api('/api/requests');
  const active = list.filter((r) => !['done', 'cancelled', 'rejected'].includes(r.status));
  const closed = list.filter((r) => ['done', 'cancelled', 'rejected'].includes(r.status));
  main.innerHTML = html`<div class="stack fade-in">${hiddenBanner('requests')}
    <a class="btn block" href="#/requests/new">${ic('plus')} Нужна справка или заявление</a>
    ${list.length ? html`${active.length ? html`<h3 class="section-title">Активные</h3>${active.map(reqCard)}` : ''}${closed.length ? html`<h3 class="section-title">Архив</h3>${closed.map(reqCard)}` : ''}`
    : html`<div class="card">${emptyState('doc', 'Заявок пока нет', 'Справка об обучении, в военкомат, выписка оценок — заказ занимает меньше минуты, статус видно здесь.')}</div>`}
  </div>`;
}, 'requests');

page(/^\/requests\/new$/, async (main) => {
  setTitle('Что нужно?', '#/requests');
  const types = await api('/api/request-types');
  main.innerHTML = html`<div class="stack fade-in"><p class="muted">Выберите документ — дальше 1–3 поля.</p>
    <div class="grid-cards">${types.map((t) => html`<a class="card tap" href="#/requests/new/${t.id}"><div class="row top"><div class="tile-ic">${ic(t.icon)}</div><div class="grow"><b>${t.title}</b><p class="small muted">${t.hint}</p><p class="tiny faint" style="margin-top:4px">${ic('clock', 'tiny-ic')} ~${t.days} ${plural(t.days, 'рабочий день', 'рабочих дня', 'рабочих дней')}</p></div></div></a>`)}</div>
    ${isVisible('chat') ? html`<a class="card tap between" href="#/chat"><span class="row"><span class="tile-ic teal">${ic('chat')}</span><span><b>Не нашли нужное?</b><br><span class="small muted">Напишите в деканат</span></span></span>${ic('right', 'chev')}</a>` : ''}
  </div>`;
}, 'requests');

page(/^\/requests\/new\/(\w+)$/, async (main, m) => {
  const types = await api('/api/request-types');
  const t = types.find((x) => x.id === m[1]);
  setTitle(t ? t.title : 'Заявка', '#/requests/new');
  if (!t) { main.innerHTML = html`<div class="card">${emptyState('alert', 'Этот тип заявки вам недоступен', 'Например, справка о стипендии доступна только бюджетникам.', html`<a class="btn secondary" href="#/requests/new">К списку</a>`)}</div>`; return; }
  const field = (f) => {
    const req = f.required ? raw(' required') : '';
    if (f.type === 'select') return html`<label class="field">${f.label}<select class="input" name="${f.name}">${f.options.map(([v, l]) => html`<option value="${v}" ${v === f.default ? 'selected' : ''}>${l}</option>`)}</select></label>`;
    if (f.type === 'textarea') return html`<label class="field">${f.label}${f.required ? '' : html` <span class="faint small">(необязательно)</span>`}<textarea class="input" name="${f.name}" maxlength="${f.max}" placeholder="${f.placeholder || ''}"${req}></textarea></label>`;
    return html`<label class="field">${f.label}<input class="input" name="${f.name}" type="${f.type}" ${f.min != null ? raw(`min="${f.min}"`) : ''} ${f.type === 'number' ? raw(`max="${f.max}"`) : f.max ? raw(`maxlength="${f.max}"`) : ''} value="${f.default ?? ''}" placeholder="${f.placeholder || ''}"${req}></label>`;
  };
  main.innerHTML = html`<form class="stack fade-in" novalidate>
    <div class="card stack"><p class="small muted">${t.hint} · срок ~${t.days} ${plural(t.days, 'рабочий день', 'рабочих дня', 'рабочих дней')}</p>
      <div class="card flat" style="background:var(--surface-2)"><p class="small"><b>${state.me.fullName}</b><br>${state.me.group} · ${state.me.course} курс · ${state.me.recordBook}</p><p class="tiny faint" style="margin-top:4px">Эти данные подставлены из профиля — вводить не нужно</p></div>
      ${t.fields.map(field)}
      <div class="err" hidden>${ic('alert')}<span></span></div>
    </div>
    <button class="btn block" type="submit">Отправить в деканат</button></form>`;
  const f = $('form', main);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const err = $('.err', f);
    const data = Object.fromEntries(new FormData(f));
    const missing = t.fields.find((x) => x.required && !String(data[x.name] || '').trim());
    if (missing) { err.hidden = false; err.querySelector('span').textContent = `Заполните поле «${missing.label}»`; f[missing.name].focus(); return; }
    const btn = $('button[type=submit]', f); btn.disabled = true; btn.textContent = 'Отправляем…';
    try {
      const r = await api('/api/requests', { method: 'POST', body: { type: t.id, data } });
      toast('Заявка отправлена! Статус — в «Моих заявках»');
      go(`#/requests/${r.id}`);
    } catch (ex) { err.hidden = false; err.querySelector('span').textContent = ex.message; btn.disabled = false; btn.textContent = 'Отправить в деканат'; }
  };
}, 'requests');

const FLOW = [['new', 'Принята'], ['in_progress', 'В работе'], ['ready', 'Готово'], ['done', 'Получено']];
page(/^\/requests\/(\d+)$/, async (main, m) => {
  setTitle(`Заявка № ${m[1]}`, '#/requests');
  let r;
  try { r = await api(`/api/requests/${m[1]}`); } catch (e) {
    if (e.status === 404) { main.innerHTML = html`<div class="card">${emptyState('shield', 'Заявка не найдена', 'Такой заявки нет или она принадлежит другому студенту. Каждый видит только свои заявки.', html`<a class="btn secondary" href="#/requests">Мои заявки</a>`)}</div>`; return; }
    throw e;
  }
  const step = STATUS_STEP[r.status];
  const bad = ['rejected', 'cancelled'].includes(r.status);
  main.innerHTML = html`<div class="stack fade-in">
    <div class="card"><div class="between"><h2>${r.title}</h2>${pill(r.statusLabel, STATUS_KIND[r.status])}</div>
      <p class="small muted" style="margin-top:4px">Подана ${fmtDT(r.createdAt)} · срок ~${r.slaDays} раб. ${plural(r.slaDays, 'день', 'дня', 'дней')}</p>
      ${r.staffComment ? html`<div class="card flat" style="margin-top:12px;background:var(--ok-soft)"><p class="small"><b>Комментарий деканата:</b> ${r.staffComment}</p></div>` : ''}
    </div>
    <div class="card"><h3 style="margin-bottom:12px">Статус</h3><div class="timeline">
      ${bad ? html`<div class="tl cur"><div class="b">${ic('x')}</div><div><b>${r.statusLabel}</b></div></div>` : FLOW.map(([k, label], i) => {
        const ev = [...r.events].reverse().find((e) => STATUS_STEP[e.status] === i + 1);
        const cls = i + 1 < step || (i + 1 === step && r.status === 'done') ? 'done' : i + 1 === step ? 'cur' : '';
        return html`<div class="tl ${cls}"><div class="b">${cls === 'done' ? ic('check') : html`<b class="tiny">${i + 1}</b>`}</div><div><b>${i === 1 && r.status === 'need_info' ? 'Нужны уточнения' : label}</b>${ev ? html`<div class="small muted">${fmtDT(ev.at)}${ev.note ? ' · ' + ev.note : ''}</div>` : ''}</div></div>`;
      })}</div></div>
    ${r.fields.length ? html`<div class="card"><h3 style="margin-bottom:6px">Данные заявки</h3><div class="list">${r.fields.map((x) => html`<div class="item small"><span class="muted grow">${x.label}</span><b style="text-align:right">${x.value}</b></div>`)}</div></div>` : ''}
    <div class="btns">${['new', 'need_info'].includes(r.status) ? html`<button class="btn danger" data-cancel>Отменить заявку</button>` : ''}${isVisible('chat') ? html`<a class="btn ghost" href="#/chat">${ic('chat')} Вопрос по заявке</a>` : ''}</div>
  </div>`;
  $('[data-cancel]', main)?.addEventListener('click', async () => {
    if (!confirm('Отменить заявку?')) return;
    try { await api(`/api/requests/${r.id}/cancel`, { method: 'POST' }); toast('Заявка отменена'); router(); } catch (e) { toast(e.message, 'err'); }
  });
}, 'requests');

// ---------- Тесты СДО ----------
page(/^\/tests$/, async (main) => {
  setTitle('Тесты СДО');
  let t = await api('/api/tests');
  let tab = 'open';
  const card = (x) => {
    const total = x.closesAt - x.opensAt, gone = Math.min(1, Math.max(0, (Date.now() - x.opensAt) / total));
    return html`<div class="card ${x.hot ? 'hot' : ''}">
      <div class="between"><span class="small muted">${x.subject}</span>${x.result === 'done' ? pill(x.score ? `Пройден · ${x.score}` : 'Пройден', 'ok', 'check') : x.result === 'missed' ? pill('Пропущен', 'danger') : x.state === 'upcoming' ? pill(`откроется через ${until(x.opensAt)}`, 'primary') : pill(`закроется через ${until(x.closesAt)}`, x.hot ? 'danger' : 'warn', 'clock')}</div>
      <h3 style="margin:6px 0 4px">${x.title}</h3>
      <p class="small muted">${x.teacher} · ${x.timeLimit ? `${x.timeLimit} мин` : 'без лимита'} · ${x.attempts} ${plural(x.attempts, 'попытка', 'попытки', 'попыток')}</p>
      <p class="small" style="margin-top:6px">${fmtDT(x.opensAt)} — ${fmtDT(x.closesAt)}</p>
      ${x.state === 'open' && x.result !== 'done' ? html`<div class="bar" style="margin-top:8px"><i class="${x.hot ? 'danger' : 'warn'}" style="width:${Math.round(gone * 100)}%"></i></div>
        <div class="btns" style="margin-top:12px"><a class="btn sm" href="${x.url}" target="_blank" rel="noopener">${ic('external')} Перейти к тесту</a><button class="btn ghost sm" data-done="${x.id}">${ic('check')} Я прошёл(а)</button></div>` : ''}
    </div>`;
  };
  const draw = () => {
    const list = t[tab];
    main.innerHTML = html`<div class="stack fade-in">${hiddenBanner('tests')}
      ${tabs([['open', `Открыты · ${t.open.length}`], ['upcoming', `Скоро · ${t.upcoming.length}`], ['closed', 'Завершены']], tab)}
      ${list.length ? list.map(card) : html`<div class="card">${emptyState(tab === 'open' ? 'check' : 'tests', tab === 'open' ? 'Открытых тестов нет' : tab === 'upcoming' ? 'Новых тестов не запланировано' : 'Пока пусто', tab === 'open' ? 'Как только преподаватель откроет тест в СДО, он появится здесь и придёт уведомление.' : '')}</div>`}
      <p class="tiny faint">${ic('info', 'tiny-ic')} Данные из СДО: Moodle (демо-адаптер). Напоминания приходят, когда тест открылся и за ${state.prefs.reminders.join(', ')} ч до закрытия — <a href="#/settings">изменить</a>.</p>
    </div>`;
    $$('[data-tab]', main).forEach((b) => b.onclick = () => { tab = b.dataset.tab; draw(); });
    $$('[data-done]', main).forEach((b) => b.onclick = async () => { await api(`/api/tests/${b.dataset.done}/done`, { method: 'POST' }); toast('Отмечено — напоминаний больше не будет'); t = await api('/api/tests'); draw(); refreshUnread(); });
  };
  draw();
  every(60_000, draw);
}, 'tests');

// ---------- Уведомления ----------
page(/^\/notifications$/, async (main) => {
  setTitle('Уведомления');
  let data = await api('/api/notifications');
  let filter = 'all';
  const groups = [['all', 'Все'], ['schedule', 'Расписание'], ['deadline', 'Тесты'], ['request', 'Заявки'], ['grades', 'Оценки'], ['official', 'Деканат'], ['news', 'Новости']];
  const draw = () => {
    const items = data.items.filter((n) => filter === 'all' || n.category === filter || (filter === 'news' && n.category === 'event'));
    main.innerHTML = html`<div class="stack fade-in">
      <div class="chips">${groups.map(([k, t]) => html`<button class="${k === filter ? 'active' : ''}" data-f="${k}">${t}</button>`)}</div>
      ${data.unread ? html`<button class="btn ghost sm" data-all>${ic('check')} Прочитать все (${data.unread})</button>` : ''}
      <div class="card">${items.length ? html`<div class="list">${items.map((n) => { const c = CAT[n.category] || CAT.official; return html`<a class="item" href="${n.link || '#/notifications'}" data-key="${n.key}">
        <div class="tile-ic ${c[1]}">${ic(c[0])}</div><div class="grow"><div class="between"><b class="${n.read ? 'muted' : ''}">${n.title}</b>${n.read ? '' : html`<span class="pill danger" aria-label="Новое">•</span>`}</div>
        <div class="small muted">${n.body}</div><div class="tiny faint">${c[2]} · ${relTime(n.at)}</div></div></a>`; })}</div>`
      : emptyState('bell', 'Здесь пока тихо', 'Изменения расписания, статусы заявок и напоминания о тестах появятся здесь.')}</div>
      <p class="tiny faint">${ic('shield', 'tiny-ic')} Важные уведомления (переносы пар, статусы заявок, сроки тестов, объявления деканата) приходят всегда. Новости и события можно отключить в <a href="#/settings">настройках</a>.</p>
    </div>`;
    $$('[data-f]', main).forEach((b) => b.onclick = () => { filter = b.dataset.f; draw(); });
    $$('[data-key]', main).forEach((a) => a.addEventListener('click', () => api('/api/notifications/read', { method: 'POST', body: { keys: [a.dataset.key] } }).then(refreshUnread)));
    $('[data-all]', main)?.addEventListener('click', async () => { await api('/api/notifications/read', { method: 'POST', body: {} }); data = await api('/api/notifications'); state.unread = 0; updateUnread(); draw(); });
  };
  draw();
}, 'notifications');

// ---------- Новости ----------
const NEWS_CAT = { official: ['Деканат', 'primary'], news: ['Новости', 'teal'], event: ['Событие', 'warn'] };
page(/^\/news$/, async (main) => {
  setTitle('Новости');
  const list = await api('/api/news');
  main.innerHTML = html`<div class="stack fade-in">${hiddenBanner('news')}${list.length ? list.map((n) => html`<a class="card tap" href="#/news/${n.id}"><div class="between">${pill(NEWS_CAT[n.category][0], NEWS_CAT[n.category][1])}<span class="tiny faint">${relTime(n.created_at)}</span></div><h3 style="margin:8px 0 4px">${n.important ? '❗ ' : ''}${n.title}</h3><p class="small muted ellipsis">${n.body}</p></a>`)
    : html`<div class="card">${emptyState('news', 'Новостей пока нет', '')}</div>`}</div>`;
}, 'news');
page(/^\/news\/(\d+)$/, async (main, m) => {
  setTitle('Новость', '#/news');
  const n = (await api('/api/news')).find((x) => x.id === Number(m[1]));
  if (!n) { main.innerHTML = html`<div class="card">${emptyState('news', 'Новость не найдена', '')}</div>`; return; }
  api('/api/notifications/read', { method: 'POST', body: { keys: [`news${n.id}`] } }).then(refreshUnread);
  main.innerHTML = html`<article class="card stack fade-in"><div class="between">${pill(NEWS_CAT[n.category][0], NEWS_CAT[n.category][1])}<span class="tiny faint">${fmtDT(n.created_at)}</span></div><h2>${n.title}</h2><p style="white-space:pre-wrap">${n.body}</p></article>`;
}, 'news');

// ---------- Карта кампуса ----------
const BUILDINGS = [
  { id: 'А', name: 'Корпус А', sub: 'Главный', x: 40, y: 40, w: 150, h: 90, floors: 4, info: 'Деканаты, ректорат, большие лекционные. Каб. А-105 — выдача справок.', hours: '07:30–21:00' },
  { id: 'Б', name: 'Корпус Б', sub: 'IT и лаборатории', x: 230, y: 40, w: 130, h: 90, floors: 3, info: 'Компьютерные классы, коворкинг (3 этаж).', hours: '07:30–22:00' },
  { id: 'В', name: 'Корпус В', sub: 'Гуманитарный', x: 40, y: 170, w: 110, h: 100, floors: 3, info: 'Экономика, право, иностранные языки.', hours: '07:30–21:00' },
  { id: 'Л', name: 'Библиотека', sub: 'и читальный зал', x: 190, y: 170, w: 90, h: 60, floors: 2, info: 'Абонемент, читальный зал, печать документов.', hours: '09:00–20:00' },
  { id: 'С', name: 'Столовая', sub: '', x: 300, y: 170, w: 60, h: 60, floors: 1, info: 'Комплексный обед для студентов — скидка по студбилету.', hours: '09:00–17:00' },
  { id: 'Спорткомплекс', name: 'Спорткомплекс', sub: '', x: 190, y: 250, w: 170, h: 50, floors: 2, info: 'Залы, бассейн, тренажёрный зал. Вход по студбилету.', hours: '08:00–22:00' },
  { id: 'Общ', name: 'Общежитие №2', sub: 'ул. Студенческая', x: 40, y: 300, w: 110, h: 40, floors: 9, info: 'Вахта круглосуточно. Комендант — каб. 101.', hours: 'круглосуточно' },
];
page(/^\/map$/, async (main, _m, q) => {
  setTitle('Карта кампуса');
  let sel = null, floor = null;
  const parse = (s) => {
    const v = String(s || '').trim().toUpperCase().replace(/\s/g, '');
    if (/^СПОРТ/.test(v)) return { b: 'Спорткомплекс' };
    const mm = /^([АБВ])-?(\d)(\d{1,2})$/.exec(v.replace('A', 'А').replace('B', 'В'));
    if (mm) return { b: mm[1], floor: Number(mm[2]), room: `${mm[1]}-${mm[2]}${mm[3]}` };
    const b = BUILDINGS.find((x) => x.name.toUpperCase().includes(v) || x.id.toUpperCase() === v);
    return b ? { b: b.id } : null;
  };
  const draw = (msg) => {
    const b = BUILDINGS.find((x) => x.id === sel);
    main.innerHTML = html`<div class="stack fade-in">${hiddenBanner('map')}
      <form class="search-box" id="mapq">${ic('search')}<input name="q" placeholder="Аудитория, например Б-201" value="${q.get('room') || ''}" aria-label="Поиск аудитории"><button class="btn sm">Найти</button></form>
      ${msg ? html`<p class="err">${ic('alert')}<span>${msg}</span></p>` : ''}
      <div class="card" style="padding:8px"><svg class="campus" viewBox="0 0 400 360" role="img" aria-label="Схема кампуса (вымышленная)">
        <rect class="green" x="160" y="140" width="20" height="200" rx="6"/><rect class="green" x="0" y="140" width="400" height="16" rx="6"/>
        <path class="path" d="M20 150H390M170 20V350"/>
        ${BUILDINGS.map((x) => html`<g class="bld ${x.id === sel ? 'hl' : ''}" data-b="${x.id}" tabindex="0" role="button" aria-label="${x.name}"><rect x="${x.x}" y="${x.y}" width="${x.w}" height="${x.h}" rx="12"/><text x="${x.x + 12}" y="${x.y + 24}">${x.name}</text>${x.sub ? html`<text class="sub" x="${x.x + 12}" y="${x.y + 40}">${x.sub}</text>` : ''}</g>`)}
        <g><circle cx="170" cy="350" r="7" fill="var(--teal)"/><text x="182" y="354" font-size="11" fill="var(--text-2)">Вход на кампус</text></g>
      </svg></div>
      ${b ? html`<div class="card"><div class="between"><h3>${b.name}</h3>${pill(b.hours, 'teal', 'clock')}</div>
        ${floor ? html`<p style="margin-top:8px;font-weight:650;color:var(--primary)">${ic('pin', 'tiny-ic')} Аудитория ${q.get('room') || ''} — ${floor}-й этаж</p>` : ''}
        <p class="small muted" style="margin-top:6px">${b.info}</p><p class="tiny faint" style="margin-top:6px">Этажей: ${b.floors}. Номер аудитории: буква корпуса, затем этаж и номер (Б-201 → корпус Б, 2 этаж).</p></div>`
      : html`<p class="small muted">Нажмите на здание или введите номер аудитории. Схема кампуса вымышленная.</p>`}
    </div>`;
    $$('[data-b]', main).forEach((g) => { const pick = () => { sel = g.dataset.b; floor = null; draw(); }; g.onclick = pick; g.onkeydown = (e) => e.key === 'Enter' && pick(); });
    $('#mapq', main).onsubmit = (e) => {
      e.preventDefault();
      const v = e.target.q.value;
      const r = parse(v);
      if (!r) return draw('Не нашли такую аудиторию. Формат: А-301, Б-105, В-210');
      sel = r.b; floor = r.floor || null; q.set('room', r.room || v); draw();
    };
  };
  const init = parse(q.get('room'));
  if (init) { sel = init.b; floor = init.floor || null; }
  draw();
}, 'map');

// ---------- Чат с деканатом ----------
page(/^\/chat$/, async (main) => {
  setTitle('Чат с деканатом');
  const draw = async (focus) => {
    const msgs = await api('/api/messages');
    const keep = $('textarea', main)?.value || '';
    main.innerHTML = html`<div class="stack fade-in">${hiddenBanner('chat')}
      <div class="card flat small muted">${ic('clock', 'tiny-ic')} Отвечаем в рабочие дни 9:00–18:00, обычно в течение дня. Для справок быстрее <a href="#/requests/new">заказать онлайн</a>.</div>
      <div class="chat">${msgs.length ? msgs.map((m) => html`<div class="msg ${m.mine ? 'mine' : ''}">${m.text}<small>${m.author} · ${relTime(m.created_at)}</small></div>`) : emptyState('chat', 'Напишите первым', 'Вопрос о сессии, переводе, документах — ответит сотрудник деканата.')}</div>
      <form class="composer"><textarea name="text" rows="1" placeholder="Сообщение…" maxlength="2000" aria-label="Сообщение"></textarea><button class="btn" aria-label="Отправить">${ic('send')}</button></form>
    </div>`;
    const f = $('form', main), ta = $('textarea', f);
    ta.value = keep;
    if (focus) ta.focus();
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      $('button', f).disabled = true;
      try { await api('/api/messages', { method: 'POST', body: { text } }); ta.value = ''; await draw(true); window.scrollTo(0, document.body.scrollHeight); } catch (ex) { toast(ex.message, 'err'); $('button', f).disabled = false; }
    };
  };
  await draw();
  window.scrollTo(0, document.body.scrollHeight);
  every(15_000, () => { if (document.activeElement?.tagName !== 'TEXTAREA' || !$('textarea', main)?.value) draw(document.activeElement?.tagName === 'TEXTAREA'); });
}, 'chat');

// ---------- Студбилет ----------
page(/^\/card$/, async (main) => {
  setTitle('Студбилет');
  const draw = async () => {
    const c = await api('/api/card');
    main.innerHTML = html`<div class="stack fade-in" style="max-width:440px;margin:0 auto">${hiddenBanner('card')}
      <div class="card hero stack"><div class="between"><span class="row"><img src="logo.svg" alt="" width="28" height="28"><b>Студенческий билет</b></span><span class="tiny muted">концепт</span></div>
        <div class="row"><span class="avatar lg" style="background:rgba(255,255,255,.2)">${initials(c.fullName)}</span><div><h2>${c.fullName}</h2><p class="muted small">${c.faculty}</p></div></div>
        <div class="kpis"><div class="kpi"><b>${c.group}</b><span>группа</span></div><div class="kpi"><b>${c.course}</b><span>курс</span></div><div class="kpi"><b style="font-size:14px">${c.recordBook}</b><span>№ билета</span></div></div>
        <p class="tiny muted">Действителен до ${c.validUntil} · ${c.funding === 'budget' ? 'бюджет' : 'договор'}</p></div>
      <div class="card stack" style="text-align:center"><div class="qr" id="qr"></div>
        <p class="small muted">Покажите на входе, в библиотеке или столовой. Код обновляется каждые 5 минут — скриншот не сработает.</p>
        <p class="small"><b class="countdown" id="qr-left"></b></p></div></div>`;
    try { const qr = qrcode(0, 'M'); qr.addData(c.url); qr.make(); $('#qr', main).innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch { $('#qr', main).textContent = 'QR недоступен'; }
    const tick = () => { const s = Math.max(0, Math.round((c.expiresAt - Date.now()) / 1000)); const el = $('#qr-left', main); if (el) el.textContent = `обновится через ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; if (s <= 0) draw(); };
    tick();
    timers.forEach(clearInterval); timers = [];
    every(1000, tick);
  };
  await draw();
}, 'card');

// ---------- Общежитие ----------
page(/^\/dorm$/, async (main) => {
  setTitle('Общежитие');
  const { dorm } = await api('/api/dorm');
  if (!dorm) { main.innerHTML = html`<div class="card">${emptyState('building', 'Вы не проживаете в общежитии', 'Заселение и вопросы о свободных местах — через чат деканата.')}</div>`; return; }
  main.innerHTML = html`<div class="stack fade-in">${hiddenBanner('dorm')}
    <div class="card hero"><p class="muted small">${dorm.name}</p><h1 style="margin:6px 0">Комната ${dorm.room}</h1><p class="muted">${dorm.address}</p></div>
    <div class="grid2"><div class="card"><p class="small muted">Оплата</p><b>${money(dorm.fee)} / мес</b><p class="small" style="color:var(--ok);margin-top:4px">${ic('check', 'tiny-ic')} оплачено до ${fmtDate(dorm.paidUntil)}</p></div>
    <div class="card"><p class="small muted">Комендант</p><b>${dorm.commandant}</b></div></div>
    ${isVisible('requests') ? html`<a class="btn block" href="#/requests/new/dorm_repair">${ic('wrench')} Заявка на ремонт</a>` : ''}
    <div class="card"><h3>Полезное</h3><ul class="small muted" style="padding-left:18px;margin:8px 0 0"><li>Гости — до 22:00 по записи на вахте</li><li>Прачечная — 1 этаж, запись у вахтёра</li><li>Тишина — с 23:00 до 07:00</li></ul></div>
  </div>`;
}, 'dorm');

// ---------- Поддержка ----------
page(/^\/support$/, async (main) => {
  setTitle('Поддержка');
  const C = [
    ['heart', 'teal', 'Психологическая служба', 'Бесплатно и анонимно · корп. В, каб. 108', '+7 (000) 000-00-01'],
    ['user', '', 'Куратор группы', 'Вопросы адаптации и учёбы', '+7 (000) 000-00-02'],
    ['shield', 'warn', 'Профком студентов', 'Матпомощь, путёвки, защита прав', '+7 (000) 000-00-03'],
    ['info', 'danger', 'Медпункт', 'Корп. А, 1 этаж, 8:00–17:00', '+7 (000) 000-00-04'],
    ['settings', '', 'Техподдержка кабинета', 'Не входит в кабинет, ошибки', '+7 (000) 000-00-05'],
  ];
  main.innerHTML = html`<div class="stack fade-in">${hiddenBanner('support')}
    <div class="card hero"><h2>Вы не одни</h2><p class="muted" style="margin-top:6px">Если тяжело с учёбой, тревожно перед сессией или просто нужно поговорить — здесь контакты тех, кто поможет.</p></div>
    <div class="card"><div class="list">${C.map((c) => html`<div class="item"><div class="tile-ic ${c[1]}">${ic(c[0])}</div><div class="grow"><b>${c[2]}</b><div class="small muted">${c[3]}</div></div><span class="small faint">${c[4]}</span></div>`)}</div></div>
    <p class="tiny faint">Номера телефонов в прототипе вымышленные.</p>
  </div>`;
}, 'support');

// ---------- Помощник ----------
page(/^\/assistant$/, async (main, _m, q) => {
  setTitle('Помощник');
  const hist = [];
  const SUG = ['Где следующая пара?', 'Когда стипендия?', 'Как у меня дела с учёбой?', 'Как заказать справку?', 'Я болел, что делать?', 'Как скрыть лишние разделы?'];
  const draw = () => {
    main.innerHTML = html`<div class="stack fade-in">${hiddenBanner('assistant')}
      <div class="card flat small muted">${ic('sparkles', 'tiny-ic')} Помощник отвечает по базе знаний деканата и вашим данным в кабинете. Ответы формируются на сервере; ваши данные никуда не передаются.</div>
      <div class="chat">${hist.length ? hist.map((h) => html`<div class="msg mine">${h.q}</div><div class="msg">${h.a.answer}${h.a.actions.length ? html`<div class="btns" style="margin-top:8px">${h.a.actions.map(([t, l]) => html`<a class="btn sm secondary" href="${l}">${t}</a>`)}</div>` : ''}</div>`) : ''}</div>
      <div class="chips">${SUG.map((s) => html`<button data-sug="${s}">${s}</button>`)}</div>
      <form class="composer"><textarea name="q" rows="1" placeholder="Ваш вопрос…" maxlength="300" aria-label="Вопрос"></textarea><button class="btn" aria-label="Спросить">${ic('send')}</button></form>
    </div>`;
    const f = $('form', main);
    const ask = async (text) => { if (!text.trim()) return; const a = await api(`/api/assistant?q=${encodeURIComponent(text)}`); hist.push({ q: text, a }); draw(); window.scrollTo(0, document.body.scrollHeight); };
    f.onsubmit = (e) => { e.preventDefault(); ask(f.q.value); };
    f.q.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } };
    $$('[data-sug]', main).forEach((b) => b.onclick = () => ask(b.dataset.sug));
  };
  draw();
  if (q.get('q')) { const a = await api(`/api/assistant?q=${encodeURIComponent(q.get('q'))}`); hist.push({ q: q.get('q'), a }); draw(); }
}, 'assistant');

// ---------- Профиль ----------
page(/^\/profile$/, async (main) => {
  setTitle('Профиль');
  const me = state.me;
  main.innerHTML = html`<div class="stack fade-in">
    <div class="card"><div class="row"><span class="avatar lg">${initials(me.fullName)}</span><div class="grow"><h2>${me.fullName}</h2><p class="small muted">${me.group} · ${me.course} курс</p></div></div>
      <div class="list" style="margin-top:10px">${[['Институт', me.faculty], ['Направление', me.program], ['Курс', me.course], ['Группа', me.group], ['Основа обучения', me.funding === 'budget' ? 'Бюджет' : 'Договор'], ['№ зачётной книжки', me.recordBook], ['Почта', me.email]].map(([k, v]) => html`<div class="item small"><span class="muted grow">${k}</span><b style="text-align:right">${v}</b></div>`)}</div></div>
    <div class="card"><div class="list">
      <a class="item" href="#/settings/sections"><div class="tile-ic">${ic('grid')}</div><div class="grow"><b>Разделы кабинета</b><div class="small muted">Показать, скрыть, нижнее меню</div></div>${ic('right', 'chev')}</a>
      <a class="item" href="#/settings"><div class="tile-ic">${ic('settings')}</div><div class="grow"><b>Настройки</b><div class="small muted">Тема, напоминания, уведомления</div></div>${ic('right', 'chev')}</a>
      ${isVisible('schedule') ? html`<a class="item" href="#/calendar"><div class="tile-ic teal">${ic('calendar')}</div><div class="grow"><b>Календарь</b><div class="small muted">Google, Яндекс, Apple</div></div>${ic('right', 'chev')}</a>` : ''}
    </div></div>
    <div class="card flat small muted">${ic('shield', 'tiny-ic')} Ваши данные видите только вы и деканат. Пароль хранится в зашифрованном виде (scrypt), сессия — в защищённом cookie.</div>
    <button class="btn ghost block" data-logout>${ic('logout')} Выйти</button>
  </div>`;
  $('[data-logout]', main).onclick = logout;
}, 'profile');

// ---------- Настройки: разделы ----------
page(/^\/settings\/sections$/, async (main) => {
  setTitle('Разделы кабинета', '#/profile');
  const draw = () => {
    const p = state.prefs;
    main.innerHTML = html`<div class="stack fade-in">
      <p class="muted small">Оставьте только то, чем пользуетесь. Скрытые разделы не пропадают: их можно найти поиском и вернуть одним касанием. Важные уведомления приходят всегда.</p>
      <div class="grid2">${Object.entries(PRESETS).map(([k, v]) => html`<button class="preset ${p.preset === k ? 'active' : ''}" data-preset="${k}"><b>${v.title}</b><span class="tiny muted">${v.desc}</span></button>`)}</div>
      <div class="card"><div class="between" style="margin-bottom:6px"><h3>Разделы</h3><span class="tiny faint">${ic('pin', 'tiny-ic')} = в нижнем меню (до 3)</span></div>
        ${p.sections.map((s, i) => { const sec = secById(s.id); const ok = applies(sec); const pinned = p.nav.includes(s.id); return html`<div class="sec-row">
          <div class="mv"><button data-up="${i}" aria-label="Выше" ${i === 0 ? 'disabled' : ''}>${ic('up')}</button><button data-down="${i}" aria-label="Ниже" ${i === p.sections.length - 1 ? 'disabled' : ''}>${ic('down')}</button></div>
          <div class="tile-ic ${ok ? '' : 'z'}" style="${ok ? '' : 'opacity:.4'}">${ic(sec.icon)}</div>
          <div class="grow"><b class="${ok ? '' : 'faint'}">${sec.title}</b><div class="tiny faint">${ok ? sec.desc : 'Недоступно: ' + sec.na}</div></div>
          ${ok && s.visible ? html`<button class="pinbtn ${pinned ? 'on' : ''}" data-pin="${s.id}" aria-pressed="${pinned}" aria-label="Закрепить в меню">${ic('pin')}</button>` : ''}
          <label class="switch"><input type="checkbox" data-vis="${s.id}" ${s.visible && ok ? 'checked' : ''} ${ok ? '' : 'disabled'} aria-label="Показывать раздел ${sec.title}"><span></span></label>
        </div>`; })}
      </div>
      <p class="tiny faint">Настройки сохраняются в профиле на сервере — на телефоне и компьютере кабинет выглядит одинаково.</p>
    </div>`;
    const update = (fn) => { const np = structuredClone(state.prefs); fn(np); np.preset = 'custom'; savePrefs(np); rerender(); };
    $$('[data-preset]', main).forEach((b) => b.onclick = () => { const np = presetPrefs(state.me, b.dataset.preset, { theme: state.prefs.theme, reminders: state.prefs.reminders, mute: state.prefs.mute, calReminder: state.prefs.calReminder }); savePrefs(np); rerender(); toast(`Набор «${PRESETS[b.dataset.preset].title}» применён`); });
    $$('[data-vis]', main).forEach((c) => c.onchange = () => update((np) => {
      np.sections.find((s) => s.id === c.dataset.vis).visible = c.checked;
      if (!c.checked) np.nav = np.nav.filter((id) => id !== c.dataset.vis);
    }));
    $$('[data-pin]', main).forEach((b) => b.onclick = () => {
      const id = b.dataset.pin;
      if (!state.prefs.nav.includes(id) && state.prefs.nav.length >= 3) return toast('В меню помещается 3 раздела — сначала открепите один', 'err');
      update((np) => { np.nav = np.nav.includes(id) ? np.nav.filter((x) => x !== id) : [...np.nav, id]; });
    });
    const move = (i, d) => update((np) => { const [x] = np.sections.splice(i, 1); np.sections.splice(i + d, 0, x); np.nav.sort((a, b) => np.sections.findIndex((s) => s.id === a) - np.sections.findIndex((s) => s.id === b)); });
    $$('[data-up]', main).forEach((b) => b.onclick = () => move(Number(b.dataset.up), -1));
    $$('[data-down]', main).forEach((b) => b.onclick = () => move(Number(b.dataset.down), 1));
  };
  const rerender = () => { renderShell(); setTitle('Разделы кабинета', '#/profile'); markNav('settings'); main = $('#main'); draw(); };
  draw();
}, 'settings');

// ---------- Настройки: общие ----------
page(/^\/settings$/, async (main) => {
  setTitle('Настройки', '#/profile');
  const draw = () => {
    const p = state.prefs;
    main.innerHTML = html`<div class="stack fade-in">
      <div class="card stack"><h3>Оформление</h3><div class="tabs">${[['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([k, t]) => html`<button class="${p.theme === k ? 'active' : ''}" data-theme="${k}">${t}</button>`)}</div></div>
      <div class="card stack"><h3>Напоминания о тестах СДО</h3><p class="small muted">Когда напоминать до закрытия теста (если он ещё не пройден):</p>
        <div class="chips">${[48, 24, 12, 6, 3, 1].map((h) => html`<button class="${p.reminders.includes(h) ? 'active' : ''}" data-rem="${h}">за ${h} ч</button>`)}</div></div>
      <div class="card"><h3 style="margin-bottom:6px">Уведомления</h3>
        ${[['news', 'Новости университета'], ['event', 'События и мероприятия']].map(([k, t]) => html`<div class="sec-row"><div class="grow"><b>${t}</b></div><label class="switch"><input type="checkbox" data-mute="${k}" ${p.mute[k] ? '' : 'checked'} aria-label="${t}"><span></span></label></div>`)}
        ${[['Переносы и отмены пар'], ['Статусы заявок'], ['Сроки тестов'], ['Объявления деканата и оценки']].map(([t]) => html`<div class="sec-row"><div class="grow"><b>${t}</b><div class="tiny faint">Важное — отключить нельзя</div></div><label class="switch"><input type="checkbox" checked disabled aria-label="${t}"><span></span></label></div>`)}
      </div></div>`;
    $$('[data-theme]', main).forEach((b) => b.onclick = () => { savePrefs({ ...state.prefs, theme: b.dataset.theme }); draw(); });
    $$('[data-rem]', main).forEach((b) => b.onclick = () => { const h = Number(b.dataset.rem); let r = state.prefs.reminders.includes(h) ? state.prefs.reminders.filter((x) => x !== h) : [...state.prefs.reminders, h]; if (!r.length) return toast('Оставьте хотя бы одно напоминание', 'err'); savePrefs({ ...state.prefs, reminders: r.sort((a, b) => b - a) }); draw(); });
    $$('[data-mute]', main).forEach((c) => c.onchange = () => { savePrefs({ ...state.prefs, mute: { ...state.prefs.mute, [c.dataset.mute]: !c.checked } }); });
  };
  draw();
}, 'settings');
