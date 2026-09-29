// Page historique : lit la base SQLite (HistoryDb), affiche chaque journée en bande horaire.
// Les suppressions passent par le service worker (seul écrivain de la base).

const SCALE_START = 7 * 60;   // 07:00
const SCALE_END = 19 * 60;    // 19:00
const SCALE_SPAN = SCALE_END - SCALE_START;
const AXIS_STEP_MINS = 120;
const MIN_EXIT = { normal: 17 * 60, ramadan: 15 * 60 + 30 };
const RANGE_STORAGE_KEY = 'historyRange';

const daysEl = document.getElementById('days');
const summaryEl = document.getElementById('summary');
const statusEl = document.getElementById('status');
const axisEl = document.getElementById('axis');
const exportBtn = document.getElementById('exportBtn');
const exportFormatSelect = document.getElementById('exportFormat');
const exportBtnLabel = document.getElementById('exportBtnLabel');
const EXPORT_FORMAT_KEY = 'historyExportFormat';
const rangeButtons = [...document.querySelectorAll('.segmented button')];

const dayNameFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'UTC' });
const weekFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });

let range = '30';
let isFirstRender = true;

// ---------- Dates ----------

function parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

function toDateKey(date) {
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function weekStartKey(key) {
    const d = parseDateKey(key);
    const offset = (d.getUTCDay() + 6) % 7; // lundi = 0
    d.setUTCDate(d.getUTCDate() - offset);
    return toDateKey(d);
}

function rangeStartKey() {
    if (range === 'all') return null;
    const d = parseDateKey(moroccoDateKey());
    d.setUTCDate(d.getUTCDate() - (Number(range) - 1));
    return toDateKey(d);
}

// ---------- Rendu ----------

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function pct(mins) {
    const clamped = Math.min(Math.max(mins, SCALE_START), SCALE_END);
    return ((clamped - SCALE_START) / SCALE_SPAN) * 100;
}

function renderAxis() {
    axisEl.replaceChildren();
    for (let m = SCALE_START; m <= SCALE_END; m += AXIS_STEP_MINS) {
        const tick = el('span', 'axis-tick', minsToHM(m));
        tick.style.left = `${pct(m)}%`;
        axisEl.appendChild(tick);
    }
}

function renderStrip(day, index) {
    const strip = el('div', 'strip');
    strip.style.setProperty('--i', index);
    const arrival = timeToMins(day.clockIn);
    const departure = timeToMins(day.departure || day.clockIn);

    const work = el('div', 'strip-work');
    work.style.left = `${pct(arrival)}%`;
    work.style.width = `${Math.max(pct(departure) - pct(arrival), 0)}%`;
    strip.appendChild(work);

    for (const p of day.pauses) {
        const seg = el('div', 'strip-pause');
        seg.style.left = `${pct(timeToMins(p.start))}%`;
        seg.style.width = `${Math.max(pct(timeToMins(p.end)) - pct(timeToMins(p.start)), 0.4)}%`;
        seg.title = `Pause ${p.position} : ${p.start} → ${p.end}`;
        strip.appendChild(seg);
    }

    const min = el('div', 'strip-min');
    min.style.left = `${pct(day.ramadan ? MIN_EXIT.ramadan : MIN_EXIT.normal)}%`;
    strip.appendChild(min);

    strip.setAttribute('role', 'img');
    strip.setAttribute('aria-label',
        `Arrivée ${day.clockIn}, sortie ${day.departure || 'inconnue'}, ${day.pauses.length} pause(s)`);
    return strip;
}

function pauseCountLabel(n) {
    return n === 0 ? 'aucune pause' : n === 1 ? '1 pause' : `${n} pauses`;
}

function renderDay(day, index, todayKey) {
    const details = el('details', 'day');
    if (day.date === todayKey) details.classList.add('is-today');

    const summary = el('summary', 'day-summary');

    const date = parseDateKey(day.date);
    const dateBox = el('div', 'day-date');
    dateBox.append(el('span', 'day-num', String(date.getUTCDate())), el('span', 'day-name', dayNameFmt.format(date)));
    if (day.ramadan) {
        const tag = el('span', 'ramadan-tag');
        tag.title = 'Journée en mode Ramadan';
        tag.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';
        dateBox.appendChild(tag);
    }

    const span = el('div', 'day-span');
    span.append(document.createTextNode(day.clockIn), el('span', 'arrow', '→'), document.createTextNode(day.departure || '--:--'));

    const pausesBox = el('div', 'day-pauses');
    pausesBox.append(el('strong', null, formatDuration(day.totalPauseMins)), document.createTextNode(` ${pauseCountLabel(day.pauses.length)}`));

    const chevron = el('span', 'chevron');
    chevron.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

    summary.append(dateBox, renderStrip(day, index), span, pausesBox, chevron);
    details.appendChild(summary);
    details.appendChild(renderDayDetail(day));
    return details;
}

function renderDayDetail(day) {
    const detail = el('div', 'day-detail');
    if (day.pauses.length === 0) {
        detail.appendChild(el('p', 'no-pause', 'Aucune pause ce jour-là.'));
    } else {
        const list = el('ul', 'pause-chips');
        for (const p of day.pauses) {
            const chip = el('li', 'pause-chip');
            chip.append(el('span', 'p-num', `P${p.position}`), document.createTextNode(`${p.start} → ${p.end}`),
                el('span', 'p-len', formatDuration(p.durationMins)));
            list.appendChild(chip);
        }
        detail.appendChild(list);
    }

    const del = el('button', 'btn-delete', 'Supprimer cette journée');
    del.type = 'button';
    del.addEventListener('click', () => deleteDay(day.date));
    detail.appendChild(del);
    return detail;
}

function renderWeeks(days) {
    const todayKey = moroccoDateKey();
    const weeks = new Map();
    for (const day of days) {
        const key = weekStartKey(day.date);
        weeks.set(key, [...(weeks.get(key) || []), day]);
    }

    let index = 0;
    const sections = [...weeks.entries()].map(([weekKey, weekDays]) => {
        const section = el('section', 'week');
        const head = el('div', 'week-head');
        const title = el('h2', 'week-title', `Semaine du ${weekFmt.format(parseDateKey(weekKey))}`);
        const total = weekDays.reduce((s, d) => s + d.totalPauseMins, 0);
        const meta = el('span', 'week-meta',
            `${weekDays.length} jour${weekDays.length > 1 ? 's' : ''}, ${formatDuration(total)} de pause`);
        head.append(title, meta);

        const list = el('div', 'week-days');
        for (const day of weekDays) list.appendChild(renderDay(day, index++, todayKey));
        section.append(head, list);
        return section;
    });
    daysEl.replaceChildren(...sections);
}

function average(values) {
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function renderSummary(days) {
    summaryEl.replaceChildren();
    if (days.length === 0) return;

    const arrival = average(days.map((d) => timeToMins(d.clockIn)));
    const pause = average(days.map((d) => d.totalPauseMins));
    const withExit = days.filter((d) => d.departure);
    const exit = average(withExit.map((d) => timeToMins(d.departure)));

    const scope = range === 'all' ? 'Depuis le début' : `Sur les ${range} derniers jours`;
    const parts = [
        `${scope}, `, ['strong', `${days.length} journée${days.length > 1 ? 's' : ''}`], ' enregistrée' + (days.length > 1 ? 's' : '') + '. Vous arrivez en moyenne à ',
        ['strong', minsToHM(arrival)], ', prenez ', ['strong', formatDuration(pause)], ' de pause par jour'
    ];
    if (withExit.length) parts.push(' et sortez vers ', ['strong', minsToHM(exit)]);
    parts.push('.');

    for (const part of parts) {
        summaryEl.append(Array.isArray(part) ? el(part[0], null, part[1]) : document.createTextNode(part));
    }
}

function showStatus(message, isError = false, canRetry = false) {
    statusEl.hidden = !message;
    statusEl.textContent = message || '';
    statusEl.classList.toggle('is-error', isError);
    if (canRetry) {
        const retry = el('button', 'btn-retry', 'Réessayer');
        retry.type = 'button';
        retry.addEventListener('click', () => { showStatus(''); load(); });
        statusEl.append(document.createElement('br'), retry);
    }
}

// ---------- Données ----------

async function load() {
    try {
        const days = await HistoryDb.listDays({ fromDate: rangeStartKey() });
        renderSummary(days);
        if (isFirstRender) document.body.classList.add('is-intro');
        renderWeeks(days);
        if (isFirstRender) {
            setTimeout(() => document.body.classList.remove('is-intro'), 1500);
            isFirstRender = false;
        }
        exportBtn.disabled = false;
        showStatus(days.length ? '' : (range === 'all'
            ? "Aucune journée enregistrée pour l'instant. Elle s'ajoute automatiquement dès que vous changez l'heure d'arrivée ou lancez une pause dans le popup."
            : 'Aucune journée sur cette période. Essayez « Tout ».'));
    } catch (err) {
        console.error('[Pause & Salat] Lecture de l\'historique impossible :', err);
        daysEl.replaceChildren();
        summaryEl.replaceChildren();
        showStatus(HistoryDb.isWasmBlocked(err)
            ? "L'historique ne peut pas s'ouvrir tant que l'extension n'est pas rechargée. Ouvrez chrome://extensions, cliquez sur ↻ sous « Pause », puis revenez ici."
            : `L'historique n'a pas pu être lu (${String(err && (err.message || err)).slice(0, 120)}). Cliquez sur « Réessayer ». Vos données ne sont pas effacées.`, true, true);
    }
}

async function deleteDay(date) {
    const label = parseDateKey(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    if (!confirm(`Supprimer la journée du ${label} de l'historique ?`)) return;
    const res = await chrome.runtime.sendMessage({ type: 'history:deleteDay', date })
        .catch((err) => ({ ok: false, error: String(err.message || err) }));
    if (!res || !res.ok) {
        showStatus(`Suppression impossible : ${res ? res.error : 'pas de réponse'}. Réessayez.`, true);
        return;
    }
    load();
}

async function exportHistory() {
    exportBtn.disabled = true;
    const format = exportFormatSelect ? exportFormatSelect.value : 'xlsx';
    const oldLabel = exportBtnLabel ? exportBtnLabel.textContent : 'Exporter';
    if (exportBtnLabel) exportBtnLabel.textContent = 'Exportation...';

    try {
        const dateKey = moroccoDateKey();
        let blob, filename;

        if (format === 'xlsx') {
            const buffer = await HistoryDb.exportXlsx();
            blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            filename = `pause-historique-${dateKey}.xlsx`;
        } else if (format === 'csv') {
            const csvText = await HistoryDb.exportCsv();
            blob = new Blob([csvText], {
                type: 'text/csv;charset=utf-8;'
            });
            filename = `pause-historique-${dateKey}.csv`;
        } else {
            // sqlite
            const bytes = await HistoryDb.exportFile();
            blob = new Blob([bytes], {
                type: 'application/vnd.sqlite3'
            });
            filename = `pause-historique-${dateKey}.sqlite`;
        }

        const url = URL.createObjectURL(blob);
        const a = el('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
        console.error('[Pause] Export impossible :', err);
        showStatus("L'exportation a échoué. Réessayez dans un instant.", true);
    } finally {
        exportBtn.disabled = false;
        if (exportBtnLabel) exportBtnLabel.textContent = oldLabel;
    }
}

// ---------- Période ----------

function setRange(value) {
    range = ['7', '30', 'all'].includes(value) ? value : '30';
    rangeButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.range === range)));
    try { localStorage.setItem(RANGE_STORAGE_KEY, range); } catch (_) { /* stockage indisponible */ }
    load();
}

rangeButtons.forEach((b) => b.addEventListener('click', () => setRange(b.dataset.range)));

// Flèches gauche/droite dans le groupe de période (comportement radiogroup)
document.querySelector('.segmented').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = rangeButtons.findIndex((b) => b.dataset.range === range);
    const next = rangeButtons[(i + (e.key === 'ArrowRight' ? 1 : rangeButtons.length - 1)) % rangeButtons.length];
    next.focus();
    setRange(next.dataset.range);
});

if (exportFormatSelect) {
    let savedFormat = 'xlsx';
    try {
        savedFormat = localStorage.getItem(EXPORT_FORMAT_KEY) || 'xlsx';
    } catch (_) {}
    exportFormatSelect.value = savedFormat;
    exportFormatSelect.addEventListener('change', () => {
        try {
            localStorage.setItem(EXPORT_FORMAT_KEY, exportFormatSelect.value);
        } catch (_) {}
    });
}

exportBtn.addEventListener('click', exportHistory);

// Rafraîchit quand le popup enregistre la journée
HistoryDb.onChange(load);

renderAxis();
let savedRange = '30';
try { savedRange = localStorage.getItem(RANGE_STORAGE_KEY) || '30'; } catch (_) { /* stockage indisponible */ }
setRange(savedRange);
