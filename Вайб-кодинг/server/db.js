import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword, randomToken } from './auth.js';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export function openDb(reset = false) {
  const file = path.join(DATA_DIR, 'dekanat.sqlite');
  if (reset && fs.existsSync(file)) fs.rmSync(file);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  login TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','staff')),
  full_name TEXT NOT NULL,
  faculty TEXT, program TEXT, course INTEGER, group_name TEXT,
  funding TEXT, record_book TEXT, email TEXT,
  extra TEXT NOT NULL DEFAULT '{}',
  prefs TEXT,
  cal_token TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY, group_name TEXT NOT NULL, weekday INTEGER NOT NULL, pair INTEGER NOT NULL,
  subject TEXT NOT NULL, kind TEXT NOT NULL, room TEXT, teacher TEXT, parity TEXT NOT NULL DEFAULT 'all'
);
CREATE TABLE IF NOT EXISTS changes (
  id INTEGER PRIMARY KEY, group_name TEXT NOT NULL,
  date TEXT NOT NULL,            -- 'YYYY-MM-DD' или 'next:N' (N-й учебный день от сегодня, для демо)
  pair INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cancel','room','replace','add')),
  subject TEXT, lesson_kind TEXT, room TEXT, teacher TEXT, note TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY, group_name TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL,
  kind TEXT NOT NULL, subject TEXT NOT NULL, room TEXT, teacher TEXT
);
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  semester INTEGER NOT NULL, subject TEXT NOT NULL,
  control TEXT NOT NULL CHECK (control IN ('exam','credit','diff')),
  points INTEGER, mark TEXT, credits INTEGER, teacher TEXT, date TEXT
);
CREATE TABLE IF NOT EXISTS grade_items (
  id INTEGER PRIMARY KEY, grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
  title TEXT NOT NULL, points INTEGER NOT NULL, max INTEGER NOT NULL, date TEXT
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL, staff_comment TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS request_events (
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  status TEXT NOT NULL, note TEXT, at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',   -- 'all' | 'faculty:<название>' | 'group:<группа>'
  category TEXT NOT NULL CHECK (category IN ('official','news','event')),
  important INTEGER NOT NULL DEFAULT 0, author_id INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id), text TEXT NOT NULL, created_at INTEGER NOT NULL,
  read_by_student INTEGER NOT NULL DEFAULT 0, read_by_staff INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lms_tests (
  id INTEGER PRIMARY KEY, group_name TEXT NOT NULL, subject TEXT NOT NULL, teacher TEXT, title TEXT NOT NULL,
  opens TEXT NOT NULL, closes TEXT NOT NULL,   -- epoch ms или «d+1@20:00» (относительно сегодняшней даты, для демо)
  time_limit INTEGER, attempts INTEGER, source TEXT NOT NULL DEFAULT 'moodle-demo', created_by INTEGER
);
CREATE TABLE IF NOT EXISTS lms_status (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_id INTEGER NOT NULL REFERENCES lms_tests(id) ON DELETE CASCADE,
  status TEXT NOT NULL, score TEXT, PRIMARY KEY (user_id, test_id)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, amount INTEGER NOT NULL, due TEXT NOT NULL, paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_req_user ON requests(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_grades_user ON grades(user_id);
CREATE INDEX IF NOT EXISTS idx_msg_student ON messages(student_id);
`;

// ---------- Демо-данные. ВСЕ ФИО, номера и оценки вымышлены. ----------
export const DEMO_ACCOUNTS = [
  { login: 'morozova', password: 'Demo-Student-1', note: 'студентка, бюджет, общежитие, 2 курс' },
  { login: 'lebedev', password: 'Demo-Student-2', note: 'студент, контракт, 1 курс' },
  { login: 'dekanat', password: 'Demo-Staff-1', note: 'сотрудник деканата' },
];

export async function seedIfEmpty(db) {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return false;
  const now = Date.now();
  const H = 3600_000;
  const pw = Object.fromEntries(await Promise.all(DEMO_ACCOUNTS.map(async (a) => [a.login, await hashPassword(a.password)])));

  const insUser = db.prepare(`INSERT INTO users (login, pass_hash, role, full_name, faculty, program, course, group_name, funding, record_book, email, extra, cal_token, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const alina = insUser.run('morozova', pw.morozova, 'student', 'Морозова Алина Сергеевна', 'Институт информационных технологий',
    '09.03.01 Информатика и вычислительная техника', 2, 'ИВТ-21', 'budget', 'ИТ-24-0117', 'a.morozova@student.example',
    JSON.stringify({ dorm: { name: 'Общежитие №2', address: 'ул. Студенческая, 12 (вымышл.)', room: '314', fee: 1100, paidUntil: '2026-12-31', commandant: 'Кравцова Т. В., каб. 101' }, birth: '2006-04-17' }),
    randomToken(32), now).lastInsertRowid;
  const max = insUser.run('lebedev', pw.lebedev, 'student', 'Лебедев Максим Андреевич', 'Институт экономики и управления',
    '38.03.01 Экономика', 1, 'ЭК-11', 'contract', 'ЭУ-25-0342', 'm.lebedev@student.example',
    JSON.stringify({ birth: '2007-09-02' }), randomToken(32), now).lastInsertRowid;
  const staff = insUser.run('dekanat', pw.dekanat, 'staff', 'Белова Ольга Николаевна', null, 'Специалист единого деканата', null, null, null, null,
    'dekanat@univ.example', '{}', null, now).lastInsertRowid;

  // Расписание: [день, пара, предмет, тип, аудитория, преподаватель, чётность]
  const insL = db.prepare('INSERT INTO lessons (group_name, weekday, pair, subject, kind, room, teacher, parity) VALUES (?,?,?,?,?,?,?,?)');
  const ivt = [
    [1, 1, 'Математический анализ', 'Лекция', 'А-301', 'Соколов В. П.', 'all'],
    [1, 2, 'Математический анализ', 'Практика', 'А-214', 'Соколов В. П.', 'all'],
    [1, 3, 'Программирование на Python', 'Лабораторная', 'Б-105', 'Орлова Е. С.', 'all'],
    [2, 2, 'Базы данных', 'Лекция', 'Б-201', 'Ким Д. А.', 'all'],
    [2, 3, 'Базы данных', 'Лабораторная', 'Б-110', 'Ким Д. А.', 'all'],
    [2, 4, 'Английский язык', 'Практика', 'В-112', 'Фёдорова Л. И.', 'all'],
    [3, 1, 'Физика', 'Лекция', 'А-101', 'Громов И. Н.', 'odd'],
    [3, 1, 'Физика', 'Лабораторная', 'А-120', 'Громов И. Н.', 'even'],
    [3, 2, 'Дискретная математика', 'Лекция', 'А-301', 'Белкин А. Р.', 'all'],
    [3, 3, 'Физическая культура', 'Практика', 'Спорткомплекс', 'Тарасов О. Г.', 'all'],
    [4, 2, 'Алгоритмы и структуры данных', 'Лекция', 'Б-201', 'Зайцев М. Ю.', 'all'],
    [4, 3, 'Алгоритмы и структуры данных', 'Практика', 'Б-105', 'Зайцев М. Ю.', 'all'],
    [4, 4, 'История России', 'Семинар', 'В-205', 'Лаврова Н. К.', 'even'],
    [5, 1, 'Дискретная математика', 'Практика', 'А-214', 'Белкин А. Р.', 'all'],
    [5, 2, 'Программирование на Python', 'Лекция', 'Б-201', 'Орлова Е. С.', 'all'],
    [5, 3, 'Английский язык', 'Практика', 'В-112', 'Фёдорова Л. И.', 'all'],
  ];
  const ek = [
    [1, 2, 'Микроэкономика', 'Лекция', 'В-301', 'Полякова И. В.', 'all'],
    [1, 3, 'Высшая математика', 'Практика', 'А-214', 'Соколов В. П.', 'all'],
    [2, 1, 'Высшая математика', 'Лекция', 'А-101', 'Соколов В. П.', 'all'],
    [2, 2, 'Бухгалтерский учёт', 'Семинар', 'В-210', 'Гусева С. А.', 'all'],
    [2, 3, 'Информатика', 'Лабораторная', 'Б-110', 'Ким Д. А.', 'odd'],
    [3, 2, 'Английский язык', 'Практика', 'В-114', 'Миронова Е. П.', 'all'],
    [3, 3, 'Право', 'Лекция', 'В-301', 'Сафонов Р. Д.', 'all'],
    [4, 1, 'Микроэкономика', 'Семинар', 'В-210', 'Полякова И. В.', 'all'],
    [4, 2, 'История России', 'Лекция', 'А-301', 'Лаврова Н. К.', 'all'],
    [5, 2, 'Бухгалтерский учёт', 'Лекция', 'В-301', 'Гусева С. А.', 'all'],
    [5, 3, 'Физическая культура', 'Практика', 'Спорткомплекс', 'Тарасов О. Г.', 'all'],
  ];
  for (const l of ivt) insL.run('ИВТ-21', ...l);
  for (const l of ek) insL.run('ЭК-11', ...l);

  const insC = db.prepare('INSERT INTO changes (group_name, date, pair, kind, subject, lesson_kind, room, teacher, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  insC.run('ИВТ-21', 'next:0', 2, 'room', null, null, 'А-410', null, 'Аудитория А-214 на ремонте', now - 5 * H);
  insC.run('ИВТ-21', 'next:1', 3, 'cancel', null, null, null, null, 'Преподаватель на конференции. Занятие перенесено', now - 20 * H);
  insC.run('ИВТ-21', 'next:2', 5, 'add', 'Базы данных', 'Лабораторная', 'Б-110', 'Ким Д. А.', 'Перенос отменённого занятия', now - 20 * H);
  insC.run('ИВТ-21', 'next:3', 2, 'replace', null, null, null, 'Орлова Е. С.', 'Замена преподавателя', now - 2 * H);
  insC.run('ЭК-11', 'next:1', 2, 'cancel', null, null, null, null, 'Занятие отменено, материалы — в СДО', now - 3 * H);
  insC.run('ЭК-11', 'next:0', 3, 'room', null, null, 'Б-201', null, 'Объединённое занятие с ЭК-12', now - 6 * H);

  const insE = db.prepare('INSERT INTO exams (group_name, date, time, kind, subject, room, teacher) VALUES (?,?,?,?,?,?,?)');
  for (const e of [
    ['2026-12-23', '10:10', 'Зачёт', 'Программирование на Python', 'Б-105', 'Орлова Е. С.'],
    ['2026-12-25', '12:20', 'Дифф. зачёт', 'Дискретная математика', 'А-214', 'Белкин А. Р.'],
    ['2026-12-26', '10:10', 'Зачёт', 'Английский язык', 'В-112', 'Фёдорова Л. И.'],
    ['2027-01-11', '14:00', 'Консультация', 'Математический анализ', 'А-301', 'Соколов В. П.'],
    ['2027-01-12', '09:00', 'Экзамен', 'Математический анализ', 'А-301', 'Соколов В. П.'],
    ['2027-01-16', '09:00', 'Экзамен', 'Базы данных', 'Б-201', 'Ким Д. А.'],
    ['2027-01-20', '09:00', 'Экзамен', 'Физика', 'А-101', 'Громов И. Н.'],
    ['2027-01-24', '09:00', 'Экзамен', 'Алгоритмы и структуры данных', 'Б-201', 'Зайцев М. Ю.'],
  ]) insE.run('ИВТ-21', ...e);
  for (const e of [
    ['2026-12-24', '10:10', 'Зачёт', 'Право', 'В-301', 'Сафонов Р. Д.'],
    ['2026-12-26', '12:20', 'Дифф. зачёт', 'Информатика', 'Б-110', 'Ким Д. А.'],
    ['2027-01-13', '09:00', 'Экзамен', 'Высшая математика', 'А-101', 'Соколов В. П.'],
    ['2027-01-18', '09:00', 'Экзамен', 'Микроэкономика', 'В-301', 'Полякова И. В.'],
    ['2027-01-22', '09:00', 'Экзамен', 'Бухгалтерский учёт', 'В-210', 'Гусева С. А.'],
  ]) insE.run('ЭК-11', ...e);

  const insG = db.prepare('INSERT INTO grades (user_id, semester, subject, control, points, mark, credits, teacher, date) VALUES (?,?,?,?,?,?,?,?,?)');
  const insGI = db.prepare('INSERT INTO grade_items (grade_id, title, points, max, date) VALUES (?,?,?,?,?)');
  const grade = (uid, sem, subject, control, points, mark, credits, teacher, date, items = []) => {
    const gid = insG.run(uid, sem, subject, control, points, mark, credits, teacher, date).lastInsertRowid;
    for (const it of items) insGI.run(gid, ...it);
  };
  // Алина: прошлые сессии без троек → получает стипендию
  grade(alina, 1, 'Математический анализ', 'exam', 91, '5', 5, 'Соколов В. П.', '2025-01-14');
  grade(alina, 1, 'Алгебра и геометрия', 'exam', 82, '4', 4, 'Белкин А. Р.', '2025-01-18');
  grade(alina, 1, 'Основы программирования', 'exam', 95, '5', 5, 'Орлова Е. С.', '2025-01-22');
  grade(alina, 1, 'Введение в специальность', 'diff', 88, '5', 2, 'Зайцев М. Ю.', '2024-12-26');
  grade(alina, 1, 'Английский язык', 'credit', 80, 'зачтено', 3, 'Фёдорова Л. И.', '2024-12-25');
  grade(alina, 1, 'Физическая культура', 'credit', 75, 'зачтено', 1, 'Тарасов О. Г.', '2024-12-24');
  grade(alina, 2, 'Математический анализ', 'exam', 79, '4', 5, 'Соколов В. П.', '2025-06-16');
  grade(alina, 2, 'Объектно-ориентированное программирование', 'exam', 93, '5', 5, 'Орлова Е. С.', '2025-06-20');
  grade(alina, 2, 'Физика', 'exam', 76, '4', 4, 'Громов И. Н.', '2025-06-24');
  grade(alina, 2, 'Дискретная математика', 'diff', 87, '5', 3, 'Белкин А. Р.', '2025-06-05');
  grade(alina, 2, 'Английский язык', 'credit', 84, 'зачтено', 3, 'Фёдорова Л. И.', '2025-06-03');
  grade(alina, 2, 'Физическая культура', 'credit', 72, 'зачтено', 1, 'Тарасов О. Г.', '2025-06-02');
  // Текущий семестр (3): накопленные баллы
  grade(alina, 3, 'Математический анализ', 'exam', 58, null, 5, 'Соколов В. П.', null, [['Контрольная №1', 18, 25, '2026-10-06'], ['ДЗ (8 из 10)', 24, 30, null], ['Коллоквиум', 16, 25, '2026-11-10']]);
  grade(alina, 3, 'Базы данных', 'exam', 76, null, 5, 'Ким Д. А.', null, [['Лабораторные 1–6', 46, 50, null], ['Контрольная по SQL', 22, 25, '2026-11-12'], ['Тест «Нормальные формы»', 8, 10, '2026-11-18']]);
  grade(alina, 3, 'Физика', 'exam', 71, null, 4, 'Громов И. Н.', null, [['Лабораторные', 38, 50, null], ['Контрольная', 33, 40, '2026-11-03']]);
  grade(alina, 3, 'Дискретная математика', 'diff', 88, null, 3, 'Белкин А. Р.', null, [['Домашние задания', 45, 50, null], ['Контрольная', 43, 50, '2026-11-14']]);
  grade(alina, 3, 'Алгоритмы и структуры данных', 'exam', 67, null, 5, 'Зайцев М. Ю.', null, [['Контесты', 40, 60, null], ['Контрольная', 27, 40, '2026-11-17']]);
  grade(alina, 3, 'Программирование на Python', 'credit', 91, null, 3, 'Орлова Е. С.', null, [['Лабораторные', 56, 60, null], ['Проект', 35, 40, null]]);
  grade(alina, 3, 'Английский язык', 'credit', 80, null, 3, 'Фёдорова Л. И.', null);
  grade(alina, 3, 'История России', 'credit', 54, null, 2, 'Лаврова Н. К.', null, [['Семинары', 34, 60, null], ['Эссе', 20, 40, null]]);
  grade(alina, 3, 'Физическая культура', 'credit', 70, null, 1, 'Тарасов О. Г.', null);
  // Максим: первый семестр, у «Высшей математики» риск недопуска
  grade(max, 1, 'Микроэкономика', 'exam', 72, null, 5, 'Полякова И. В.', null, [['Семинары', 40, 50, null], ['Контрольная', 32, 50, '2026-11-05']]);
  grade(max, 1, 'Высшая математика', 'exam', 36, null, 5, 'Соколов В. П.', null, [['Контрольная №1', 11, 30, '2026-10-08'], ['ДЗ', 15, 40, null], ['Тест «Пределы»', 10, 30, '2026-11-16']]);
  grade(max, 1, 'Бухгалтерский учёт', 'exam', 65, null, 4, 'Гусева С. А.', null);
  grade(max, 1, 'Информатика', 'diff', 90, null, 3, 'Ким Д. А.', null, [['Лабораторные', 55, 60, null], ['Тест', 35, 40, '2026-11-11']]);
  grade(max, 1, 'Английский язык', 'credit', 81, null, 3, 'Миронова Е. П.', null);
  grade(max, 1, 'Право', 'credit', 58, null, 2, 'Сафонов Р. Д.', null);
  grade(max, 1, 'История России', 'credit', 47, null, 2, 'Лаврова Н. К.', null);
  grade(max, 1, 'Физическая культура', 'credit', 66, null, 1, 'Тарасов О. Г.', null);

  const insR = db.prepare('INSERT INTO requests (user_id, type, title, details, status, staff_comment, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)');
  const insRE = db.prepare('INSERT INTO request_events (request_id, status, note, at) VALUES (?,?,?,?)');
  const req = (uid, type, title, details, events, comment = null) => {
    const last = events[events.length - 1];
    const rid = insR.run(uid, type, title, JSON.stringify(details), last[0], comment, events[0][2], last[2]).lastInsertRowid;
    for (const e of events) insRE.run(rid, ...e);
    return rid;
  };
  req(alina, 'study', 'Справка об обучении', { place: 'По месту требования', copies: 1, format: 'electronic' },
    [['new', 'Заявка создана', now - 50 * H], ['in_progress', 'Взята в работу', now - 30 * H], ['ready', 'Справка подписана ЭП и отправлена на почту', now - 4 * H]],
    'Электронная справка с ЭП отправлена на a.morozova@student.example. Бумажный экземпляр — в каб. А-105.');
  req(alina, 'stipend', 'Справка о размере стипендии', { months: 6 },
    [['new', 'Заявка создана', now - 26 * H], ['in_progress', 'Запрошены данные в бухгалтерии', now - 8 * H]]);
  req(max, 'military', 'Справка в военкомат', { copies: 2, office: 'Военный комиссариат Центрального района (вымышл.)' },
    [['new', 'Заявка создана', now - 3 * H]]);

  const insN = db.prepare('INSERT INTO notifications (user_id, category, title, body, link, created_at) VALUES (?,?,?,?,?,?)');
  insN.run(alina, 'request', 'Справка об обучении готова', 'Электронная копия на почте, бумажная — в каб. А-105 (пн–пт 10:00–17:00).', '#/requests/1', now - 4 * H);
  insN.run(alina, 'schedule', 'Изменение аудитории', 'Математический анализ, 2-я пара: аудитория А-410 вместо А-214.', '#/schedule', now - 5 * H);
  insN.run(alina, 'schedule', 'Занятие отменено и перенесено', 'Базы данных (лаб.) перенесены на 5-ю пару. Смотрите расписание.', '#/schedule', now - 20 * H);
  insN.run(alina, 'grades', 'Новые баллы: Базы данных', 'Тест «Нормальные формы» — 8 из 10.', '#/grades', now - 28 * H);
  insN.run(max, 'schedule', 'Аудитория изменена', 'Высшая математика: объединённое занятие с ЭК-12 в Б-201.', '#/schedule', now - 6 * H);
  insN.run(max, 'grades', 'Риск недопуска: Высшая математика', 'У вас 36 баллов. Для допуска к экзамену нужно 40. Обратитесь к преподавателю за доп. заданием.', '#/grades', now - 30 * H);

  const insNews = db.prepare('INSERT INTO news (title, body, audience, category, important, author_id, created_at) VALUES (?,?,?,?,?,?,?)');
  insNews.run('Опубликовано расписание зимней сессии', 'Расписание зачётов и экзаменов уже в разделе «Расписание → Сессия». Если у вас пересечения — напишите в чат деканата до 1 декабря.', 'all', 'official', 1, staff, now - 30 * H);
  insNews.run('Приём заявлений на материальную помощь', 'До 5 декабря можно подать заявление на материальную помощь в разделе «Справки и заявки».', 'all', 'official', 0, staff, now - 54 * H);
  insNews.run('День карьеры: 3 декабря', '30+ компаний, стажировки и разбор резюме. Корпус Б, атриум, 12:00–17:00.', 'all', 'event', 0, staff, now - 70 * H);
  insNews.run('В корпусе Б открылся коворкинг', 'Третий этаж, 40 мест, розетки у каждого стола, работает до 22:00.', 'all', 'news', 0, staff, now - 100 * H);
  insNews.run('Хакатон ИИТ «Код зимы»', 'Командный хакатон 13–14 декабря. Регистрация — у старост групп.', 'faculty:Институт информационных технологий', 'event', 0, staff, now - 40 * H);
  insNews.run('Встреча первокурсников с куратором', 'В четверг после 2-й пары, ауд. В-301: адаптация, стипендии, общежития.', 'group:ЭК-11', 'official', 0, staff, now - 15 * H);

  const insM = db.prepare('INSERT INTO messages (student_id, author_id, text, created_at, read_by_student, read_by_staff) VALUES (?,?,?,?,?,?)');
  insM.run(alina, alina, 'Здравствуйте! Можно ли получить справку об обучении на английском языке?', now - 72 * H, 1, 1);
  insM.run(alina, staff, 'Добрый день, Алина! Да: в «Справках и заявках» выберите «Академическая выписка» и язык English. Срок — 3 рабочих дня.', now - 70 * H, 1, 1);
  insM.run(max, max, 'Добрый день. Подскажите, как получить допуск к экзамену по высшей математике, если не хватает баллов?', now - 2 * H, 1, 0);

  const insT = db.prepare('INSERT INTO lms_tests (group_name, subject, teacher, title, opens, closes, time_limit, attempts) VALUES (?,?,?,?,?,?,?,?)');
  const insTS = db.prepare('INSERT INTO lms_status (user_id, test_id, status, score) VALUES (?,?,?,?)');
  insT.run('ИВТ-21', 'Базы данных', 'Ким Д. А.', 'Тест «Транзакции и индексы»', 'd-2@09:00', 'd+0@23:59', 30, 1);
  insT.run('ИВТ-21', 'Математический анализ', 'Соколов В. П.', 'Контрольный тест «Неопределённые интегралы»', 'd-1@10:00', 'd+3@18:00', 45, 2);
  insT.run('ИВТ-21', 'Физика', 'Громов И. Н.', 'Тест «Механические колебания»', 'd+2@08:00', 'd+6@23:59', 40, 1);
  const t4 = insT.run('ИВТ-21', 'Английский язык', 'Фёдорова Л. И.', 'Unit 5 — Vocabulary quiz', 'd-8@09:00', 'd-1@23:59', 20, 2).lastInsertRowid;
  const t5 = insT.run('ИВТ-21', 'История России', 'Лаврова Н. К.', 'Тест по теме «Реформы XIX века»', 'd-10@09:00', 'd-3@23:59', 30, 1).lastInsertRowid;
  insTS.run(alina, t4, 'done', '9 / 10');
  insTS.run(alina, t5, 'missed', null);
  const t6 = insT.run('ЭК-11', 'Микроэкономика', 'Полякова И. В.', 'Тест «Эластичность спроса»', 'd-3@09:00', 'd+5@23:59', 30, 1).lastInsertRowid;
  insT.run('ЭК-11', 'Высшая математика', 'Соколов В. П.', 'Тест «Производная»', 'd+1@08:00', 'd+8@23:59', 40, 2);
  const t8 = insT.run('ЭК-11', 'Информатика', 'Ким Д. А.', 'Тест «Excel: формулы»', 'd-6@09:00', 'd-1@23:59', 25, 1).lastInsertRowid;
  insTS.run(max, t6, 'done', '18 / 20');
  insTS.run(max, t8, 'done', '23 / 25');

  const insP = db.prepare('INSERT INTO payments (user_id, title, amount, due, paid_at) VALUES (?,?,?,?,?)');
  insP.run(max, 'Обучение, осенний семестр 2026/27', 98500, '2026-08-25', '2026-08-19');
  insP.run(max, 'Обучение, весенний семестр 2026/27', 98500, '2027-02-01', null);
  return true;
}
