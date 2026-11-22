import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA } from './schema.js';
export { seedIfEmpty, DEMO_ACCOUNTS } from './schema.js';

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
