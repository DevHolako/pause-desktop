// Règles de la journée de travail, partagées par le popup, la fenêtre de pause
// plein écran et le service worker. Aucune dépendance au DOM.
// Chargé aussi via importScripts : déclarations en var/function uniquement.
// Dépend de salat-core.js (timeToMins).

var DEFAULT_CLOCK_IN = '08:00';
var MAX_PAUSES = 30;

// Règles par défaut (minutes depuis minuit) :
//   workMins     : durée de travail effectif
//   maxPauseMins : capital pause du règlement (ex. 30 min obligatoires + 30 min optionnelles)
//   minOut/maxOut: bornes de l'heure de sortie réelle
// L'utilisateur peut tout remplacer depuis la page Réglages (clé de stockage dayRulesConfig).
var DEFAULT_DAY_RULES = {
    normal: { workMins: 480, maxPauseMins: 60, minOut: 1020, maxOut: 1080 }, // 8h travail, 1h pause, sortie 17:00–18:00
    ramadan: { workMins: 420, maxPauseMins: 60, minOut: 930, maxOut: 990 }   // 7h travail, 1h pause, sortie 15:30–16:30
};

var DAY_RULES_KEY = 'dayRulesConfig';
var DAY_RULE_FIELDS = ['workMins', 'maxPauseMins', 'minOut', 'maxOut'];

// Copie active, mutable : la configuration de l'utilisateur y est fusionnée par applyDayRulesConfig.
var DAY_RULES = {
    normal: Object.assign({}, DEFAULT_DAY_RULES.normal),
    ramadan: Object.assign({}, DEFAULT_DAY_RULES.ramadan)
};

function toFiniteNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Fusionne la configuration utilisateur (objet { normal, ramadan }) dans DAY_RULES.
 *  Toute valeur absente ou invalide retombe sur la valeur par défaut. */
function applyDayRulesConfig(config) {
    ['normal', 'ramadan'].forEach((mode) => {
        const base = DEFAULT_DAY_RULES[mode];
        const user = (config && config[mode]) || {};
        const merged = {};
        DAY_RULE_FIELDS.forEach((f) => { merged[f] = toFiniteNumber(user[f], base[f]); });
        DAY_RULES[mode] = merged;
    });
    return DAY_RULES;
}

function dayRules(ramadan) {
    return ramadan ? DAY_RULES.ramadan : DAY_RULES.normal;
}

/** Durée d'une pause fermée, en minutes (NaN si incomplète) */
function pauseMins(p) {
    if (!p || !p.start || !p.end) return NaN;
    return timeToMins(p.end) - timeToMins(p.start);
}

/** Calculs de la journée (pur) : total des pauses, capital restant, sortie */
function computeDay({ clockIn, dayPauses, activeSecs, ramadan }) {
    const rules = dayRules(ramadan);
    const closedMins = (dayPauses || []).reduce((sum, p) => {
        const diff = pauseMins(p);
        return diff > 0 ? sum + diff : sum;
    }, 0);
    const totalPauseMins = closedMins + (activeSecs || 0) / 60;
    const arrivalMins = timeToMins(clockIn);

    let departureMins = arrivalMins + rules.workMins + totalPauseMins;
    departureMins = Math.max(departureMins, rules.minOut);
    if (rules.maxOut !== null) departureMins = Math.min(departureMins, rules.maxOut);

    return {
        totalPauseMins,
        // Capital pause : plafond du règlement moins ce qui a déjà été pris (indépendant de l'arrivée)
        remainingBreakMins: rules.maxPauseMins - totalPauseMins,
        departureMins: Math.floor(departureMins)
    };
}

/** Ajoute la pause en cours à la liste du jour (liste inchangée si la limite est atteinte) */
function recordPause(dayPauses, startTs, endTs) {
    const list = dayPauses || [];
    if (!startTs || list.length >= MAX_PAUSES) return list;
    return [...list, { start: formatMoroccoHM(startTs), end: formatMoroccoHM(endTs) }];
}
