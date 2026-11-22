// Предметная логика кабинета. Каждая функция получает user (из сессии) — данные других пользователей сюда не попадают.
import { BELLS, DAY, addDays, isoDate, mondayOf, mskNow, mskToEpoch, mskToday, resolveRel, weekParity, weekday } from './time.js';

const WEEKDAYS = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

// ---------------- Расписание ----------------
function groupWorkdays(db, group) {
  return new Set(db.prepare('SELECT DISTINCT weekday FROM lessons WHERE group_name = ?').all(group).map((r) => r.weekday));
}

/** 'next:N' → N-й учебный день группы начиная с сегодня (для «живых» демо-изменений). */
function resolveChangeDate(spec, workdays) {
  if (!spec.startsWith('next:')) return spec;
  let n = Number(spec.slice(5));
  let d = mskToday();
  for (let i = 0; i < 30; i++, d = addDays(d, 1)) {
    if (!workdays.has(weekday(d))) continue;
    if (n === 0) return isoDate(d);
    n--;
  }
  return isoDate(d);
}

export function changesFor(db, group) {
  const wd = groupWorkdays(db, group);
  return db.prepare('SELECT * FROM changes WHERE group_name = ? ORDER BY created_at DESC').all(group)
    .map((c) => ({ ...c, date: resolveChangeDate(c.date, wd) }));
}

export function dayLessons(db, group, date, changes = changesFor(db, group)) {
  const wdNum = weekday(date);
  const parity = weekParity(date).parity;
  const ds = isoDate(date);
  const base = db.prepare("SELECT * FROM lessons WHERE group_name = ? AND weekday = ? AND (parity = 'all' OR parity = ?) ORDER BY pair")
    .all(group, wdNum, parity);
  const list = base.map((l) => ({ pair: l.pair, subject: l.subject, kind: l.kind, room: l.room, teacher: l.teacher, change: null }));
  for (const c of changes.filter((c) => c.date === ds)) {
    const idx = list.findIndex((l) => l.pair === c.pair);
    if (c.kind === 'add') {
      const item = { pair: c.pair, subject: c.subject, kind: c.lesson_kind || 'Занятие', room: c.room, teacher: c.teacher, change: { kind: 'add', note: c.note } };
      if (idx >= 0) list[idx] = item; else list.push(item);
    } else if (idx >= 0) {
      const l = list[idx];
      if (c.kind === 'cancel') l.change = { kind: 'cancel', note: c.note };
      if (c.kind === 'room') l.change = { kind: 'room', note: c.note, old: l.room }, (l.room = c.room);
      if (c.kind === 'replace') {
        l.change = { kind: 'replace', note: c.note, old: l.teacher };
        if (c.teacher) l.teacher = c.teacher;
        if (c.subject) l.subject = c.subject;
        if (c.room) l.room = c.room;
      }
    }
  }
  list.sort((a, b) => a.pair - b.pair);
  return list.map((l) => {
    const [start, end] = BELLS[l.pair];
    return { ...l, start, end, startAt: mskToEpoch(ds, start), endAt: mskToEpoch(ds, end) };
  });
}

export function weekSchedule(db, user, offset = 0) {
  const monday = addDays(mondayOf(mskToday()), offset * 7);
  const changes = changesFor(db, user.group_name);
  const today = isoDate(mskToday());
  const days = [];
  for (let i = 0; i < 6; i++) {
    const d = addDays(monday, i);
    days.push({ date: isoDate(d), weekday: WEEKDAYS[i + 1], isToday: isoDate(d) === today, lessons: dayLessons(db, user.group_name, d, changes) });
  }
  const wp = weekParity(monday);
  return { offset, weekNumber: wp.number, parity: wp.parity, days, bells: BELLS };
}

export function upcomingChanges(db, user) {
  const today = isoDate(mskToday());
  return changesFor(db, user.group_name).filter((c) => c.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.pair - b.pair);
}

/** Ближайшие занятия (для главной и ассистента). */
export function nextLessons(db, user, count = 1) {
  const now = Date.now();
  const res = [];
  const changes = changesFor(db, user.group_name);
  for (let i = 0; i < 14 && res.length < count; i++) {
    const d = addDays(mskToday(), i);
    for (const l of dayLessons(db, user.group_name, d, changes)) {
      if (l.change?.kind === 'cancel') continue;
      if (l.endAt > now) res.push({ ...l, date: isoDate(d), weekday: WEEKDAYS[weekday(d)] });
      if (res.length >= count) break;
    }
  }
  return res;
}

export function sessionExams(db, user) {
  return db.prepare('SELECT date, time, kind, subject, room, teacher FROM exams WHERE group_name = ? ORDER BY date, time').all(user.group_name);
}

// ---------------- Успеваемость ----------------
export const POINTS_SCALE = [
  { min: 85, mark: '5', label: 'отлично' },
  { min: 70, mark: '4', label: 'хорошо' },
  { min: 55, mark: '3', label: 'удовлетворительно' },
  { min: 0, mark: '2', label: 'неудовлетворительно' },
];
export const ADMISSION = 40; // баллов для допуска к экзамену/зачёту
export const markFor = (p) => POINTS_SCALE.find((s) => p >= s.min);

export function gradesFor(db, user) {
  const rows = db.prepare('SELECT * FROM grades WHERE user_id = ? ORDER BY semester DESC, subject').all(user.id);
  const items = db.prepare('SELECT gi.* FROM grade_items gi JOIN grades g ON g.id = gi.grade_id WHERE g.user_id = ? ORDER BY gi.id').all(user.id);
  const byGrade = Object.groupBy(items, (i) => i.grade_id);
  const currentSem = Math.max(...rows.map((r) => r.semester), 1);
  const current = rows.filter((r) => r.semester === currentSem).map((r) => {
    const forecast = markFor(r.points ?? 0);
    return {
      id: r.id, subject: r.subject, control: r.control, points: r.points, credits: r.credits, teacher: r.teacher,
      items: (byGrade[r.id] || []).map(({ title, points, max, date }) => ({ title, points, max, date })),
      forecast: r.control === 'credit' ? (r.points >= 55 ? 'зачтено' : 'не зачтено') : forecast.mark,
      forecastLabel: r.control === 'credit' ? (r.points >= 55 ? 'зачёт' : 'риск незачёта') : forecast.label,
      admitted: (r.points ?? 0) >= ADMISSION,
      toNext: nextThreshold(r),
    };
  });
  const history = [];
  for (const sem of [...new Set(rows.filter((r) => r.semester !== currentSem).map((r) => r.semester))]) {
    const list = rows.filter((r) => r.semester === sem).map(({ subject, control, points, mark, credits, teacher, date }) => ({ subject, control, points, mark, credits, teacher, date }));
    history.push({ semester: sem, items: list, gpa: avg(list.map((x) => Number(x.mark)).filter(Boolean)) });
  }
  const allMarks = rows.filter((r) => r.semester !== currentSem).map((r) => Number(r.mark)).filter(Boolean);
  const risks = current.filter((c) => !c.admitted || c.forecast === '3' || c.forecast === 'не зачтено');
  return {
    currentSemester: currentSem, current, history,
    summary: {
      gpa: avg(allMarks), totalCredits: rows.filter((r) => r.mark).reduce((s, r) => s + (r.credits || 0), 0),
      debts: rows.filter((r) => r.semester !== currentSem && (r.mark === '2' || r.mark === 'не зачтено')).length,
      risks: risks.map((r) => ({ subject: r.subject, points: r.points, reason: !r.admitted ? `до допуска не хватает ${ADMISSION - r.points} б.` : r.control === 'credit' ? 'риск незачёта' : 'прогноз «удовлетворительно»' })),
      averagePoints: Math.round(avg(current.map((c) => c.points ?? 0))),
    },
    scale: POINTS_SCALE, admission: ADMISSION,
  };
}
function nextThreshold(r) {
  if (r.control === 'credit') return r.points >= 55 ? null : { target: 'зачёт', need: 55 - r.points };
  const next = [...POINTS_SCALE].reverse().find((s) => s.min > r.points);
  return next ? { target: next.mark, need: next.min - r.points } : null;
}
const avg = (a) => (a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 100) / 100 : null);

// ---------------- Стипендия (условные правила и суммы для прототипа) ----------------
export const STIPEND = { base: 3200, excellent: 4800, payDay: 25 };
export function stipendFor(db, user) {
  if (user.funding !== 'budget') return { applicable: false };
  const g = gradesFor(db, user);
  const last = g.history[0];
  const marks = last ? last.items.filter((i) => i.control !== 'credit').map((i) => i.mark) : [];
  const hasDebt = last ? last.items.some((i) => i.mark === '2' || i.mark === 'не зачтено') : false;
  const all5 = marks.length && marks.every((m) => m === '5');
  const eligible = last ? !hasDebt && marks.every((m) => m === '4' || m === '5') : true; // первокурсники до 1-й сессии получают базовую
  const amount = !eligible ? 0 : all5 ? STIPEND.excellent : STIPEND.base;
  const t = mskNow();
  let pay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), STIPEND.payDay));
  if (pay < mskToday()) pay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, STIPEND.payDay));
  const daysLeft = Math.round((pay - mskToday()) / DAY);
  // Прогноз на следующий семестр по текущим баллам
  const exams = g.current.filter((c) => c.control !== 'credit');
  const credits = g.current.filter((c) => c.control === 'credit');
  const threats = [
    ...exams.filter((c) => c.points < 70).map((c) => ({ subject: c.subject, points: c.points, need: 70 - c.points, text: `нужно ещё ${70 - c.points} б. до «хорошо»` })),
    ...credits.filter((c) => c.points < 55).map((c) => ({ subject: c.subject, points: c.points, need: 55 - c.points, text: `нужно ещё ${55 - c.points} б. до зачёта` })),
  ];
  const forecastAll5 = exams.every((c) => c.points >= 85) && threats.length === 0;
  return {
    applicable: true, eligible, amount, payDate: isoDate(pay), daysLeft,
    reason: !eligible ? 'В прошлую сессию были тройки или долги' : all5 ? 'Все экзамены на «отлично» — повышенный размер' : 'Сессия сдана на «хорошо» и «отлично»',
    forecast: { keeps: threats.length === 0, amount: threats.length ? 0 : forecastAll5 ? STIPEND.excellent : STIPEND.base, threats },
    rules: [`Базовая академическая: ${STIPEND.base.toLocaleString('ru-RU')} ₽ — сессия без троек и долгов`, `Повышенная: ${STIPEND.excellent.toLocaleString('ru-RU')} ₽ — все экзамены на «отлично»`, `Выплата — ${STIPEND.payDay}-го числа каждого месяца`, 'Суммы и правила условные (прототип)'],
  };
}

// ---------------- Тесты СДО (адаптер-заглушка: в реальном вузе — Moodle Web Services и т.п.) ----------------
export const lmsAdapters = {
  'moodle-demo': {
    name: 'Moodle (демо)',
    /** Возвращает тесты группы с абсолютным временем. Реальный адаптер ходил бы в API СДО с ключом из переменных окружения. */
    listTests(db, group) {
      return db.prepare('SELECT * FROM lms_tests WHERE group_name = ?').all(group);
    },
  },
};

export function testsFor(db, user) {
  const status = Object.fromEntries(db.prepare('SELECT test_id, status, score FROM lms_status WHERE user_id = ?').all(user.id).map((s) => [s.test_id, s]));
  const now = Date.now();
  const all = Object.values(lmsAdapters).flatMap((a) => a.listTests(db, user.group_name)).map((t) => {
    const opensAt = resolveRel(isNaN(t.opens) ? t.opens : Number(t.opens));
    const closesAt = resolveRel(isNaN(t.closes) ? t.closes : Number(t.closes));
    const st = status[t.id];
    let state = now < opensAt ? 'upcoming' : now <= closesAt ? 'open' : 'closed';
    let result = st?.status === 'done' ? 'done' : state === 'closed' ? 'missed' : null;
    return {
      id: t.id, subject: t.subject, teacher: t.teacher, title: t.title, opensAt, closesAt, timeLimit: t.time_limit, attempts: t.attempts,
      url: `lms-demo.html?test=${t.id}`, source: lmsAdapters[t.source]?.name || t.source, state, result, score: st?.score || null,
      hot: state === 'open' && result !== 'done' && closesAt - now < 24 * 3600_000,
    };
  });
  return {
    open: all.filter((t) => t.state === 'open').sort((a, b) => (a.result === 'done') - (b.result === 'done') || a.closesAt - b.closesAt),
    upcoming: all.filter((t) => t.state === 'upcoming').sort((a, b) => a.opensAt - b.opensAt),
    closed: all.filter((t) => t.state === 'closed').sort((a, b) => b.closesAt - a.closesAt),
  };
}

// ---------------- Уведомления ----------------
export const MANDATORY = ['schedule', 'request', 'deadline', 'official', 'grades', 'chat'];
export function notificationsFor(db, user, prefs) {
  const reads = new Set(db.prepare('SELECT key FROM reads WHERE user_id = ?').all(user.id).map((r) => r.key));
  const mute = prefs?.mute || {};
  const list = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(user.id)
    .map((n) => ({ key: `n${n.id}`, category: n.category, title: n.title, body: n.body, link: n.link, at: n.created_at }));
  for (const n of newsFor(db, user)) {
    if ((n.category === 'news' || n.category === 'event') && mute[n.category]) continue;
    list.push({ key: `news${n.id}`, category: n.category, title: n.title, body: n.body, link: `#/news/${n.id}`, at: n.created_at, important: !!n.important });
  }
  // Напоминания о тестах: «тест открылся» + последнее наступившее «осталось N часов»
  const hours = (prefs?.reminders?.length ? prefs.reminders : [24, 3, 1]).slice().sort((a, b) => b - a);
  const now = Date.now();
  const t = testsFor(db, user);
  for (const test of t.open) {
    if (test.result === 'done') continue;
    list.push({ key: `t${test.id}-open`, category: 'deadline', title: `Открыт тест: ${test.subject}`, body: `${test.title}. Доступен до ${fmtDT(test.closesAt)}.`, link: '#/tests', at: test.opensAt });
    const due = hours.filter((h) => now >= test.closesAt - h * 3600_000);
    if (due.length) {
      const h = due[due.length - 1];
      list.push({ key: `t${test.id}-${h}h`, category: 'deadline', title: `Осталось меньше ${h} ч: ${test.subject}`, body: `${test.title} закроется ${fmtDT(test.closesAt)}. Не забудьте пройти!`, link: '#/tests', at: test.closesAt - h * 3600_000, important: true });
    }
  }
  const unreadMsgs = db.prepare('SELECT COUNT(*) c, MAX(created_at) at FROM messages WHERE student_id = ? AND author_id != ? AND read_by_student = 0').get(user.id, user.id);
  if (unreadMsgs.c) list.push({ key: `chat-${unreadMsgs.at}`, category: 'chat', title: 'Новый ответ деканата', body: `Непрочитанных сообщений: ${unreadMsgs.c}`, link: '#/chat', at: unreadMsgs.at });
  list.sort((a, b) => b.at - a.at);
  for (const n of list) n.read = reads.has(n.key);
  return { items: list, unread: list.filter((n) => !n.read).length };
}

export function newsFor(db, user) {
  return db.prepare(`SELECT id, title, body, category, important, created_at, audience FROM news
    WHERE audience = 'all' OR audience = ? OR audience = ? ORDER BY created_at DESC LIMIT 50`)
    .all(`faculty:${user.faculty}`, `group:${user.group_name}`);
}

const fmtDT = (ms) => new Date(ms + 3 * 3600_000).toISOString().replace(/^(\d{4})-(\d\d)-(\d\d)T(\d\d:\d\d).*/, '$3.$2 в $4');

// ---------------- Справки и заявки ----------------
export const REQUEST_TYPES = [
  { id: 'study', title: 'Справка об обучении', hint: 'Для работы, соцзащиты, банка, визы', days: 1, icon: 'doc', fields: [
    { name: 'place', label: 'Куда нужна справка', type: 'text', placeholder: 'Например: по месту требования', required: true, max: 120 },
    { name: 'copies', label: 'Количество экземпляров', type: 'number', min: 1, max: 5, default: 1 },
    { name: 'format', label: 'Формат', type: 'select', options: [['electronic', 'Электронная с ЭП (на почту)'], ['paper', 'Бумажная (забрать в деканате)']], default: 'electronic' }] },
  { id: 'military', title: 'Справка в военкомат', hint: 'Форма для отсрочки', days: 3, icon: 'shield', fields: [
    { name: 'office', label: 'Военкомат', type: 'text', required: true, max: 120 },
    { name: 'copies', label: 'Количество экземпляров', type: 'number', min: 1, max: 3, default: 1 }] },
  { id: 'stipend', title: 'Справка о размере стипендии', hint: 'Для соцзащиты и налоговой', days: 3, icon: 'coins', only: 'budget', fields: [
    { name: 'months', label: 'За сколько месяцев', type: 'select', options: [['3', '3 месяца'], ['6', '6 месяцев'], ['12', '12 месяцев']], default: '6' }] },
  { id: 'transcript', title: 'Академическая выписка', hint: 'Все оценки — на русском или английском', days: 3, icon: 'list', fields: [
    { name: 'lang', label: 'Язык', type: 'select', options: [['ru', 'Русский'], ['en', 'English']], default: 'ru' }] },
  { id: 'call', title: 'Справка-вызов на сессию', hint: 'Для работодателя: учебный отпуск', days: 2, icon: 'briefcase', fields: [
    { name: 'employer', label: 'Работодатель', type: 'text', required: true, max: 120 }] },
  { id: 'absence', title: 'Пропуск по уважительной причине', hint: 'Болезнь, соревнования, семейные обстоятельства', days: 2, icon: 'calendarX', fields: [
    { name: 'from', label: 'С', type: 'date', required: true },
    { name: 'to', label: 'По', type: 'date', required: true },
    { name: 'reason', label: 'Причина', type: 'select', options: [['ill', 'Болезнь'], ['sport', 'Соревнования / олимпиада'], ['family', 'Семейные обстоятельства'], ['other', 'Другое']], default: 'ill' },
    { name: 'comment', label: 'Комментарий', type: 'textarea', max: 500, placeholder: 'Справку из поликлиники можно принести позже' }] },
  { id: 'retake', title: 'Заявление на пересдачу', hint: 'Выберите дисциплину и удобную дату', days: 3, icon: 'refresh', fields: [
    { name: 'subject', label: 'Дисциплина', type: 'text', required: true, max: 120 },
    { name: 'comment', label: 'Комментарий', type: 'textarea', max: 500 }] },
  { id: 'aid', title: 'Материальная помощь', hint: 'Единовременная выплата', days: 10, icon: 'heart', only: 'budget', fields: [
    { name: 'reason', label: 'Основание', type: 'select', options: [['hard', 'Трудная жизненная ситуация'], ['health', 'Лечение'], ['family', 'Рождение ребёнка / свадьба'], ['other', 'Другое']], default: 'hard' },
    { name: 'comment', label: 'Опишите ситуацию', type: 'textarea', max: 800, required: true }] },
  { id: 'dorm_repair', title: 'Ремонт в общежитии', hint: 'Сантехника, мебель, электрика', days: 2, icon: 'wrench', only: 'dorm', fields: [
    { name: 'what', label: 'Что случилось', type: 'textarea', required: true, max: 500 }] },
];
export const STATUS = {
  new: 'Принята', in_progress: 'В работе', need_info: 'Нужны уточнения', ready: 'Готово', done: 'Получено', rejected: 'Отклонена', cancelled: 'Отменена',
};
export function availableTypes(user) {
  const extra = JSON.parse(user.extra || '{}');
  return REQUEST_TYPES.filter((t) => !t.only || (t.only === 'budget' ? user.funding === 'budget' : t.only === 'dorm' ? !!extra.dorm : true));
}

/** Проверка и очистка данных формы по описанию полей: лишние поля отбрасываются. */
export function validateRequest(type, input) {
  const out = {};
  for (const f of type.fields) {
    let v = input?.[f.name] ?? f.default;
    if (v == null || v === '') {
      if (f.required) return { error: `Заполните поле «${f.label}»` };
      continue;
    }
    v = String(v).trim();
    if (f.max && v.length > f.max) return { error: `Поле «${f.label}» слишком длинное` };
    if (f.type === 'number') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < (f.min ?? 0) || n > (f.max ?? 99)) return { error: `Проверьте поле «${f.label}»` };
      v = n;
    }
    if (f.type === 'select' && !f.options.some(([val]) => val === v)) return { error: `Проверьте поле «${f.label}»` };
    if (f.type === 'date' && !/^\d{4}-\d\d-\d\d$/.test(v)) return { error: `Проверьте дату «${f.label}»` };
    out[f.name] = v;
  }
  if (out.from && out.to && out.from > out.to) return { error: 'Дата «по» раньше даты «с»' };
  return { data: out };
}

// ---------------- Помощник (поиск по базе знаний + персональные ответы; без внешних ИИ-ключей) ----------------
const FAQ = [
  { k: ['справк', 'документ', 'военкомат', 'выписк'], a: 'Справки заказываются в разделе «Справки и заявки»: выберите тип, заполните 1–3 поля — и следите за статусом. Электронные справки с ЭП приходят на почту.', action: ['Заказать справку', '#/requests/new'] },
  { k: ['пересдач', 'долг', 'хвост'], a: 'Пересдачи назначает деканат после сессии. Подайте «Заявление на пересдачу» — дату согласуют с преподавателем, и она появится в расписании.', action: ['Подать заявление', '#/requests/new/retake'] },
  { k: ['пропуск', 'болел', 'болезн', 'уважительн'], a: 'Если пропустили занятия по уважительной причине, подайте заявление «Пропуск по уважительной причине». Справку можно донести позже.', action: ['Подать заявление', '#/requests/new/absence'] },
  { k: ['общежит', 'комнат', 'ремонт'], a: 'Информация о комнате, оплате и коменданте — в разделе «Общежитие». Там же можно оставить заявку на ремонт.', action: ['Открыть «Общежитие»', '#/dorm'] },
  { k: ['оплат', 'договор', 'платн', 'контракт'], a: 'График платежей и задолженность — в разделе «Оплата обучения». В прототипе оплата не проводится.', action: ['Открыть «Оплату»', '#/payment'] },
  { k: ['календар', 'google', 'гугл', 'яндекс'], a: 'Расписание можно подписать в Google, Яндекс или Apple Календарь: «Расписание → В календарь». Переносы обновятся автоматически.', action: ['Подключить календарь', '#/calendar'] },
  { k: ['тест', 'сдо', 'moodle', 'мудл'], a: 'Открытые тесты из СДО — в разделе «Тесты и задания», с таймером до закрытия и прямой ссылкой.', action: ['Открыть тесты', '#/tests'] },
  { k: ['психолог', 'тревог', 'стресс', 'поддержк', 'тяжело'], a: 'Психологическая служба работает бесплатно и анонимно. Контакты — в разделе «Поддержка».', action: ['Открыть «Поддержку»', '#/support'] },
  { k: ['студбилет', 'студенческ', 'qr', 'пропуск в корпус'], a: 'Цифровой студенческий билет с обновляемым QR-кодом — в разделе «Студбилет».', action: ['Показать студбилет', '#/card'] },
  { k: ['аудитори', 'корпус', 'карта', 'где наход', 'найти'], a: 'На «Карте кампуса» можно найти любую аудиторию: введите номер, например «Б-201».', action: ['Открыть карту', '#/map'] },
  { k: ['раздел', 'скрыть', 'настро', 'лишн', 'меню'], a: 'Лишние разделы можно скрыть, а нужные — закрепить в нижнем меню: «Профиль → Разделы кабинета».', action: ['Настроить разделы', '#/settings/sections'] },
  { k: ['деканат', 'написать', 'вопрос', 'связ'], a: 'Напишите в чат деканата — обычно отвечают в течение рабочего дня.', action: ['Открыть чат', '#/chat'] },
  { k: ['сесси', 'экзамен', 'зачёт', 'зачет'], a: 'Расписание сессии — во вкладке «Сессия» раздела «Расписание», прогноз оценок — в «Успеваемости».', action: ['Расписание сессии', '#/schedule?tab=session'] },
];
export function assistant(db, user, q) {
  const s = String(q || '').toLowerCase().slice(0, 300);
  if (!s.trim()) return { answer: 'Спросите, например: «когда стипендия?», «где следующая пара?», «как заказать справку?»', actions: [] };
  if (/(след|ближайш).*(пар|заняти)|где пара|какая пара/.test(s)) {
    const [n] = nextLessons(db, user, 1);
    return n ? { answer: `Следующее занятие — ${n.subject} (${n.kind.toLowerCase()}), ${n.weekday.toLowerCase()} ${n.date.slice(8)}.${n.date.slice(5, 7)} в ${n.start}, аудитория ${n.room}, ${n.teacher.replace(/\.$/, '')}.${n.change ? ' Внимание: есть изменение — ' + n.change.note + '.' : ''}`, actions: [['Открыть расписание', '#/schedule'], ['Аудитория на карте', `#/map?room=${encodeURIComponent(n.room)}`]] }
      : { answer: 'В ближайшие две недели занятий нет.', actions: [] };
  }
  if (/стипенд/.test(s)) {
    const st = stipendFor(db, user);
    if (!st.applicable) return { answer: 'Вы обучаетесь по договору, академическая стипендия не назначается. Можно претендовать на именные стипендии — следите за новостями.', actions: [] };
    return { answer: st.eligible ? `Ближайшая выплата — ${st.amount.toLocaleString('ru-RU')} ₽, ${st.payDate.slice(8)}.${st.payDate.slice(5, 7)} (через ${st.daysLeft} дн.). ${st.forecast.keeps ? 'По текущим баллам стипендия сохранится в следующем семестре.' : 'Есть риск потерять стипендию: ' + st.forecast.threats.map((t) => t.subject).join(', ') + '.'}` : 'Сейчас академическая стипендия не назначена: в прошлую сессию были тройки или долги.', actions: [['Подробнее', '#/stipend']] };
  }
  if (/(как|мои).*(дела|успева|оценк|балл)|успеваем|рейтинг/.test(s)) {
    const g = gradesFor(db, user);
    return { answer: `Средний текущий балл — ${g.summary.averagePoints} из 100${g.summary.gpa ? `, средняя оценка за прошлые сессии — ${g.summary.gpa}` : ''}. ${g.summary.risks.length ? 'Стоит обратить внимание: ' + g.summary.risks.map((r) => `${r.subject} (${r.reason})`).join('; ') + '.' : 'Рисков по дисциплинам нет — так держать!'}`, actions: [['Открыть успеваемость', '#/grades']] };
  }
  const scored = FAQ.map((f) => ({ f, score: f.k.filter((k) => s.includes(k)).length })).filter((x) => x.score).sort((a, b) => b.score - a.score);
  if (scored.length) return { answer: scored[0].f.a, actions: [scored[0].f.action] };
  return { answer: 'Пока не знаю ответа. Задайте вопрос в чате деканата — там ответит сотрудник.', actions: [['Написать в деканат', '#/chat']] };
}
