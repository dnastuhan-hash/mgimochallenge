// Маршруты API «Деканата Next», не зависящие от платформы.
// Один и тот же код работает в Node.js (server/index.js) и прямо в браузере (demo/browser-server.js — демо для GitHub Pages).
// Каждый обработчик получает ctx = { params, query, body, user, sid, ip, baseUrl } и берёт пользователя только из сессии.
import * as L from './logic.js';
import { CALENDAR_PROVIDERS, buildIcs } from './ics.js';
import { addDays, isoDate, mskToday } from './time.js';

export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const fail = (status, message) => { throw new HttpError(status, message); };
export const SESSION_TTL = 7 * 24 * 3600_000;

/** Сравнение строк за постоянное время (защита от атак по времени). */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * deps: { db, verifyPassword, randomToken, sha256, sign, rateLimit, resetRate }
 * sha256/sign/verifyPassword могут быть асинхронными (в браузере — WebCrypto).
 */
export function createApi({ db, verifyPassword, randomToken, sha256, sign, rateLimit, resetRate }) {
  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, handler });
  };
  const requireUser = (ctx) => ctx.user || fail(401, 'Требуется вход');
  const requireStudent = (ctx) => (requireUser(ctx).role === 'student' ? ctx.user : fail(403, 'Раздел доступен только студентам'));
  const requireStaff = (ctx) => (requireUser(ctx).role === 'staff' ? ctx.user : fail(403, 'Недостаточно прав'));
  const prefsOf = (u) => { try { return u.prefs ? JSON.parse(u.prefs) : null; } catch { return null; } };
  const extraOf = (u) => { try { return JSON.parse(u.extra || '{}'); } catch { return {}; } };

  function publicProfile(u) {
    const extra = extraOf(u);
    return {
      id: u.id, role: u.role, fullName: u.full_name, faculty: u.faculty, program: u.program, course: u.course, group: u.group_name,
      funding: u.funding, recordBook: u.record_book, email: u.email, hasDorm: !!extra.dorm, prefs: prefsOf(u),
    };
  }


  route('POST', '/api/login', async (ctx) => {
    const { login, password } = ctx.body;
    if (typeof login !== 'string' || typeof password !== 'string' || !login || !password) fail(400, 'Введите логин и пароль');
    const key = `${ctx.ip}|${login.toLowerCase()}`;
    const rl = rateLimit(key);
    if (!rl.ok) fail(429, `Слишком много попыток. Попробуйте через ${Math.ceil(rl.retryAfter / 60)} мин.`);
    const user = db.prepare('SELECT * FROM users WHERE login = ?').get(login.trim().toLowerCase());
    const ok = await verifyPassword(password, user?.pass_hash);
    if (!user || !ok) fail(401, 'Неверный логин или пароль');
    resetRate(key);
    const token = randomToken(32);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(await sha256(token), user.id, Date.now() + SESSION_TTL);
    return { body: { ok: true, profile: publicProfile(user) }, setSession: token };
  });

  route('POST', '/api/logout', async (ctx) => {
    const sid = ctx.sid;
    if (sid) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(await sha256(sid));
    return { body: { ok: true }, setSession: '' };
  });

  route('GET', '/api/me', (ctx) => publicProfile(requireUser(ctx)));

  const SECTION_IDS = ['schedule', 'grades', 'requests', 'tests', 'chat', 'stipend', 'payment', 'news', 'map', 'card', 'dorm', 'support', 'assistant'];
  route('PUT', '/api/prefs', async (ctx) => {
    const u = requireUser(ctx);
    const b = ctx.body;
    const clean = {
      sections: Array.isArray(b.sections) ? b.sections.filter((s) => SECTION_IDS.includes(s?.id)).map((s) => ({ id: s.id, visible: !!s.visible })).slice(0, 30) : [],
      nav: Array.isArray(b.nav) ? b.nav.filter((id) => SECTION_IDS.includes(id)).slice(0, 3) : [],
      theme: ['light', 'dark', 'auto'].includes(b.theme) ? b.theme : 'auto',
      reminders: Array.isArray(b.reminders) ? b.reminders.map(Number).filter((h) => [1, 3, 6, 12, 24, 48].includes(h)).slice(0, 4) : [24, 3, 1],
      mute: { news: !!b.mute?.news, event: !!b.mute?.event },
      calReminder: [0, 10, 15, 30, 60].includes(Number(b.calReminder)) ? Number(b.calReminder) : 15,
      preset: ['min', 'standard', 'all', 'custom'].includes(b.preset) ? b.preset : 'custom',
      onboarded: true,
    };
    db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify(clean), u.id);
    return clean;
  });

  route('GET', '/api/home', (ctx) => {
    const u = requireStudent(ctx);
    const today = mskToday();
    const tests = L.testsFor(db, u);
    const reqs = db.prepare("SELECT id, title, status, updated_at FROM requests WHERE user_id = ? AND status NOT IN ('done','cancelled','rejected') ORDER BY updated_at DESC LIMIT 5").all(u.id);
    const g = L.gradesFor(db, u);
    const next = L.nextLessons(db, u, 1)[0] || null;
    const pay = u.funding === 'contract' ? db.prepare('SELECT title, amount, due FROM payments WHERE user_id = ? AND paid_at IS NULL ORDER BY due LIMIT 1').get(u.id) : null;
    const exams = L.sessionExams(db, u);
    const firstExam = exams.find((e) => e.date >= isoDate(today));
    return {
      today: { date: isoDate(today), lessons: L.dayLessons(db, u.group_name, today) },
      nextDay: (() => { for (let i = 1; i < 10; i++) { const d = addDays(today, i); const ls = L.dayLessons(db, u.group_name, d); if (ls.length) return { date: isoDate(d), lessons: ls }; } return null; })(),
      next, changes: L.upcomingChanges(db, u).slice(0, 4),
      hotTests: tests.open.filter((t) => t.result !== 'done'),
      requests: reqs.map((r) => ({ ...r, statusLabel: L.STATUS[r.status] })),
      grades: { averagePoints: g.summary.averagePoints, gpa: g.summary.gpa, risks: g.summary.risks },
      stipend: L.stipendFor(db, u), payment: pay,
      session: firstExam ? { first: firstExam, daysLeft: Math.round((Date.parse(firstExam.date) - today.getTime()) / 86400000) } : null,
      news: L.newsFor(db, u).filter((n) => n.important || n.category === 'official').slice(0, 2),
    };
  });

  route('GET', '/api/schedule', (ctx) => {
    const u = requireStudent(ctx);
    const offset = Math.max(-4, Math.min(20, parseInt(ctx.query.get('week') || '0', 10) || 0));
    return { ...L.weekSchedule(db, u, offset), changes: L.upcomingChanges(db, u), session: L.sessionExams(db, u), group: u.group_name };
  });

  route('GET', '/api/grades', (ctx) => L.gradesFor(db, requireStudent(ctx)));
  route('GET', '/api/stipend', (ctx) => L.stipendFor(db, requireStudent(ctx)));

  route('GET', '/api/payments', (ctx) => {
    const u = requireStudent(ctx);
    if (u.funding !== 'contract') return { applicable: false, items: [] };
    const items = db.prepare('SELECT id, title, amount, due, paid_at FROM payments WHERE user_id = ? ORDER BY due').all(u.id);
    return { applicable: true, items, total: items.reduce((s, p) => s + p.amount, 0), paid: items.filter((p) => p.paid_at).reduce((s, p) => s + p.amount, 0) };
  });

  route('GET', '/api/dorm', (ctx) => ({ dorm: extraOf(requireStudent(ctx)).dorm || null }));

  // --- Заявки: студент видит и меняет только свои (проверка user_id в каждом запросе) ---
  route('GET', '/api/request-types', (ctx) => L.availableTypes(requireStudent(ctx)));
  route('GET', '/api/requests', (ctx) => {
    const u = requireStudent(ctx);
    return db.prepare('SELECT id, type, title, status, created_at, updated_at FROM requests WHERE user_id = ? ORDER BY updated_at DESC').all(u.id)
      .map((r) => ({ ...r, statusLabel: L.STATUS[r.status] }));
  });
  function requestDetails(id, where) {
    const r = db.prepare(`SELECT r.*, u.full_name, u.group_name FROM requests r JOIN users u ON u.id = r.user_id WHERE r.id = ? ${where.sql}`).get(id, ...where.args);
    if (!r) fail(404, 'Заявка не найдена'); // одинаковый ответ для «нет такой» и «чужая» — нельзя перебрать чужие номера
    const type = L.REQUEST_TYPES.find((t) => t.id === r.type);
    const details = JSON.parse(r.details);
    return {
      id: r.id, type: r.type, title: r.title, status: r.status, statusLabel: L.STATUS[r.status], staffComment: r.staff_comment,
      createdAt: r.created_at, updatedAt: r.updated_at, slaDays: type?.days, student: { name: r.full_name, group: r.group_name },
      fields: (type?.fields || []).filter((f) => details[f.name] != null).map((f) => ({ label: f.label, value: f.options ? (f.options.find((o) => o[0] === String(details[f.name]))?.[1] ?? details[f.name]) : details[f.name] })),
      events: db.prepare('SELECT status, note, at FROM request_events WHERE request_id = ? ORDER BY at').all(r.id).map((e) => ({ ...e, label: L.STATUS[e.status] })),
    };
  }
  route('GET', '/api/requests/:id', (ctx) => {
    const u = requireStudent(ctx);
    return requestDetails(Number(ctx.params.id), { sql: 'AND r.user_id = ?', args: [u.id] });
  });
  route('POST', '/api/requests', async (ctx) => {
    const u = requireStudent(ctx);
    const b = ctx.body;
    const type = L.availableTypes(u).find((t) => t.id === b.type) || fail(400, 'Такой тип заявки недоступен');
    const v = L.validateRequest(type, b.data);
    if (v.error) fail(400, v.error);
    const open = db.prepare("SELECT COUNT(*) c FROM requests WHERE user_id = ? AND status IN ('new','in_progress','need_info')").get(u.id).c;
    if (open >= 15) fail(429, 'Слишком много открытых заявок. Дождитесь обработки текущих.');
    const now = Date.now();
    const id = db.prepare("INSERT INTO requests (user_id, type, title, details, status, created_at, updated_at) VALUES (?,?,?,?, 'new', ?, ?)").run(u.id, type.id, type.title, JSON.stringify(v.data), now, now).lastInsertRowid;
    db.prepare("INSERT INTO request_events (request_id, status, note, at) VALUES (?, 'new', 'Заявка создана', ?)").run(id, now);
    return { id: Number(id) };
  });
  route('POST', '/api/requests/:id/cancel', (ctx) => {
    const u = requireStudent(ctx);
    const r = db.prepare('SELECT * FROM requests WHERE id = ? AND user_id = ?').get(Number(ctx.params.id), u.id) || fail(404, 'Заявка не найдена');
    if (!['new', 'need_info'].includes(r.status)) fail(409, 'Заявку уже взяли в работу — отменить нельзя, напишите в чат деканата');
    const now = Date.now();
    db.prepare("UPDATE requests SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, r.id);
    db.prepare("INSERT INTO request_events (request_id, status, note, at) VALUES (?, 'cancelled', 'Отменена студентом', ?)").run(r.id, now);
    return { ok: true };
  });

  // --- Уведомления и новости ---
  route('GET', '/api/notifications', (ctx) => {
    const u = requireStudent(ctx);
    return L.notificationsFor(db, u, prefsOf(u));
  });
  route('POST', '/api/notifications/read', async (ctx) => {
    const u = requireStudent(ctx);
    const { keys } = ctx.body;
    const list = Array.isArray(keys) ? keys : L.notificationsFor(db, u, prefsOf(u)).items.map((n) => n.key);
    const ins = db.prepare('INSERT OR IGNORE INTO reads (user_id, key) VALUES (?, ?)');
    for (const k of list.slice(0, 300)) if (typeof k === 'string' && k.length < 64) ins.run(u.id, k);
    return { ok: true };
  });
  route('GET', '/api/news', (ctx) => L.newsFor(db, requireStudent(ctx)));

  // --- Тесты СДО ---
  route('GET', '/api/tests', (ctx) => L.testsFor(db, requireStudent(ctx)));
  route('POST', '/api/tests/:id/done', (ctx) => {
    const u = requireStudent(ctx);
    const t = db.prepare('SELECT id FROM lms_tests WHERE id = ? AND group_name = ?').get(Number(ctx.params.id), u.group_name) || fail(404, 'Тест не найден');
    db.prepare("INSERT INTO lms_status (user_id, test_id, status, score) VALUES (?, ?, 'done', NULL) ON CONFLICT(user_id, test_id) DO UPDATE SET status = 'done'").run(u.id, t.id);
    return { ok: true };
  });

  // --- Чат с деканатом ---
  route('GET', '/api/messages', (ctx) => {
    const u = requireStudent(ctx);
    db.prepare('UPDATE messages SET read_by_student = 1 WHERE student_id = ?').run(u.id);
    return db.prepare('SELECT m.id, m.text, m.created_at, m.author_id = ? AS mine, a.full_name author FROM messages m JOIN users a ON a.id = m.author_id WHERE m.student_id = ? ORDER BY m.created_at').all(u.id, u.id)
      .map((m) => ({ ...m, mine: !!m.mine, author: m.mine ? 'Вы' : 'Деканат · ' + m.author.split(' ').slice(0, 2).join(' ') }));
  });
  route('POST', '/api/messages', async (ctx) => {
    const u = requireStudent(ctx);
    const { text } = ctx.body;
    const t = String(text || '').trim();
    if (!t || t.length > 2000) fail(400, 'Сообщение пустое или слишком длинное');
    db.prepare('INSERT INTO messages (student_id, author_id, text, created_at, read_by_student) VALUES (?,?,?,?,1)').run(u.id, u.id, t, Date.now());
    return { ok: true };
  });

  // --- Календарь ---
  route('GET', '/api/calendar', (ctx) => {
    const u = requireStudent(ctx);
    const https = `${ctx.baseUrl}/cal/${u.cal_token}.ics`;
    const webcal = https.replace(/^https?:/, 'webcal:');
    return {
      https, webcal,
      // в query-параметр ссылка кодируется, а как самостоятельный адрес — нет
      providers: CALENDAR_PROVIDERS.map((p) => ({ ...p, href: p.url.startsWith('{')
        ? p.url.replace('{webcal}', webcal).replace('{https}', https)
        : p.url.replace('{webcal}', encodeURIComponent(webcal)).replace('{https}', encodeURIComponent(https)) })),
    };
  });
  route('POST', '/api/calendar/reset', (ctx) => {
    const u = requireStudent(ctx);
    db.prepare('UPDATE users SET cal_token = ? WHERE id = ?').run(randomToken(32), u.id);
    return { ok: true };
  });
  route('GET', '/cal/:token', (ctx) => {
    const token = ctx.params.token.replace(/\.ics$/, '');
    const u = /^[\w-]{20,64}$/.test(token) && db.prepare("SELECT * FROM users WHERE cal_token = ? AND role = 'student'").get(token);
    if (!u) fail(404, 'Календарь не найден');
    const download = ctx.query.has('download');
    return { raw: buildIcs(db, u, prefsOf(u)), headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache', ...(download ? { 'Content-Disposition': 'attachment; filename="raspisanie.ics"' } : {}) } };
  });

  // --- Цифровой студбилет: QR со ссылкой, подписанной HMAC, действует 5 минут ---
  route('GET', '/api/card', async (ctx) => {
    const u = requireStudent(ctx);
    const exp = Date.now() + 5 * 60_000;
    const payload = `${u.id}.${exp}`;
    return { url: `${ctx.baseUrl}/verify.html#${payload}.${await sign(payload)}`, expiresAt: exp, validUntil: '31.08.2029', recordBook: u.record_book, fullName: u.full_name, faculty: u.faculty, group: u.group_name, course: u.course, funding: u.funding };
  });
  route('GET', '/api/verify/:token', async (ctx) => {
    const [id, exp, sig] = ctx.params.token.split('.');
    const payload = `${id}.${exp}`;
    const valid = sig && sig.length === 22 && safeEqual(await sign(payload), sig) && Number(exp) > Date.now();
    if (!valid) return { valid: false };
    const u = db.prepare("SELECT full_name, group_name, faculty FROM users WHERE id = ? AND role = 'student'").get(Number(id));
    // проверяющему показываем минимум: ФИО (сокращённо), группа, факультет
    return u ? { valid: true, name: u.full_name.split(' ').map((p, i) => (i ? p[0] + '.' : p)).join(' '), group: u.group_name, faculty: u.faculty } : { valid: false };
  });

  route('GET', '/api/assistant', (ctx) => L.assistant(db, requireStudent(ctx), ctx.query.get('q')));

  // ---------- Кабинет сотрудника ----------
  route('GET', '/api/staff/summary', (ctx) => {
    requireStaff(ctx);
    const c = (sql) => db.prepare(sql).get().c;
    return {
      newRequests: c("SELECT COUNT(*) c FROM requests WHERE status = 'new'"),
      inProgress: c("SELECT COUNT(*) c FROM requests WHERE status IN ('in_progress','need_info')"),
      unreadChats: c('SELECT COUNT(DISTINCT student_id) c FROM messages WHERE read_by_staff = 0'),
      students: c("SELECT COUNT(*) c FROM users WHERE role = 'student'"),
    };
  });
  route('GET', '/api/staff/requests', (ctx) => {
    requireStaff(ctx);
    const st = ctx.query.get('status');
    const rows = db.prepare(`SELECT r.id, r.title, r.status, r.created_at, r.updated_at, u.full_name, u.group_name FROM requests r JOIN users u ON u.id = r.user_id
      ${st === 'active' ? "WHERE r.status IN ('new','in_progress','need_info')" : st === 'closed' ? "WHERE r.status IN ('ready','done','rejected','cancelled')" : ''} ORDER BY r.status = 'new' DESC, r.updated_at DESC LIMIT 200`).all();
    return rows.map((r) => ({ ...r, statusLabel: L.STATUS[r.status] }));
  });
  route('GET', '/api/staff/requests/:id', (ctx) => (requireStaff(ctx), requestDetails(Number(ctx.params.id), { sql: '', args: [] })));
  route('POST', '/api/staff/requests/:id', async (ctx) => {
    requireStaff(ctx);
    const b = ctx.body;
    const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(Number(ctx.params.id)) || fail(404, 'Заявка не найдена');
    if (!['in_progress', 'need_info', 'ready', 'done', 'rejected'].includes(b.status)) fail(400, 'Неизвестный статус');
    const comment = String(b.comment || '').trim().slice(0, 1000) || null;
    const now = Date.now();
    db.prepare('UPDATE requests SET status = ?, staff_comment = COALESCE(?, staff_comment), updated_at = ? WHERE id = ?').run(b.status, comment, now, r.id);
    db.prepare('INSERT INTO request_events (request_id, status, note, at) VALUES (?,?,?,?)').run(r.id, b.status, comment, now);
    const titles = { in_progress: 'взята в работу', need_info: 'нужны уточнения', ready: 'готова', done: 'закрыта', rejected: 'отклонена' };
    db.prepare("INSERT INTO notifications (user_id, category, title, body, link, created_at) VALUES (?, 'request', ?, ?, ?, ?)")
      .run(r.user_id, `${r.title}: ${titles[b.status]}`, comment || 'Статус заявки обновлён.', `#/requests/${r.id}`, now);
    return { ok: true };
  });
  route('GET', '/api/staff/threads', (ctx) => {
    requireStaff(ctx);
    return db.prepare(`SELECT u.id, u.full_name, u.group_name, MAX(m.created_at) last_at, SUM(m.read_by_staff = 0) unread,
        (SELECT text FROM messages WHERE student_id = u.id ORDER BY created_at DESC LIMIT 1) last_text
      FROM messages m JOIN users u ON u.id = m.student_id GROUP BY u.id ORDER BY unread > 0 DESC, last_at DESC`).all();
  });
  route('GET', '/api/staff/threads/:sid', (ctx) => {
    requireStaff(ctx);
    const sid = Number(ctx.params.sid);
    const st = db.prepare("SELECT id, full_name, group_name FROM users WHERE id = ? AND role = 'student'").get(sid) || fail(404, 'Студент не найден');
    db.prepare('UPDATE messages SET read_by_staff = 1 WHERE student_id = ?').run(sid);
    return { student: st, messages: db.prepare('SELECT id, text, created_at, author_id != ? AS mine FROM messages WHERE student_id = ? ORDER BY created_at').all(sid, sid).map((m) => ({ ...m, mine: !!m.mine })) };
  });
  route('POST', '/api/staff/threads/:sid', async (ctx) => {
    const staff = requireStaff(ctx);
    const sid = Number(ctx.params.sid);
    db.prepare("SELECT id FROM users WHERE id = ? AND role = 'student'").get(sid) || fail(404, 'Студент не найден');
    const t = String((ctx.body).text || '').trim();
    if (!t || t.length > 2000) fail(400, 'Сообщение пустое или слишком длинное');
    db.prepare('INSERT INTO messages (student_id, author_id, text, created_at, read_by_staff) VALUES (?,?,?,?,1)').run(sid, staff.id, t, Date.now());
    return { ok: true };
  });
  route('GET', '/api/staff/groups', (ctx) => {
    requireStaff(ctx);
    const groups = db.prepare('SELECT DISTINCT group_name FROM lessons ORDER BY group_name').all().map((g) => g.group_name);
    const faculties = db.prepare("SELECT DISTINCT faculty FROM users WHERE role = 'student' ORDER BY faculty").all().map((f) => f.faculty);
    const subjects = Object.fromEntries(groups.map((g) => [g, [...new Set(db.prepare('SELECT subject FROM lessons WHERE group_name = ?').all(g).map((r) => r.subject))]]));
    return { groups, faculties, subjects };
  });
  route('POST', '/api/staff/news', async (ctx) => {
    const staff = requireStaff(ctx);
    const b = ctx.body;
    const title = String(b.title || '').trim().slice(0, 140), body = String(b.body || '').trim().slice(0, 3000);
    if (!title || !body) fail(400, 'Заполните заголовок и текст');
    if (!['official', 'news', 'event'].includes(b.category)) fail(400, 'Неизвестная категория');
    const aud = String(b.audience || 'all');
    if (!/^(all|faculty:.{1,100}|group:.{1,30})$/.test(aud)) fail(400, 'Неизвестная аудитория');
    db.prepare('INSERT INTO news (title, body, audience, category, important, author_id, created_at) VALUES (?,?,?,?,?,?,?)').run(title, body, aud, b.category, b.important ? 1 : 0, staff.id, Date.now());
    return { ok: true };
  });
  route('POST', '/api/staff/changes', async (ctx) => {
    requireStaff(ctx);
    const b = ctx.body;
    const group = String(b.group || '');
    if (!db.prepare('SELECT 1 FROM lessons WHERE group_name = ? LIMIT 1').get(group)) fail(400, 'Группа не найдена');
    if (!/^\d{4}-\d\d-\d\d$/.test(b.date || '')) fail(400, 'Укажите дату');
    const pair = Number(b.pair);
    if (!(pair >= 1 && pair <= 6)) fail(400, 'Укажите пару');
    if (!['cancel', 'room', 'replace', 'add'].includes(b.kind)) fail(400, 'Неизвестный тип изменения');
    const s = (v, n = 120) => (v ? String(v).trim().slice(0, n) : null);
    if (b.kind === 'room' && !s(b.room)) fail(400, 'Укажите новую аудиторию');
    if (b.kind === 'add' && (!s(b.subject) || !s(b.room))) fail(400, 'Укажите дисциплину и аудиторию');
    const now = Date.now();
    db.prepare('INSERT INTO changes (group_name, date, pair, kind, subject, lesson_kind, room, teacher, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(group, b.date, pair, b.kind, s(b.subject), s(b.lessonKind) || 'Занятие', s(b.room), s(b.teacher), s(b.note, 300), now);
    const kinds = { cancel: 'Занятие отменено', room: 'Изменение аудитории', replace: 'Замена преподавателя', add: 'Дополнительное занятие' };
    const d = b.date.split('-').reverse().slice(0, 2).join('.');
    const ins = db.prepare("INSERT INTO notifications (user_id, category, title, body, link, created_at) VALUES (?, 'schedule', ?, ?, '#/schedule', ?)");
    const students = db.prepare("SELECT id FROM users WHERE role = 'student' AND group_name = ?").all(group);
    for (const st of students) ins.run(st.id, `${kinds[b.kind]}: ${d}, ${pair}-я пара`, [s(b.subject), s(b.room) && `ауд. ${s(b.room)}`, s(b.note, 300)].filter(Boolean).join(' · ') || 'Проверьте расписание', now);
    return { ok: true, notified: students.length };
  });
  route('POST', '/api/staff/tests', async (ctx) => {
    const staff = requireStaff(ctx);
    const b = ctx.body;
    const group = String(b.group || '');
    if (!db.prepare('SELECT 1 FROM lessons WHERE group_name = ? LIMIT 1').get(group)) fail(400, 'Группа не найдена');
    const opens = Date.parse(b.opens + ':00+03:00'), closes = Date.parse(b.closes + ':00+03:00');
    if (!opens || !closes || closes <= opens) fail(400, 'Проверьте время открытия и закрытия');
    const title = String(b.title || '').trim().slice(0, 160), subject = String(b.subject || '').trim().slice(0, 120);
    if (!title || !subject) fail(400, 'Укажите дисциплину и название теста');
    db.prepare("INSERT INTO lms_tests (group_name, subject, teacher, title, opens, closes, time_limit, attempts, source, created_by) VALUES (?,?,?,?,?,?,?,?, 'moodle-demo', ?)")
      .run(group, subject, String(b.teacher || '').slice(0, 80) || null, title, String(opens), String(closes), Number(b.timeLimit) || null, Number(b.attempts) || 1, staff.id);
    return { ok: true };
  });

  /** Пользователь по токену сессии. В базе хранится только SHA-256 токена. */
  async function userBySession(sid) {
    if (!sid) return null;
    const row = db.prepare('SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(await sha256(sid));
    return row && row.expires_at >= Date.now() ? row : null;
  }

  /** Найти маршрут и выполнить. Возвращает { status, body, raw?, setSession? }. */
  async function handle(method, pathname, { query = new URLSearchParams(), body = {}, sid = null, ip = '', baseUrl = '' } = {}) {
    const r = routes.find((x) => x.method === method && x.re.test(pathname));
    if (!r) return null;
    const m = r.re.exec(pathname);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const ctx = { params, query, body: body || {}, sid, ip, baseUrl, user: await userBySession(sid) };
    try {
      const out = await r.handler(ctx);
      if (out?.raw != null) return { status: 200, raw: out.raw, headers: out.headers };
      if (out && 'setSession' in out) return { status: 200, body: out.body, setSession: out.setSession };
      return { status: 200, body: out ?? { ok: true } };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
      console.error(e);
      return { status: 500, body: { error: 'Внутренняя ошибка сервера. Попробуйте ещё раз.' } };
    }
  }
  return { handle };
}
