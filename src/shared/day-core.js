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

/**
 * Simule l'ajout d'une durée de pause supplémentaire (en minutes) en tenant compte
 * des pauses déjà prises (fermées + pause active en cours).
 */
function simulatePauseDuration({ clockIn, dayPauses, activeSecs, ramadan, extraPauseMins }) {
    const rules = dayRules(ramadan);
    const current = computeDay({ clockIn, dayPauses, activeSecs, ramadan });
    const extra = Math.max(0, toFiniteNumber(Number(extraPauseMins), 0));
    const existingPauseMins = current.totalPauseMins;
    const totalPauseMins = existingPauseMins + extra;
    const arrivalMins = timeToMins(clockIn);

    const rawDepartureMins = arrivalMins + rules.workMins + totalPauseMins;
    let departureMins = Math.max(rawDepartureMins, rules.minOut);
    if (rules.maxOut !== null) departureMins = Math.min(departureMins, rules.maxOut);

    const remainingBreakMins = rules.maxPauseMins - totalPauseMins;
    const exceedsMaxOutMins = rules.maxOut !== null ? Math.max(0, Math.ceil(rawDepartureMins - rules.maxOut)) : 0;
    const exceedsBudgetMins = Math.max(0, Math.ceil(totalPauseMins - rules.maxPauseMins));
    const underMinOutMins = Math.max(0, Math.floor(rules.minOut - rawDepartureMins));

    return {
        extraPauseMins: extra,
        existingPauseMins,
        totalPauseMins,
        remainingBreakMins,
        rawDepartureMins: Math.floor(rawDepartureMins),
        departureMins: Math.floor(departureMins),
        currentDepartureMins: current.departureMins,
        exceedsMaxOutMins,
        exceedsBudgetMins,
        underMinOutMins
    };
}

/**
 * Calcule le temps de pause supplémentaire disponible pour sortir à une heure cible
 * (targetOutMins), en tenant compte de l'heure d'arrivée et des pauses déjà effectuées.
 */
function simulateTargetDeparture({ clockIn, dayPauses, activeSecs, ramadan, targetOutMins }) {
    const rules = dayRules(ramadan);
    const current = computeDay({ clockIn, dayPauses, activeSecs, ramadan });
    const arrivalMins = timeToMins(clockIn);
    const existingPauseMins = current.totalPauseMins;
    const target = toFiniteNumber(Number(targetOutMins), rules.minOut);

    // Heure de sortie théorique non bornée avec les seules pauses existantes
    const baseDepartureMins = arrivalMins + rules.workMins + existingPauseMins;
    // Temps de pause additionnel possible avant d'atteindre l'heure cible
    const availablePauseMins = target - baseDepartureMins;
    const budgetRemainingMins = current.remainingBreakMins;
    const effectiveAvailableMins = Math.max(0, Math.min(availablePauseMins, budgetRemainingMins));

    const isTargetBeforeMinOut = target < rules.minOut;
    const isTargetAfterMaxOut = rules.maxOut !== null && target > rules.maxOut;
    const isAlreadyPastTarget = availablePauseMins < 0;
    const overTargetByMins = isAlreadyPastTarget ? Math.ceil(-availablePauseMins) : 0;
    const exceedsBudgetByMins = availablePauseMins > Math.max(0, budgetRemainingMins)
        ? Math.floor(availablePauseMins - Math.max(0, budgetRemainingMins))
        : 0;

    return {
        targetOutMins: target,
        existingPauseMins,
        baseDepartureMins: Math.floor(baseDepartureMins),
        currentDepartureMins: current.departureMins,
        availablePauseMins: Math.floor(Math.max(0, availablePauseMins)),
        rawAvailablePauseMins: availablePauseMins,
        budgetRemainingMins,
        effectiveAvailableMins: Math.floor(effectiveAvailableMins),
        isTargetBeforeMinOut,
        isTargetAfterMaxOut,
        isAlreadyPastTarget,
        overTargetByMins,
        exceedsBudgetByMins
    };
}

