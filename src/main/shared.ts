// Charge les règles partagées avec les fenêtres (heure du Maroc, salat, journée)
// dans le contexte global du processus principal.

import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

declare global {
    var MA_OFFSET_HOURS: number;
    var PRAYER_ORDER: string[];
    var PRAYER_LABELS: Record<string, string>;
    var DEFAULT_ALERT_LEAD_MINS: number;
    var ALERT_LEAD_CHOICES: number[];
    var DEFAULT_CLOCK_IN: string;
    var DAY_RULES_KEY: string;

    function moroccoDateKey(ts?: number): string;
    function moroccoNowSecs(): number;
    function formatMoroccoHM(ts?: number): string;
    function timeToMins(t: string): number;
    function minsToHM(mins: number): string;
    function formatDuration(mins: number): string;
    function fetchSalatDay(dateKey: string): Promise<any>;
    function nextPrayer(times: any, nowSecs: number): { name: string; mins: number };
    function pendingSalatAlert(state: any): any;
    function recordPause(pauses: any[] | undefined, start: number | null | undefined, end: number): any[];
    function computeDay(options: { clockIn: string; dayPauses: any[]; activeSecs?: number; ramadan?: boolean }): { departureMins: number; [key: string]: any };
    function applyDayRulesConfig(config?: any): void;
}

const ROOT_DIR = path.join(__dirname, '..', '..');
const SHARED_DIR = path.join(ROOT_DIR, 'src', 'shared');

for (const file of ['salat-core.js', 'day-core.js', 'salat-card.js']) {
    const full = path.join(SHARED_DIR, file);
    if (fs.existsSync(full)) {
        vm.runInThisContext(fs.readFileSync(full, 'utf8'), { filename: full });
    }
}

export {};
