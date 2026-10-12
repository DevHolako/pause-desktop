// Règles de la journée de travail, partagées par le popup, la fenêtre de pause
// plein écran et le service worker. Aucune dépendance au DOM.
// Chargé aussi via importScripts : déclarations en var/function uniquement.
// Dépend de salat-core.js (timeToMins).

var DEFAULT_CLOCK_IN = '08:00';
var MAX_PAUSES = 30;

// Règles par défaut (minutes depuis minuit) :
//   workMins     : durée de travail effectif
//   minPauseMins : pause minimum obligatoire déduite d'office quoi qu'il arrive (ex. 30 min)
//   maxPauseMins : capital pause du règlement (ex. 30 min obligatoires + 30 min optionnelles)
//   minOut/maxOut: bornes de l'heure de sortie réelle
// L'utilisateur peut tout remplacer depuis la page Réglages (clé de stockage dayRulesConfig).
var DEFAULT_DAY_RULES = {
    normal: { workMins: 480, minPauseMins: 30, maxPauseMins: 60, minOut: 1020, maxOut: 1080 }, // 8h travail, 30m pause min obligatoire, 1h pause max, sortie 17:00–18:00
    ramadan: { workMins: 420, minPauseMins: 30, maxPauseMins: 60, minOut: 930, maxOut: 990 }   // 7h travail, 30m pause min obligatoire, 1h pause max, sortie 15:30–16:30
};

var DAY_RULES_KEY = 'dayRulesConfig';
var DAY_RULE_FIELDS = ['workMins', 'minPauseMins', 'maxPauseMins', 'minOut', 'maxOut'];

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

/** Calculs de la journée (pur) : total des pauses, pause effective (avec min obligatoire), capital restant, sortie */
function computeDay({ clockIn, dayPauses, activeSecs, ramadan }) {
    const rules = dayRules(ramadan);
    const closedMins = (dayPauses || []).reduce((sum, p) => {
        const diff = pauseMins(p);
        return diff > 0 ? sum + diff : sum;
    }, 0);
    const totalPauseMins = closedMins + (activeSecs || 0) / 60;
    const minPauseMins = Math.max(0, toFiniteNumber(rules.minPauseMins, 0));
    // La pause minimum obligatoire est comptabilisée quoi qu'il arrive dans le calcul de sortie
    const effectivePauseMins = Math.max(totalPauseMins, minPauseMins);
    const mandatoryRemainingMins = Math.max(0, minPauseMins - totalPauseMins);
    const arrivalMins = timeToMins(clockIn);

    let departureMins = arrivalMins + rules.workMins + effectivePauseMins;
    departureMins = Math.max(departureMins, rules.minOut);
    if (rules.maxOut !== null) departureMins = Math.min(departureMins, rules.maxOut);

    return {
        totalPauseMins,
        effectivePauseMins,
        minPauseMins,
        mandatoryRemainingMins,
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
 * des pauses déjà prises (fermées + pause active en cours) et de la pause minimum obligatoire.
 */
function simulatePauseDuration({ clockIn, dayPauses, activeSecs, ramadan, extraPauseMins }) {
    const rules = dayRules(ramadan);
    const current = computeDay({ clockIn, dayPauses, activeSecs, ramadan });
    const extra = Math.max(0, toFiniteNumber(Number(extraPauseMins), 0));
    const existingPauseMins = current.totalPauseMins;
    const minPauseMins = current.minPauseMins;
    const totalPauseMins = existingPauseMins + extra;
    const effectivePauseMins = Math.max(totalPauseMins, minPauseMins);
    const mandatoryRemainingAfterMins = Math.max(0, minPauseMins - totalPauseMins);
    const absorbedByMinPauseMins = Math.max(0, Math.min(extra, minPauseMins - existingPauseMins));
    const arrivalMins = timeToMins(clockIn);

    const rawDepartureMins = arrivalMins + rules.workMins + effectivePauseMins;
    let departureMins = Math.max(rawDepartureMins, rules.minOut);
    if (rules.maxOut !== null) departureMins = Math.min(departureMins, rules.maxOut);

    const remainingBreakMins = rules.maxPauseMins - totalPauseMins;
    const exceedsMaxOutMins = rules.maxOut !== null ? Math.max(0, Math.ceil(rawDepartureMins - rules.maxOut)) : 0;
    const exceedsBudgetMins = Math.max(0, Math.ceil(totalPauseMins - rules.maxPauseMins));
    const underMinOutMins = Math.max(0, Math.floor(rules.minOut - rawDepartureMins));

    return {
        extraPauseMins: extra,
        existingPauseMins,
        minPauseMins,
        totalPauseMins,
        effectivePauseMins,
        mandatoryRemainingAfterMins,
        absorbedByMinPauseMins,
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
 * (targetOutMins), en tenant compte de l'heure d'arrivée, des pauses déjà effectuées
 * et de la pause minimum obligatoire (minPauseMins).
 */
function simulateTargetDeparture({ clockIn, dayPauses, activeSecs, ramadan, targetOutMins }) {
    const rules = dayRules(ramadan);
    const current = computeDay({ clockIn, dayPauses, activeSecs, ramadan });
    const arrivalMins = timeToMins(clockIn);
    const existingPauseMins = current.totalPauseMins;
    const minPauseMins = current.minPauseMins;
    const effectiveExistingPauseMins = current.effectivePauseMins;
    const mandatoryRemainingMins = current.mandatoryRemainingMins;
    const target = toFiniteNumber(Number(targetOutMins), rules.minOut);

    // Heure de sortie théorique au plus tôt compte tenu de la pause min obligatoire et des pauses déjà prises
    const baseDepartureMins = arrivalMins + rules.workMins + effectiveExistingPauseMins;
    // Plafond total de pause compatible avec l'heure de sortie cible
    const maxTotalPauseForTarget = target - (arrivalMins + rules.workMins);
    // Si la cible est antérieure à baseDepartureMins, l'objectif est déjà dépassé (ou impossible à cause de la pause min obligatoire)
    const isAlreadyPastTarget = target < baseDepartureMins;
    const overTargetByMins = isAlreadyPastTarget ? Math.ceil(baseDepartureMins - target) : 0;
    const isBlockedByMinPause = isAlreadyPastTarget && existingPauseMins < minPauseMins && target >= (arrivalMins + rules.workMins + existingPauseMins);

    // Temps de pause additionnel réellement disponible à partir des pauses déjà prises
    const availablePauseMins = isAlreadyPastTarget ? 0 : Math.max(0, maxTotalPauseForTarget - existingPauseMins);
    const budgetRemainingMins = current.remainingBreakMins;
    const effectiveAvailableMins = isAlreadyPastTarget ? 0 : Math.max(0, Math.min(availablePauseMins, budgetRemainingMins));

    const isTargetBeforeMinOut = target < rules.minOut;
    const isTargetAfterMaxOut = rules.maxOut !== null && target > rules.maxOut;
    const exceedsBudgetByMins = !isAlreadyPastTarget && availablePauseMins > Math.max(0, budgetRemainingMins)
        ? Math.floor(availablePauseMins - Math.max(0, budgetRemainingMins))
        : 0;

    return {
        targetOutMins: target,
        existingPauseMins,
        minPauseMins,
        effectiveExistingPauseMins,
        mandatoryRemainingMins,
        baseDepartureMins: Math.floor(baseDepartureMins),
        currentDepartureMins: current.departureMins,
        availablePauseMins: Math.floor(availablePauseMins),
        rawAvailablePauseMins: maxTotalPauseForTarget - existingPauseMins,
        budgetRemainingMins,
        effectiveAvailableMins: Math.floor(effectiveAvailableMins),
        isTargetBeforeMinOut,
        isTargetAfterMaxOut,
        isAlreadyPastTarget,
        isBlockedByMinPause,
        overTargetByMins,
        exceedsBudgetByMins
    };
}


