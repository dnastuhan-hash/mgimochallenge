'use strict';
/* Кабинет сотрудника деканата: заявки, обращения, объявления, изменения расписания, тесты СДО. */
const STAFF_NAV = [
  { id: 'home', title: 'Обзор', icon: 'home' },
  { id: 'staff/requests', title: 'Заявки', icon: 'doc' },
  { id: 'staff/chat', title: 'Обращения', short: 'Чаты', icon: 'chat' },
  { id: 'staff/publish', title: 'Действия', icon: 'plus' },
];

staffPage(/^\/home$/, async (main) => {
  setTitle('Кабинет деканата');
  const s = await api('/api/staff/summary');
  main.innerHTML = html`<div class="stack-lg fade-in">
    <div><h2>Здравствуйте, ${state.me.fullName.split(' ')[1]} ${state.me.fullName.split(' ')[2] || ''}!</h2><p class="small muted">${state.me.program}</p></div>
    <div class="grid2">
      <a class="card tap" href="#/staff/requests"><div class="tile-ic primary">${ic('doc')}</div><div class="stat" style="margin-top:10px"><b>${s.newRequests}</b><span class="small muted">новых заявок</span></div></a>
      <a class="card tap" href="#/staff/requests"><div class="tile-ic warn">${ic('clock')}</div><div class="stat" style="margin-top:10px"><b>${s.inProgress}</b><span class="small muted">в работе</span></div></a>
      <a class="card tap" href="#/staff/chat"><div class="tile-ic teal">${ic('chat')}</div><div class="stat" style="margin-top:10px"><b>${s.unreadChats}</b><span class="small muted">непрочитанных обращений</span></div></a>
      <div class="card"><div class="tile-ic">${ic('user')}</div><div class="stat" style="margin-top:10px"><b>${s.students}</b><span class="small muted">студентов в демо</span></div></div>
    </div>
    <div class="card"><div class="list">
      <a class="item" href="#/staff/news"><div class="tile-ic">${ic('news')}</div><div class="grow"><b>Опубликовать объявление</b><div class="small muted">Всем, институту или группе</div></div>${ic('right', 'chev')}</a>
      <a class="item" href="#/staff/changes"><div class="tile-ic warn">${ic('calendar')}</div><div class="grow"><b>Изменить расписание</b><div class="small muted">Отмена, перенос, замена — студенты получат уведомление</div></div>${ic('right', 'chev')}</a>
      <a class="item" href="#/staff/tests"><div class="tile-ic teal">${ic('tests')}</div><div class="grow"><b>Добавить тест СДО</b><div class="small muted">Если СДО факультета не подключена</div></div>${ic('right', 'chev')}</a>
    </div></div>
  </div>`;
}, 'home');

staffPage(/^\/staff\/publish$/, async (main) => {
  setTitle('Действия');
  main.innerHTML = html`<div class="card fade-in"><div class="list">
    <a class="item" href="#/staff/news"><div class="tile-ic">${ic('news')}</div><div class="grow"><b>Объявление</b></div>${ic('right', 'chev')}</a>
    <a class="item" href="#/staff/changes"><div class="tile-ic warn">${ic('calendar')}</div><div class="grow"><b>Изменение расписания</b></div>${ic('right', 'chev')}</a>
    <a class="item" href="#/staff/tests"><div class="tile-ic teal">${ic('tests')}</div><div class="grow"><b>Тест СДО</b></div>${ic('right', 'chev')}</a>
  </div></div>`;
}, 'staff/publish');

staffPage(/^\/staff\/requests$/, async (main) => {
  setTitle('Заявки студентов');
  let filter = 'active';
  const draw = async () => {
    const list = await api(`/api/staff/requests?status=${filter}`);
    main.innerHTML = html`<div class="stack fade-in">
      <div class="chips">${[['active', 'Активные'], ['closed', 'Закрытые'], ['all', 'Все']].map(([k, t]) => html`<button class="${k === filter ? 'active' : ''}" data-f="${k}">${t}</button>`)}</div>
      ${list.length ? html`<div class="card"><div class="list">${list.map((r) => html`<a class="item" href="#/staff/requests/${r.id}"><div class="grow"><b>${r.title}</b><div class="small muted">№ ${r.id} · ${r.full_name} · ${r.group_name} · ${relTime(r.created_at)}</div></div>${pill(r.statusLabel, STATUS_KIND[r.status])}</a>`)}</div></div>`
      : html`<div class="card">${emptyState('check', 'Очередь пуста', 'Все заявки обработаны.')}</div>`}
    </div>`;
    $$('[data-f]', main).forEach((b) => b.onclick = () => { filter = b.dataset.f; draw(); });
  };
  await draw();
}, 'staff/requests');

staffPage(/^\/staff\/requests\/(\d+)$/, async (main, m) => {
  setTitle(`Заявка № ${m[1]}`, '#/staff/requests');
  const r = await api(`/api/staff/requests/${m[1]}`);
  const NEXT = [['in_progress', 'Взять в работу', 'secondary'], ['need_info', 'Нужны уточнения', 'ghost'], ['ready', 'Готово', ''], ['done', 'Выдано / закрыть', 'ghost'], ['rejected', 'Отклонить', 'danger']];
  main.innerHTML = html`<div class="stack fade-in">
    <div class="card"><div class="between"><h2>${r.title}</h2>${pill(r.statusLabel, STATUS_KIND[r.status])}</div>
      <p class="small muted" style="margin-top:4px">${r.student.name} · ${r.student.group} · подана ${fmtDT(r.createdAt)}</p>
      <div class="list" style="margin-top:8px">${r.fields.map((x) => html`<div class="item small"><span class="muted grow">${x.label}</span><b>${x.value}</b></div>`)}</div></div>
    <div class="card"><h3 style="margin-bottom:8px">История</h3><div class="list">${r.events.map((e) => html`<div class="item small"><span class="grow"><b>${e.label}</b>${e.note ? ' · ' + e.note : ''}</span><span class="faint">${fmtDT(e.at)}</span></div>`)}</div></div>
    ${['cancelled', 'done', 'rejected'].includes(r.status) ? '' : html`<form class="card stack"><label class="field">Комментарий для студента<textarea class="input" name="comment" maxlength="1000" placeholder="Например: справка готова, заберите в каб. А-105"></textarea></label>
      <div class="btns">${NEXT.filter(([k]) => k !== r.status).map(([k, t, cls]) => html`<button class="btn sm ${cls}" type="button" data-st="${k}">${t}</button>`)}</div>
      <p class="tiny faint">Студент сразу получит уведомление о смене статуса.</p></form>`}
  </div>`;
  $$('[data-st]', main).forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try { await api(`/api/staff/requests/${r.id}`, { method: 'POST', body: { status: b.dataset.st, comment: $('textarea', main).value } }); toast('Статус обновлён, студент уведомлён'); router(); } catch (e) { toast(e.message, 'err'); b.disabled = false; }
  });
}, 'staff/requests');

staffPage(/^\/staff\/chat$/, async (main) => {
  setTitle('Обращения');
  const list = await api('/api/staff/threads');
  main.innerHTML = html`<div class="card fade-in">${list.length ? html`<div class="list">${list.map((t) => html`<a class="item" href="#/staff/chat/${t.id}"><span class="avatar">${initials(t.full_name)}</span><div class="grow"><b>${t.full_name}</b> <span class="small muted">${t.group_name}</span><div class="small muted ellipsis">${t.last_text}</div></div>${t.unread ? pill(String(t.unread), 'danger') : html`<span class="tiny faint">${relTime(t.last_at)}</span>`}</a>`)}</div>` : emptyState('chat', 'Обращений нет', '')}</div>`;
}, 'staff/chat');

staffPage(/^\/staff\/chat\/(\d+)$/, async (main, m) => {
  const draw = async () => {
    const d = await api(`/api/staff/threads/${m[1]}`);
    setTitle(d.student.full_name, '#/staff/chat');
    main.innerHTML = html`<div class="stack fade-in"><p class="small muted">${d.student.group_name}</p>
      <div class="chat">${d.messages.map((x) => html`<div class="msg ${x.mine ? 'mine' : ''}">${x.text}<small>${x.mine ? 'Деканат' : 'Студент'} · ${relTime(x.created_at)}</small></div>`)}</div>
      <form class="composer"><textarea name="text" rows="1" placeholder="Ответ студенту…" maxlength="2000" aria-label="Ответ"></textarea><button class="btn" aria-label="Отправить">${ic('send')}</button></form></div>`;
    const f = $('form', main);
    f.onsubmit = async (e) => { e.preventDefault(); const text = f.text.value.trim(); if (!text) return; await api(`/api/staff/threads/${m[1]}`, { method: 'POST', body: { text } }); await draw(); window.scrollTo(0, document.body.scrollHeight); };
  };
  await draw();
}, 'staff/chat');

function staffForm(main, title, back, fields, submit, note) {
  setTitle(title, back);
  main.innerHTML = html`<form class="stack fade-in" novalidate><div class="card stack">${fields}<div class="err" hidden>${ic('alert')}<span></span></div></div>${note ? html`<p class="tiny faint">${note}</p>` : ''}<button class="btn block">Сохранить и отправить</button></form>`;
  const f = $('form', main);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const err = $('.err', f);
    try { const r = await submit(Object.fromEntries(new FormData(f)), f); toast(r || 'Готово'); f.reset(); err.hidden = true; } catch (ex) { err.hidden = false; err.querySelector('span').textContent = ex.message; }
  };
  return f;
}

staffPage(/^\/staff\/news$/, async (main) => {
  const g = await api('/api/staff/groups');
  staffForm(main, 'Объявление', '#/staff/publish', html`
    <label class="field">Заголовок<input class="input" name="title" maxlength="140" required></label>
    <label class="field">Текст<textarea class="input" name="body" maxlength="3000" required></textarea></label>
    <label class="field">Тип<select class="input" name="category"><option value="official">Объявление деканата (важное, приходит всем)</option><option value="news">Новость</option><option value="event">Событие</option></select></label>
    <label class="field">Кому<select class="input" name="audience"><option value="all">Всем студентам</option>${g.faculties.map((x) => html`<option value="faculty:${x}">${x}</option>`)}${g.groups.map((x) => html`<option value="group:${x}">Группа ${x}</option>`)}</select></label>
    <label class="row small"><input type="checkbox" name="important" value="1"> Отметить как важное</label>`,
  async (d) => { await api('/api/staff/news', { method: 'POST', body: { ...d, important: !!d.important } }); return 'Опубликовано'; },
  'Новости и события студенты могут отключить. Объявления деканата приходят всем адресатам всегда.');
}, 'staff/publish');

staffPage(/^\/staff\/changes$/, async (main) => {
  const g = await api('/api/staff/groups');
  const f = staffForm(main, 'Изменение расписания', '#/staff/publish', html`
    <label class="field">Группа<select class="input" name="group">${g.groups.map((x) => html`<option>${x}</option>`)}</select></label>
    <div class="grid2"><label class="field">Дата<input class="input" type="date" name="date" value="${todayIso()}" required></label>
    <label class="field">Пара<select class="input" name="pair">${[1, 2, 3, 4, 5, 6].map((p) => html`<option value="${p}">${p}-я пара</option>`)}</select></label></div>
    <label class="field">Что меняется<select class="input" name="kind"><option value="cancel">Отмена занятия</option><option value="room">Смена аудитории</option><option value="replace">Замена преподавателя</option><option value="add">Доп. занятие / перенос сюда</option></select></label>
    <label class="field">Дисциплина (для доп. занятия)<input class="input" name="subject" list="subj" maxlength="120"></label><datalist id="subj"></datalist>
    <div class="grid2"><label class="field">Аудитория<input class="input" name="room" maxlength="40" placeholder="Б-201"></label><label class="field">Преподаватель<input class="input" name="teacher" maxlength="80"></label></div>
    <label class="field">Комментарий<input class="input" name="note" maxlength="300" placeholder="Причина или куда перенесено"></label>`,
  async (d) => { const r = await api('/api/staff/changes', { method: 'POST', body: d }); return `Сохранено. Уведомлено студентов: ${r.notified}`; },
  'Изменение сразу появится в расписании группы, на главной, в подписке календаря, и придёт уведомление.');
  const fill = () => { $('#subj', f).innerHTML = html`${(g.subjects[f.group.value] || []).map((s) => html`<option value="${s}">`)}`; };
  f.group.onchange = fill; fill();
}, 'staff/publish');

staffPage(/^\/staff\/tests$/, async (main) => {
  const g = await api('/api/staff/groups');
  const now = new Date(Date.now() + MSK).toISOString().slice(0, 16);
  const week = new Date(Date.now() + MSK + 7 * 86400_000).toISOString().slice(0, 16);
  const f = staffForm(main, 'Тест СДО', '#/staff/publish', html`
    <label class="field">Группа<select class="input" name="group">${g.groups.map((x) => html`<option>${x}</option>`)}</select></label>
    <label class="field">Дисциплина<input class="input" name="subject" list="subj2" maxlength="120" required></label><datalist id="subj2"></datalist>
    <label class="field">Название теста<input class="input" name="title" maxlength="160" required></label>
    <label class="field">Преподаватель<input class="input" name="teacher" maxlength="80"></label>
    <div class="grid2"><label class="field">Открывается (МСК)<input class="input" type="datetime-local" name="opens" value="${now}" required></label><label class="field">Закрывается (МСК)<input class="input" type="datetime-local" name="closes" value="${week}" required></label></div>
    <div class="grid2"><label class="field">Лимит, мин<input class="input" type="number" name="timeLimit" min="0" max="600" value="30"></label><label class="field">Попыток<input class="input" type="number" name="attempts" min="1" max="10" value="1"></label></div>`,
  async (d) => { await api('/api/staff/tests', { method: 'POST', body: d }); return 'Тест добавлен — студенты увидят его и получат напоминания'; },
  'В реальном вузе тесты подтягиваются из СДО (Moodle и др.) через адаптер автоматически. Ручное добавление — запасной вариант.');
  const fill = () => { $('#subj2', f).innerHTML = html`${(g.subjects[f.group.value] || []).map((s) => html`<option value="${s}">`)}`; };
  f.group.onchange = fill; fill();
}, 'staff/publish');

staffPage(/^\/profile$/, async (main) => {
  setTitle('Профиль');
  main.innerHTML = html`<div class="stack fade-in"><div class="card"><div class="row"><span class="avatar lg">${initials(state.me.fullName)}</span><div><h2>${state.me.fullName}</h2><p class="small muted">${state.me.program}</p></div></div></div>
    <div class="card flat small muted">${ic('shield', 'tiny-ic')} Роль «сотрудник»: доступ к заявкам и обращениям студентов. Студенческие разделы недоступны.</div>
    <button class="btn ghost block" data-logout>${ic('logout')} Выйти</button></div>`;
  $('[data-logout]', main).onclick = logout;
}, 'profile');
