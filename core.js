'use strict';
/* Ядро SPA: безопасный шаблонизатор, API, состояние, разделы, каркас, маршрутизация. */

// ---------- Шаблоны с автоэкранированием (защита от XSS) ----------
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(String(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const val = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : v == null || v === false ? '' : esc(v));
const html = (strings, ...vals) => raw(strings.reduce((a, s, i) => a + s + (i < vals.length ? val(vals[i]) : ''), ''));
const ic = (name, cls) => raw(window.icon(name, cls));
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ---------- Форматирование ----------
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WD_LONG = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MSK = 3 * 3600_000;
const mskParts = (ms) => { const d = new Date(ms + MSK); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), hh: String(d.getUTCHours()).padStart(2, '0'), mm: String(d.getUTCMinutes()).padStart(2, '0') }; };
const dateOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return { y, m: m - 1, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; };
const fmtDate = (iso, withWd) => { const p = dateOf(iso); return `${p.d} ${MONTHS[p.m]}${withWd ? ', ' + WD_SHORT[p.wd] : ''}`; };
const fmtDT = (ms) => { const p = mskParts(ms); return `${p.d} ${MONTHS[p.m]}, ${p.hh}:${p.mm}`; };
const fmtTime = (ms) => { const p = mskParts(ms); return `${p.hh}:${p.mm}`; };
const todayIso = () => { const p = mskParts(Date.now()); return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
const money = (n) => `${Number(n).toLocaleString('ru-RU')} ₽`;
function relTime(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  if (s < 7 * 86400) { const d = Math.floor(s / 86400); return d === 1 ? 'вчера' : `${d} ${plural(d, 'день', 'дня', 'дней')} назад`; }
  return fmtDT(ms);
}
function until(ms) {
  let s = Math.max(0, Math.round((ms - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d} ${plural(d, 'день', 'дня', 'дней')}${h ? ` ${h} ч` : ''}`;
  if (h > 0) return `${h} ч ${m} мин`;
  return `${Math.max(m, 1)} мин`;
}
const initials = (name) => name.split(' ').slice(0, 2).map((p) => p[0]).join('');
const firstName = (name) => name.split(' ')[1] || name;

// ---------- API ----------
class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'dekanat', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('Нет соединения с сервером. Проверьте интернет и попробуйте ещё раз.', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* пусто */ }
  if (res.status === 401 && path !== '/api/login') { state.me = null; renderLogin(); throw new ApiError('Сессия истекла, войдите снова', 401); }
  if (!res.ok) throw new ApiError(data?.error || 'Что-то пошло не так. Попробуйте ещё раз.', res.status);
  return data;
}

// ---------- Уведомления на экране ----------
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = html`${ic(kind === 'err' ? 'alert' : 'check')}<span>${msg}</span>`;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 3500);
}
function sheet(content, onMount) {
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = html`<div class="sheet" role="dialog" aria-modal="true">${content}</div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => e.key === 'Escape' && close();
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(bg);
  onMount?.(bg.firstElementChild, close);
  bg.querySelector('input, button, a')?.focus();
  return close;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  }
}

// ---------- Общие блоки ----------
const skeleton = (n = 3) => html`<div class="stack">${Array.from({ length: n }, (_, i) => html`<div class="skel" style="height:${i ? 84 : 140}px"></div>`)}</div>`;
const emptyState = (iconName, title, text, action) => html`<div class="empty"><div class="tile-ic">${ic(iconName)}</div><h3>${title}</h3>${text ? html`<p class="small">${text}</p>` : ''}${action || ''}</div>`;
function errorState(el, err, retry) {
  el.innerHTML = html`<div class="card"><div class="empty"><div class="tile-ic danger">${ic('alert')}</div><h3>Не удалось загрузить</h3><p class="small">${err.message}</p><button class="btn secondary" data-retry>${ic('refresh')} Повторить</button></div></div>`;
  $('[data-retry]', el).onclick = retry;
}
const pill = (text, kind = '', iconName) => html`<span class="pill ${kind}">${iconName ? ic(iconName) : ''}${text}</span>`;
const STATUS_KIND = { new: 'primary', in_progress: 'warn', need_info: 'danger', ready: 'ok', done: 'ok', rejected: 'danger', cancelled: '' };
const STATUS_STEP = { new: 1, in_progress: 2, need_info: 2, ready: 3, done: 4, rejected: 4, cancelled: 1 };

// ---------- Разделы кабинета и персонализация ----------
const SECTIONS = [
  { id: 'schedule', title: 'Расписание', icon: 'calendar', desc: 'Пары, переносы и сессия' },
  { id: 'grades', title: 'Успеваемость', icon: 'chart', desc: 'Баллы, оценки, прогноз' },
  { id: 'requests', title: 'Справки и заявки', short: 'Справки', icon: 'doc', desc: 'Заказ справок и статусы' },
  { id: 'tests', title: 'Тесты СДО', short: 'Тесты', icon: 'tests', desc: 'Открытые тесты и сроки' },
  { id: 'chat', title: 'Чат с деканатом', short: 'Чат', icon: 'chat', desc: 'Вопрос сотруднику' },
  { id: 'stipend', title: 'Стипендия', icon: 'coins', desc: 'Выплаты и прогноз', applies: (me) => me.funding === 'budget', na: 'только для бюджетной формы' },
  { id: 'payment', title: 'Оплата обучения', short: 'Оплата', icon: 'wallet', desc: 'График платежей', applies: (me) => me.funding === 'contract', na: 'только для договорной формы' },
  { id: 'news', title: 'Новости', icon: 'news', desc: 'Объявления и события' },
  { id: 'map', title: 'Карта кампуса', short: 'Карта', icon: 'map', desc: 'Найти аудиторию' },
  { id: 'card', title: 'Студбилет', icon: 'id', desc: 'Цифровой билет с QR' },
  { id: 'dorm', title: 'Общежитие', icon: 'building', desc: 'Комната, оплата, ремонт', applies: (me) => me.hasDorm, na: 'вы не живёте в общежитии' },
  { id: 'support', title: 'Поддержка', icon: 'heart', desc: 'Психолог, куратор, контакты' },
  { id: 'assistant', title: 'Помощник', icon: 'sparkles', desc: 'Ответы на частые вопросы' },
];
const secById = (id) => SECTIONS.find((s) => s.id === id);
const applies = (s, me = state.me) => !s.applies || s.applies(me);

const PRESETS = {
  min: { title: 'Минимум', desc: 'Только расписание и оценки. Ничего лишнего.', ids: ['schedule', 'grades'] },
  standard: { title: 'Стандарт', desc: 'Учёба, справки, тесты и то, что подходит именно вам.', ids: ['schedule', 'grades', 'requests', 'tests', 'chat', 'stipend', 'payment', 'dorm', 'card', 'support'] },
  all: { title: 'Всё сразу', desc: 'Все разделы, включая новости, карту и помощника.', ids: SECTIONS.map((s) => s.id) },
};
function presetPrefs(me, preset, base = {}) {
  const ids = new Set(PRESETS[preset].ids);
  if (preset === 'standard' && me.course === 1) ids.add('map'); // первокурсникам — карта кампуса
  const sections = SECTIONS.map((s) => ({ id: s.id, visible: ids.has(s.id) && applies(s, me) }));
  const nav = ['schedule', 'grades', 'requests'].filter((id) => sections.find((s) => s.id === id).visible);
  if (preset === 'min') nav.splice(0, nav.length, 'schedule', 'grades');
  return { theme: 'auto', reminders: [24, 3, 1], mute: { news: false, event: false }, calReminder: 15, ...base, sections, nav, preset };
}
/** Нормализация: новые разделы, которых ещё нет в сохранённых настройках, добавляются скрытыми. */
function normPrefs(p) {
  const known = new Set(p.sections.map((s) => s.id));
  return { ...p, sections: [...p.sections.filter((s) => secById(s.id)), ...SECTIONS.filter((s) => !known.has(s.id)).map((s) => ({ id: s.id, visible: false }))] };
}
const isVisible = (id) => state.role === 'staff' || !!state.prefs?.sections.find((s) => s.id === id && s.visible && applies(secById(id)));
const visibleSections = () => state.prefs.sections.filter((s) => s.visible && applies(secById(s.id))).map((s) => secById(s.id));
let saveTimer;
function savePrefs(p, now) {
  state.prefs = p;
  applyTheme();
  clearTimeout(saveTimer);
  const doSave = () => api('/api/prefs', { method: 'PUT', body: p }).then((saved) => { state.prefs = normPrefs(saved); }).catch((e) => toast(e.message, 'err'));
  if (now) return doSave();
  saveTimer = setTimeout(doSave, 400);
}
function applyTheme() {
  const t = state.prefs?.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// ---------- Состояние ----------
const state = { me: null, role: null, prefs: null, unread: 0, cache: {} };

// ---------- Каркас ----------
function navItems() {
  if (state.role === 'staff') return STAFF_NAV;
  const pinned = state.prefs.nav.filter((id) => isVisible(id)).slice(0, 3).map(secById);
  return [{ id: 'home', title: 'Главная', icon: 'home' }, ...pinned, { id: 'more', title: 'Ещё', icon: 'grid' }];
}
function renderShell() {
  const items = navItems();
  const sideList = state.role === 'staff' ? STAFF_NAV : [{ id: 'home', title: 'Главная', icon: 'home' }, ...visibleSections()];
  $('#app').innerHTML = html`
  <div class="shell">
    <nav class="sidebar" aria-label="Разделы">
      <a class="brand" href="#/home"><img src="logo.svg" alt=""><span>Деканат Next</span></a>
      ${sideList.map((s) => html`<a href="#/${s.route || s.id}" data-nav="${s.id}">${ic(s.icon)}<span>${s.title}</span></a>`)}
      <div class="sep"></div>
      ${state.role === 'student' ? html`<a href="#/notifications" data-nav="notifications">${ic('bell')}<span>Уведомления</span><span class="count" data-unread hidden></span></a>` : ''}
      <a href="#/profile" data-nav="profile">${ic('user')}<span>Профиль</span></a>
      ${state.role === 'student' ? html`<a href="#/settings/sections" data-nav="settings">${ic('settings')}<span>Разделы кабинета</span></a>` : ''}
      <p class="tiny faint" style="margin:auto 12px 0;padding-top:16px">Концепт для конкурса. Не официальный сервис вуза. Все данные вымышлены.</p>
    </nav>
    <div>
      <header class="topbar">
        <div class="title"><span class="brand-m" data-back></span><h1 id="page-title">Главная</h1></div>
        ${state.role === 'student' ? html`<button class="iconbtn" data-search aria-label="Поиск по кабинету">${ic('search')}</button>
        <a class="iconbtn" href="#/notifications" aria-label="Уведомления">${ic('bell')}<span class="dot" data-unread hidden></span></a>` : ''}
        <a href="#/profile" aria-label="Профиль"><span class="avatar">${initials(state.me.fullName)}</span></a>
      </header>
      <main id="main" tabindex="-1"></main>
      <div class="concept"><p>Деканат Next — концепт для конкурса, не официальный сервис вуза. Все ФИО и данные вымышлены.</p></div>
    </div>
    <nav class="bottomnav" aria-label="Основная навигация" style="grid-template-columns:repeat(${items.length},1fr)">
      ${items.map((s) => html`<a href="#/${s.route || s.id}" data-nav="${s.id}">${ic(s.icon)}<span>${s.short || s.title}</span></a>`)}
    </nav>
  </div>`;
  $('[data-search]')?.addEventListener('click', openSearch);
  updateUnread();
}
function setTitle(title, back) {
  document.title = `${title} — Деканат Next`;
  $('#page-title').textContent = title;
  const b = $('[data-back]');
  b.innerHTML = back ? html`<a class="iconbtn" href="${back}" aria-label="Назад">${ic('left')}</a>` : html`<img src="logo.svg" alt="" width="30" height="30">`;
}
function markNav(id) {
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === id));
}
function updateUnread() {
  $$('[data-unread]').forEach((el) => { el.hidden = !state.unread; el.textContent = state.unread > 9 ? '9+' : state.unread; });
}
async function refreshUnread() {
  if (state.role !== 'student') return;
  try { state.unread = (await api('/api/notifications')).unread; updateUnread(); } catch { /* тихо */ }
}

// ---------- Маршрутизация ----------
const ROUTES = [];
const page = (re, fn, navId) => ROUTES.push({ re, fn, navId });
const staffPage = (re, fn, navId) => ROUTES.push({ re, fn, navId, staff: true });
let timers = [];
const every = (ms, fn) => timers.push(setInterval(fn, ms));
async function router() {
  if (!state.me) return renderLogin();
  timers.forEach(clearInterval); timers = [];
  const [path, qs] = (location.hash.slice(1) || '/home').split('?');
  const query = new URLSearchParams(qs || '');
  const r = ROUTES.find((x) => x.re.test(path) && (state.role === 'staff' ? x.staff : !x.staff)) || ROUTES.find((x) => x.re.test('/home') && (state.role === 'staff' ? x.staff : !x.staff));
  const m = r.re.exec(path) || [];
  const main = $('#main');
  markNav(typeof r.navId === 'function' ? r.navId(m) : r.navId);
  main.innerHTML = skeleton();
  window.scrollTo(0, 0);
  try { await r.fn(main, m, query); } catch (e) { if (e.status !== 401) errorState(main, e, router); }
}
const go = (hash) => { if (location.hash === hash) router(); else location.hash = hash; };
/** Баннер «раздел скрыт» — если открыли скрытый раздел (через поиск или ссылку). */
function hiddenBanner(id) {
  if (isVisible(id)) return '';
  return html`<div class="card flat between" style="background:var(--surface-2)"><span class="small muted">Раздел скрыт в настройках</span><button class="btn sm secondary" data-show-section="${id}">${ic('eye')} Показать</button></div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-show-section]');
  if (!b) return;
  const p = structuredClone(state.prefs);
  p.sections.find((s) => s.id === b.dataset.showSection).visible = true;
  p.preset = 'custom';
  savePrefs(p, true).then(() => { renderShell(); router(); toast('Раздел снова в кабинете'); });
});

// ---------- Вход ----------
const DEMO = [
  { login: 'morozova', password: 'Demo-Student-1', who: 'Алина Морозова', note: 'Бюджет · общежитие · 2 курс ИВТ' },
  { login: 'lebedev', password: 'Demo-Student-2', who: 'Максим Лебедев', note: 'Контракт · 1 курс экономики' },
  { login: 'dekanat', password: 'Demo-Staff-1', who: 'Сотрудник деканата', note: 'Обработка заявок, рассылки' },
];
function renderLogin(errMsg) {
  document.title = 'Вход — Деканат Next';
  $('#app').innerHTML = html`
  <div class="login-wrap"><div class="login fade-in">
    <div class="row"><img src="logo.svg" alt="" width="52" height="52"><div><h1>Деканат Next</h1><p class="muted small">Личный кабинет студента</p></div></div>
    <span class="badge-concept">${ic('info')} Концепт для конкурса. Не официальный сервис вуза, все данные вымышлены</span>
    ${window.DEKANAT_DEMO ? html`<div class="card flat small" style="background:var(--surface-2)"><b>Демо-версия для просмотра.</b> <span class="muted">Сервер кабинета работает прямо в вашем браузере, данные хранятся только на этом устройстве. Полная серверная версия с защитой на сервере лежит в репозитории (npm start).</span> <button class="btn ghost sm" type="button" data-demo-reset style="margin-top:8px">${ic('refresh')} Сбросить демо-данные</button></div>` : ''}
    <form class="card stack" id="login-form" novalidate>
      <label class="field">Логин<input class="input" name="login" autocomplete="username" autocapitalize="none" required></label>
      <label class="field">Пароль<input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <div class="err" id="login-err" ${errMsg ? '' : 'hidden'}>${ic('alert')}<span>${errMsg || ''}</span></div>
      <button class="btn block" type="submit">Войти</button>
    </form>
    <div class="demo-acc">
      <p class="small muted">Тестовые аккаунты для жюри — нажмите, чтобы подставить:</p>
      ${DEMO.map((d) => html`<button type="button" data-demo="${d.login}"><span class="avatar">${initials(d.who)}</span><span class="grow"><b>${d.who}</b><br><span class="small muted">${d.note} · ${d.login} / ${d.password}</span></span></button>`)}
    </div>
  </div></div>`;
  const f = $('#login-form');
  $('[data-demo-reset]')?.addEventListener('click', () => { if (confirm('Вернуть демо-данные к исходным в этом браузере?')) window.dekanatDemoReset(); });
  $$('[data-demo]').forEach((b) => b.onclick = () => { const d = DEMO.find((x) => x.login === b.dataset.demo); f.login.value = d.login; f.password.value = d.password; f.querySelector('button').focus(); });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]');
    const err = $('#login-err');
    if (!f.login.value.trim() || !f.password.value) { err.hidden = false; err.querySelector('span').textContent = 'Введите логин и пароль'; return; }
    btn.disabled = true; btn.textContent = 'Входим…';
    try {
      const r = await api('/api/login', { method: 'POST', body: { login: f.login.value.trim(), password: f.password.value } });
      await startSession(r.profile);
    } catch (ex) {
      err.hidden = false; err.querySelector('span').textContent = ex.message; btn.disabled = false; btn.textContent = 'Войти';
    }
  };
}
async function startSession(profile) {
  state.me = profile; state.role = profile.role; state.cache = {};
  if (profile.role === 'student') {
    if (!profile.prefs) return renderOnboarding();
    state.prefs = normPrefs(profile.prefs);
  }
  applyTheme();
  renderShell();
  if (!location.hash || location.hash === '#/login') location.hash = '#/home'; else router();
  if (state.role === 'student') { refreshUnread(); if (!state.polling) state.polling = setInterval(refreshUnread, 60_000); }
}
async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* всё равно выходим */ }
  state.me = null; state.prefs = null; location.hash = '';
  renderLogin();
}

// ---------- Онбординг: выбор набора разделов ----------
function renderOnboarding() {
  let preset = 'standard';
  const draw = () => {
    const p = presetPrefs(state.me, preset);
    $('#app').innerHTML = html`
    <div class="login-wrap"><div class="login fade-in" style="max-width:520px">
      <div class="row"><img src="logo.svg" alt="" width="44" height="44"><span class="badge-concept">${ic('info')} Концепт для конкурса</span></div>
      <div><h1>Привет, ${firstName(state.me.fullName)}!</h1><p class="muted" style="margin-top:6px">Какой кабинет вам удобнее? Лишние разделы спрячем — всегда можно вернуть в «Профиль → Разделы кабинета».</p></div>
      <div class="stack">${Object.entries(PRESETS).map(([k, v]) => html`<button class="preset ${k === preset ? 'active' : ''}" data-preset="${k}"><b>${v.title}</b><span class="small muted">${v.desc}</span></button>`)}</div>
      <div class="card flat"><p class="small muted" style="margin-bottom:8px">Будет в кабинете:</p><div class="btns">${p.sections.filter((s) => s.visible).map((s) => pill(secById(s.id).title, 'primary', secById(s.id).icon))}</div>
      ${state.me.funding === 'contract' ? html`<p class="tiny faint" style="margin-top:8px">«Стипендия» не показывается: у вас договорная форма. Зато есть «Оплата обучения».</p>` : html`<p class="tiny faint" style="margin-top:8px">«Оплата обучения» скрыта: вы учитесь на бюджете.</p>`}</div>
      <button class="btn block" data-done>Готово</button>
    </div></div>`;
    $$('[data-preset]').forEach((b) => b.onclick = () => { preset = b.dataset.preset; draw(); });
    $('[data-done]').onclick = async () => {
      await savePrefs(presetPrefs(state.me, preset), true);
      state.me.prefs = state.prefs;
      startSession({ ...state.me });
    };
  };
  draw();
}

// ---------- Поиск по кабинету ----------
const SEARCH_EXTRA = [
  { t: 'Заказать справку об обучении', h: '#/requests/new/study', k: 'справка обучение место' },
  { t: 'Справка в военкомат', h: '#/requests/new/military', k: 'военкомат отсрочка' },
  { t: 'Пропуск по уважительной причине', h: '#/requests/new/absence', k: 'болел пропуск больничный', s: 'requests' },
  { t: 'Расписание сессии', h: '#/schedule?tab=session', k: 'экзамен зачёт сессия', s: 'schedule' },
  { t: 'Подключить Google / Яндекс Календарь', h: '#/calendar', k: 'календарь google яндекс ics экспорт', s: 'schedule' },
  { t: 'Изменения в расписании', h: '#/schedule?tab=changes', k: 'перенос отмена замена', s: 'schedule' },
  { t: 'Настроить разделы и нижнее меню', h: '#/settings/sections', k: 'скрыть раздел меню настройка' },
  { t: 'Тема оформления, напоминания', h: '#/settings', k: 'тёмная тема напоминания уведомления' },
];
function openSearch() {
  sheet(html`<div class="stack"><div class="search-box">${ic('search')}<input id="sq" placeholder="Раздел, справка, вопрос…" autocomplete="off" aria-label="Поиск"><button class="iconbtn" data-close aria-label="Закрыть">${ic('x')}</button></div><div id="sres"></div></div>`, (el, close) => {
    const input = $('#sq', el), out = $('#sres', el);
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const secs = SECTIONS.filter((s) => applies(s) && (!q || (s.title + ' ' + s.desc).toLowerCase().includes(q)));
      const extra = q ? SEARCH_EXTRA.filter((x) => (x.t + ' ' + x.k).toLowerCase().includes(q)) : [];
      out.innerHTML = html`<div class="list">
        ${secs.map((s) => html`<a class="item" href="#/${s.id}" data-go><div class="tile-ic">${ic(s.icon)}</div><div class="grow"><b>${s.title}</b><div class="small muted">${s.desc}</div></div>${isVisible(s.id) ? ic('right', 'chev') : pill('скрыт', '', 'eyeOff')}</a>`)}
        ${extra.map((x) => html`<a class="item" href="${x.h}" data-go><div class="tile-ic teal">${ic('right')}</div><div class="grow"><b>${x.t}</b></div></a>`)}
        ${q ? html`<a class="item" href="#/assistant?q=${encodeURIComponent(q)}" data-go><div class="tile-ic">${ic('sparkles')}</div><div class="grow"><b>Спросить помощника</b><div class="small muted ellipsis">«${input.value.trim()}»</div></div></a>` : ''}
      </div>`;
      $$('[data-go]', out).forEach((a) => a.addEventListener('click', close));
    };
    input.oninput = draw; draw();
  });
}

// ---------- Запуск ----------
window.addEventListener('hashchange', router);
document.addEventListener('DOMContentLoaded', async () => {
  try { await startSession(await api('/api/me')); } catch { renderLogin(); }
});
