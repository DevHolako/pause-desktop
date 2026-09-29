// Helpers partagés (popup, content script, service worker) : heure du Maroc + horaires salat.
// Chargé aussi dans les onglets (réinjectable) : déclarations en var/function uniquement.
// Aucun accès au DOM ici.

// Depuis le 20/09/2026 le Maroc est officiellement à GMT (UTC+0).
// Offset réglable (0 = GMT officiel, 1 = ancien GMT+1).
var MA_OFFSET_HOURS = 0;

var PRAYER_ORDER = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
var PRAYER_LABELS = { Fajr: 'Fajr', Dhuhr: 'Dhuhr', Asr: 'Asr', Maghrib: 'Maghrib', Isha: 'Isha' };

var SALAT_CITY = 'Marrakesh';
var SALAT_COUNTRY = 'MA';
var SALAT_METHOD = 21; // Ministère des Habous (Maroc)

var FAJR_FALLBACK_WINDOW_MINS = 90; // si l'heure du lever du soleil manque (ancien cache)

var DEFAULT_ALERT_LEAD_MINS = 10;
var ALERT_LEAD_CHOICES = [5, 10, 15, 20, 30];

function pad2(n) {
    return String(n).padStart(2, '0');
}

function getMoroccoParts(ts = Date.now()) {
    const d = new Date(ts + MA_OFFSET_HOURS * 3600000);
    return {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
        second: d.getUTCSeconds()
    };
}

/** Date du jour au Maroc, format ISO YYYY-MM-DD (clé d'historique et de cache) */
function moroccoDateKey(ts = Date.now()) {
    const p = getMoroccoParts(ts);
    return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function moroccoNowSecs() {
    const p = getMoroccoParts();
    return (p.hour * 60 + p.minute) * 60 + p.second;
}

function formatMoroccoHM(ts) {
    const p = getMoroccoParts(ts);
    return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

function timeToMins(t) {
    if (typeof t !== 'string' || !/^\d{1,2}:\d{2}/.test(t)) return NaN;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

function minsToHM(mins) {
    const m = Math.round(mins);
    return `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
}

function formatDuration(mins) {
    const m = Math.max(0, Math.floor(mins));
    return `${Math.floor(m / 60)}h ${pad2(m % 60)}m`;
}

/** Récupère les horaires du jour auprès de l'API Aladhan → { date, times: { Fajr: mins, ..., Sunrise: mins } } */
async function fetchSalatDay(dateKey) {
    const [y, mo, d] = dateKey.split('-');
    const url = `https://api.aladhan.com/v1/timingsByCity/${d}-${mo}-${y}` +
        `?city=${SALAT_CITY}&country=${SALAT_COUNTRY}&method=${SALAT_METHOD}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Aladhan HTTP ${res.status}`);
    const json = await res.json();
    const timings = json && json.data && json.data.timings;
    if (json.code !== 200 || !timings) throw new Error('Aladhan: réponse invalide');

    const times = {};
    for (const k of PRAYER_ORDER) {
        const mins = timeToMins(timings[k]);
        if (Number.isNaN(mins)) throw new Error(`Aladhan: horaire ${k} invalide`);
        times[k] = mins;
    }
    const sunrise = timeToMins(timings.Sunrise);
    if (!Number.isNaN(sunrise)) times.Sunrise = sunrise; // fin du temps de Fajr
    return { date: dateKey, times };
}

/** Prochaine prière (demain Fajr si Isha est passée) */
function nextPrayer(times, nowSecs) {
    for (const k of PRAYER_ORDER) {
        if (times[k] * 60 > nowSecs) return { name: k, mins: times[k] };
    }
    return { name: 'Fajr', mins: times.Fajr + 1440 };
}

/** Fin du temps d'une prière : lever du soleil pour Fajr, prière suivante sinon, minuit pour Isha */
function prayerEndMins(times, name) {
    if (name === 'Fajr') return times.Sunrise != null ? times.Sunrise : times.Fajr + FAJR_FALLBACK_WINDOW_MINS;
    const next = PRAYER_ORDER[PRAYER_ORDER.indexOf(name) + 1];
    return next ? times[next] : 1440;
}

/**
 * Rappel actif : la dernière prière du jour dont la fenêtre de rappel a commencé
 * (heure - avance). Reste affiché après l'heure de la prière, tant que son temps
 * n'est pas terminé, jusqu'à ce que l'utilisateur le ferme.
 */
function activeSalatAlert(salatDay, leadMins, nowSecs, todayKey) {
    if (!salatDay || salatDay.date !== todayKey || leadMins == null) return null;
    let active = null;
    for (const k of PRAYER_ORDER) {
        const startSecs = (salatDay.times[k] - leadMins) * 60;
        if (startSecs <= nowSecs) active = k;
    }
    if (!active || nowSecs >= prayerEndMins(salatDay.times, active) * 60) return null;
    const prayerSecs = salatDay.times[active] * 60;
    return {
        name: active,
        mins: salatDay.times[active],
        key: `${todayKey}|${active}`,
        secsUntil: prayerSecs - nowSecs
    };
}
