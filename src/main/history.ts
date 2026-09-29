// Historique des journées : même base SQLite que l'extension (sql.js, même schéma),
// mais enregistrée dans un vrai fichier (%APPDATA%\Pause & Salat\history.sqlite).
// Le processus principal est le seul à y écrire ; les écritures passent par une file.

import * as fs from 'fs';
import initSqlJs, { Database } from 'sql.js';
import { DayData, DayPause } from './types';

const SCHEMA_VERSION = 1;
const HM_RE = /^\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function durationMins(start: string, end: string): number {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
}

function validateDay(day: DayData): DayPause[] {
    if (!day || !DATE_RE.test(day.date)) throw new Error('Date de journée invalide');
    if (!HM_RE.test(day.clockIn)) throw new Error("Heure d'arrivée invalide");
    if (day.departure != null && !HM_RE.test(day.departure)) throw new Error('Heure de sortie invalide');
    return (day.pauses || []).filter((p) => p && HM_RE.test(p.start) && HM_RE.test(p.end)
        && durationMins(p.start, p.end) > 0);
}

function migrate(db: Database): void {
    db.run('PRAGMA foreign_keys = ON;');
    const res = db.exec('PRAGMA user_version;');
    const version = res && res[0] && res[0].values && res[0].values[0] ? Number(res[0].values[0][0]) : 0;
    if (version < 1) {
        db.run(`
            CREATE TABLE IF NOT EXISTS days (
                date TEXT PRIMARY KEY,
                clock_in TEXT NOT NULL,
                ramadan INTEGER NOT NULL DEFAULT 0,
                total_pause_mins INTEGER NOT NULL DEFAULT 0,
                departure TEXT,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pauses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL REFERENCES days(date) ON DELETE CASCADE,
                position INTEGER NOT NULL,
                start TEXT NOT NULL,
                end TEXT NOT NULL,
                duration_mins INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_pauses_date ON pauses(date);
            PRAGMA user_version = ${SCHEMA_VERSION};
        `);
    }
}

export interface HistoryManager {
    saveDay: (day: DayData) => Promise<{ ok: boolean; error?: string }>;
    deleteDay: (date: string) => Promise<{ ok: boolean; error?: string }>;
    listDays: (opts?: { fromDate?: string | null }) => Promise<DayData[]>;
    exportFile: () => Promise<Uint8Array>;
}

export function createHistory(file: string, onChange: () => void): HistoryManager {
    let dbPromise: Promise<Database> | null = null;
    let queue: Promise<any> = Promise.resolve();

    function open(): Promise<Database> {
        if (!dbPromise) {
            dbPromise = initSqlJs().then((SQL) => {
                const bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
                const db = bytes ? new SQL.Database(new Uint8Array(bytes)) : new SQL.Database();
                migrate(db);
                return db;
            }).catch((err) => {
                dbPromise = null; // permettre un nouvel essai
                throw err;
            });
        }
        return dbPromise;
    }

    function persist(db: Database): void {
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, Buffer.from(db.export()));
        fs.renameSync(tmp, file);
        onChange();
    }

    /** Écriture sérialisée ; renvoie { ok } comme le service worker de l'extension */
    function write(task: (db: Database) => void): Promise<{ ok: boolean; error?: string }> {
        const run = queue.then(async () => {
            const db = await open();
            task(db);
            persist(db);
        });
        queue = run.catch(() => {});
        return run
            .then(() => ({ ok: true }))
            .catch((err: any) => {
                console.error('[Pause & Salat] Écriture historique impossible :', err);
                return { ok: false, error: String(err?.message || err) };
            });
    }

    function saveDay(day: DayData): Promise<{ ok: boolean; error?: string }> {
        return write((db) => {
            const pauses = validateDay(day);
            const total = pauses.reduce((sum, p) => sum + durationMins(p.start, p.end), 0);
            db.run('BEGIN;');
            try {
                db.run(`INSERT INTO days (date, clock_in, ramadan, total_pause_mins, departure, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                        ON CONFLICT(date) DO UPDATE SET
                            clock_in = excluded.clock_in,
                            ramadan = excluded.ramadan,
                            total_pause_mins = excluded.total_pause_mins,
                            departure = excluded.departure,
                            updated_at = excluded.updated_at;`,
                    [day.date, day.clockIn, day.ramadan ? 1 : 0, total, day.departure || null, Date.now()]);
                db.run('DELETE FROM pauses WHERE date = ?;', [day.date]);
                const stmt = db.prepare('INSERT INTO pauses (date, position, start, end, duration_mins) VALUES (?, ?, ?, ?, ?);');
                try {
                    pauses.forEach((p, i) => stmt.run([day.date, i + 1, p.start, p.end, durationMins(p.start, p.end)]));
                } finally {
                    stmt.free();
                }
                db.run('COMMIT;');
            } catch (err) {
                db.run('ROLLBACK;');
                throw err;
            }
        });
    }

    function deleteDay(date: string): Promise<{ ok: boolean; error?: string }> {
        if (!DATE_RE.test(date)) return Promise.resolve({ ok: false, error: 'Date invalide' });
        return write((db) => {
            db.run('DELETE FROM pauses WHERE date = ?;', [date]);
            db.run('DELETE FROM days WHERE date = ?;', [date]);
        });
    }

    /** Journées (les plus récentes d'abord), avec leurs pauses. fromDate optionnel (YYYY-MM-DD) */
    async function listDays({ fromDate = null }: { fromDate?: string | null } = {}): Promise<DayData[]> {
        await queue;
        const db = await open();
        const days: DayData[] = [];
        const dayStmt = db.prepare(`SELECT date, clock_in, ramadan, total_pause_mins, departure
                                    FROM days WHERE (? IS NULL OR date >= ?) ORDER BY date DESC;`);
        const pauseStmt = db.prepare('SELECT position, start, end, duration_mins FROM pauses WHERE date = ? ORDER BY position;');
        try {
            dayStmt.bind([fromDate, fromDate]);
            while (dayStmt.step()) {
                const r: any = dayStmt.getAsObject();
                const pauses: DayPause[] = [];
                pauseStmt.bind([r.date]);
                while (pauseStmt.step()) {
                    const p: any = pauseStmt.getAsObject();
                    pauses.push({ position: p.position, start: p.start, end: p.end, durationMins: p.duration_mins });
                }
                pauseStmt.reset();
                days.push({
                    date: r.date,
                    clockIn: r.clock_in,
                    ramadan: r.ramadan === 1,
                    totalPauseMins: r.total_pause_mins,
                    departure: r.departure,
                    pauses
                });
            }
        } finally {
            dayStmt.free();
            pauseStmt.free();
        }
        return days;
    }

    async function exportFile(): Promise<Uint8Array> {
        await queue;
        return (await open()).export();
    }

    return { saveDay, deleteDay, listDays, exportFile };
}
