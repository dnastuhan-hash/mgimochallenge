// Все расчёты дат — в московском времени (UTC+3, без перехода на летнее время).
// Приём: «московская дата» хранится как Date в UTC-полях (getUTC*), а в epoch переводится через MSK_OFFSET.
export const MSK_OFFSET = 3 * 3600_000;
export const DAY = 86_400_000;

/** Текущий момент как «московский» Date (читать через getUTC*). */
export const mskNow = () => new Date(Date.now() + MSK_OFFSET);

/** Сегодняшняя дата по Москве в 00:00 (UTC-поля). */
export function mskToday() {
  const n = mskNow();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

export const isoDate = (d) => d.toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(d.getTime() + n * DAY);
/** День недели 1..7 (пн..вс). */
export const weekday = (d) => ((d.getUTCDay() + 6) % 7) + 1;
export const mondayOf = (d) => addDays(d, 1 - weekday(d));

/** «2026-11-21» + «08:30» (МСК) → epoch ms. */
export const mskToEpoch = (dateStr, hhmm) => Date.parse(`${dateStr}T${hhmm}:00Z`) - MSK_OFFSET;

/**
 * Относительные даты для демо-данных, чтобы прототип выглядел «живым» в любой день проверки.
 * Формат: «d+1@20:00» — завтра в 20:00 МСК; «d-3@09:00» — три дня назад.
 */
export function resolveRel(spec) {
  if (spec == null) return null;
  if (typeof spec === 'number') return spec;
  const m = /^d([+-]\d+)@(\d\d:\d\d)$/.exec(spec);
  if (!m) return Date.parse(spec);
  return mskToEpoch(isoDate(addDays(mskToday(), Number(m[1]))), m[2]);
}

/** Чётность учебной недели (числитель/знаменатель): неделя 1 — с 1 сентября. */
export function weekParity(date) {
  const y = date.getUTCMonth() >= 8 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  const start = mondayOf(new Date(Date.UTC(y, 8, 1)));
  const n = Math.floor((mondayOf(date) - start) / (7 * DAY)) + 1;
  return { number: n, parity: n % 2 === 1 ? 'odd' : 'even' };
}

export const BELLS = {
  1: ['08:30', '10:00'],
  2: ['10:10', '11:40'],
  3: ['12:20', '13:50'],
  4: ['14:00', '15:30'],
  5: ['15:40', '17:10'],
  6: ['17:20', '18:50'],
};
