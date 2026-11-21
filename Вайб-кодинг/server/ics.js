// Экспорт расписания в формате iCalendar (RFC 5545): понимают Google, Яндекс, Apple, Outlook и др.
// В календарь попадают ТОЛЬКО занятия и мероприятия сессии. Сроки тестов и дедлайны не выгружаются (решение команды).
import { addDays, isoDate, mondayOf, mskToday, mskToEpoch } from './time.js';
import { changesFor, dayLessons, sessionExams } from './logic.js';

/** Список поддерживаемых календарей. Новый сервис = одна запись здесь, логика не меняется. */
export const CALENDAR_PROVIDERS = [
  { id: 'google', name: 'Google Календарь', mode: 'link', url: 'https://calendar.google.com/calendar/render?cid={webcal}',
    steps: ['Нажмите кнопку — откроется Google Календарь', 'Подтвердите «Добавить календарь»', 'Готово: переносы будут подтягиваться автоматически (Google обновляет подписку раз в несколько часов)'] },
  { id: 'yandex', name: 'Яндекс Календарь', mode: 'copy-open', url: 'https://calendar.yandex.ru/',
    steps: ['Нажмите кнопку — ссылка скопируется, откроется Яндекс Календарь', 'Слева у списка календарей нажмите «+» → «Подписаться на календарь»', 'Вставьте ссылку, придумайте название и нажмите «Создать»'] },
  { id: 'apple', name: 'Apple Календарь (iPhone, Mac)', mode: 'link', url: '{webcal}',
    steps: ['Откройте ссылку на iPhone или Mac', 'Нажмите «Подписаться»'] },
  { id: 'other', name: 'Другой календарь', mode: 'copy', url: '{https}',
    steps: ['Скопируйте ссылку', 'В вашем календаре найдите «Добавить по URL» / «Подписка на календарь» и вставьте её'] },
];

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Перенос строк по 75 октетов (требование RFC 5545, важно для кириллицы). */
function fold(line) {
  const buf = Buffer.from(line, 'utf8');
  if (buf.length <= 75) return line;
  const parts = [];
  let start = 0, limit = 75;
  while (start < buf.length) {
    let end = Math.min(start + limit, buf.length);
    while (end < buf.length && (buf[end] & 0xc0) === 0x80) end--; // не резать UTF-8 символ
    parts.push(buf.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74;
  }
  return parts.join('\r\n ');
}

export function buildIcs(db, user, prefs) {
  const reminder = Number.isInteger(prefs?.calReminder) ? prefs.calReminder : 15;
  const now = Date.now();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dekanat Next (concept)//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc('Пары ' + user.group_name)}`, 'X-WR-TIMEZONE:Europe/Moscow',
    `X-WR-CALDESC:${esc('Расписание из концепта «Деканат Next». Обновляется автоматически.')}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  const alarm = reminder > 0 ? ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Скоро занятие', `TRIGGER:-PT${reminder}M`, 'END:VALARM'] : [];
  const event = (uid, start, end, summary, location, description) => lines.push('BEGIN:VEVENT', `UID:${uid}@dekanat-next`, `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${esc(summary)}`, `LOCATION:${esc(location)}`, `DESCRIPTION:${esc(description)}`, ...alarm, 'END:VEVENT');

  const changes = changesFor(db, user.group_name);
  const from = addDays(mondayOf(mskToday()), -7);
  const until = new Date(Date.UTC(mskToday().getUTCMonth() >= 8 ? mskToday().getUTCFullYear() : mskToday().getUTCFullYear(), mskToday().getUTCMonth() >= 8 ? 11 : 4, 31));
  for (let d = from; d <= until; d = addDays(d, 1)) {
    for (const l of dayLessons(db, user.group_name, d, changes)) {
      if (l.change?.kind === 'cancel') continue; // отменённые пары исчезают из календаря
      const tag = l.change?.kind === 'add' ? 'ПЕРЕНОС: ' : l.change?.kind === 'replace' ? 'ЗАМЕНА: ' : l.change?.kind === 'room' ? 'НОВАЯ АУД.: ' : '';
      event(`u${user.id}-${isoDate(d)}-p${l.pair}`, l.startAt, l.endAt, `${tag}${l.subject} (${l.kind.toLowerCase()})`, l.room,
        `${l.teacher}${l.change?.note ? '\n' + l.change.note : ''}`);
    }
  }
  for (const e of sessionExams(db, user)) {
    const start = mskToEpoch(e.date, e.time);
    event(`u${user.id}-exam-${e.date}-${e.time.replace(':', '')}`, start, start + (e.kind === 'Экзамен' ? 4 : 2) * 3600_000,
      `${e.kind}: ${e.subject}`, e.room, e.teacher);
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
