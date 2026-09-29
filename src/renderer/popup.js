// Dépend de salat-core.js (heure du Maroc, horaires) et de day-core.js (règles de la journée).
// L'historique SQLite est écrit par le service worker (background.js), via messages.

// --- VARIABLES D'ÉTAT ---
let pauses = [];
let isPaused = false;
let pauseStartTime = null;
let isRamadanMode = false;
let workDate = null;          // Journée (YYYY-MM-DD) à laquelle appartiennent les données
let salatDay = null;          // { date, times } fourni par le service worker
let salatError = null;

const DAY_KEYS = ['clockIn', 'pauses', 'isPaused', 'pauseStartTime', 'workDate'];
// DEFAULT_CLOCK_IN, MAX_PAUSES, DAY_RULES, pauseMins() et computeDay() : day-core.js

// --- SÉLECTEURS ---
const clockInInput = document.getElementById('clockIn');
const ramadanToggle = document.getElementById('ramadanToggle');
const pauseActionBtn = document.getElementById('pauseActionBtn');
const activePauseDisplay = document.getElementById('activePauseDisplay');
const pausesList = document.getElementById('pausesList');
const totalPauseDisplay = document.getElementById('totalPauseMins');
const clockOutDisplay = document.getElementById('clockOut');
const timerDisplay = document.getElementById('timer');
const availableBreakDisplay = document.getElementById('availableBreakDisplay');
const availLabel = document.getElementById('availLabel');
const appWrapper = document.getElementById('appWrapper');
const limitBadge = document.getElementById('limitBadge');
const salatName = document.getElementById('salatName');
const salatTime = document.getElementById('salatTime');
const salatCountdown = document.getElementById('salatCountdown');
const salatSection = document.querySelector('.salat');
const timerRow = document.getElementById('timerRow');
const salatRetryBtn = document.getElementById('salatRetry');
const reminderPicker = createReminderPicker({
    trigger: document.getElementById('reminderTrigger'),
    label: document.getElementById('reminderLabel'),
    menu: document.getElementById('reminderMenu'),
    choices: ALERT_LEAD_CHOICES,
    onChange: (lead) => chrome.storage.local.set({ salatAlertLead: lead })
});
const historyStatus = document.getElementById('historyStatus');

// --- INITIALISATION ---
chrome.storage.local.get([...DAY_KEYS, 'isRamadanMode', 'salatDay', 'salatError', 'salatAlertLead', DAY_RULES_KEY], async (res) => {
    isRamadanMode = res.isRamadanMode || false;
    applyDayRulesConfig(res[DAY_RULES_KEY]); // règles configurées (ou défauts) avant tout calcul
    salatDay = res.salatDay || null;
    salatError = res.salatError || null;

    const today = moroccoDateKey();
    if (res.workDate && res.workDate !== today) {
        // Nouvelle journée : la précédente est déjà dans l'historique, on repart à zéro
        await archiveDay({ ...res, isRamadanMode });
        await chrome.storage.local.remove(DAY_KEYS);
        loadDay({});
    } else {
        loadDay(res);
    }

    ramadanToggle.checked = isRamadanMode;
    // Pas encore de réglage enregistré → même valeur par défaut que les onglets (10 min)
    reminderPicker.setValue(res.salatAlertLead === undefined ? DEFAULT_ALERT_LEAD_MINS : res.salatAlertLead);

    applyModeStyles();
    renderHistory();
    updateUI();
    requestSalatDay();
});

function loadDay(res) {
    clockInInput.value = res.clockIn || DEFAULT_CLOCK_IN;
    pauses = res.pauses || [];
    isPaused = res.isPaused || false;
    pauseStartTime = res.pauseStartTime || null;
    workDate = res.workDate || moroccoDateKey();
}

// Horaires mis à jour par le service worker
chrome.storage.onChanged.addListener((changes) => {
    // Pause démarrée/terminée ailleurs (écran plein écran) : le popup se resynchronise.
    // Ses propres écritures ne déclenchent rien : l'état est déjà celui du stockage.
    if (changes.isPaused && Boolean(changes.isPaused.newValue) !== isPaused) {
        chrome.storage.local.get(['isPaused', 'pauseStartTime', 'pauses'], (res) => {
            isPaused = Boolean(res.isPaused);
            pauseStartTime = res.pauseStartTime || null;
            pauses = res.pauses || [];
            renderHistory();
            updateUI();
        });
    }
    if (changes[DAY_RULES_KEY]) {
        // Règles modifiées depuis la page Réglages : recalcul immédiat
        applyDayRulesConfig(changes[DAY_RULES_KEY].newValue);
        applyModeStyles();
        updateUI();
    }
    if (changes.salatDay) salatDay = changes.salatDay.newValue || null;
    if (changes.salatError) salatError = changes.salatError.newValue || null;
    if (changes.salatAlertLead) {
        const lead = changes.salatAlertLead.newValue;
        reminderPicker.setValue(lead === undefined ? DEFAULT_ALERT_LEAD_MINS : lead);
    }
});

const SALAT_REQUEST_INTERVAL_MS = 60000;
let lastSalatRequest = 0;

function requestSalatDay({ force = false } = {}) {
    if (!force && salatDay && salatDay.date === moroccoDateKey()) return;
    const now = Date.now();
    if (!force && now - lastSalatRequest < SALAT_REQUEST_INTERVAL_MS) return;
    lastSalatRequest = now;

    chrome.runtime.sendMessage({ type: 'salat:ensure', force })
        .then((day) => { if (!day) throw new Error('Aucun horaire renvoyé'); })
        .catch((err) => {
            // Service worker absent (extension pas rechargée) ou en échec : le popup récupère lui-même
            console.warn('[Pause & Salat] Service worker indisponible, récupération directe :', err);
            return fetchSalatDay(moroccoDateKey())
                .then((day) => chrome.storage.local.set({ salatDay: day, salatError: null }))
                .catch((fetchErr) => {
                    salatError = String(fetchErr.message || fetchErr);
                    console.error('[Pause & Salat] Horaires indisponibles :', fetchErr);
                });
        });
}

// --- ÉCOUTEURS D'ÉVÉNEMENTS ---

ramadanToggle.addEventListener('change', (e) => {
    isRamadanMode = e.target.checked;
    applyModeStyles();
    saveData();
    updateUI();
});

clockInInput.addEventListener('change', () => {
    saveData();
    updateUI();
});

salatRetryBtn.addEventListener('click', () => {
    salatError = null;
    salatCountdown.innerText = "Chargement…";
    requestSalatDay({ force: true });
});

pauseActionBtn.addEventListener('click', async () => {
    if (!isPaused) {
        isPaused = true;
        pauseStartTime = Date.now();
    } else {
        if (!isPaused) return; // terminée entre-temps sur l'écran de pause
        isPaused = false;
        pauses = recordPause(pauses, pauseStartTime, Date.now());
        pauseStartTime = null;
        renderHistory();
    }
    saveData();
    updateUI();
});

document.getElementById('historyBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
});

document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
});

document.getElementById('resetBtn').addEventListener('click', async () => {
    if (!confirm("Réinitialiser toutes les données de la journée ?")) return;
    const res = await sendHistoryMessage({ type: 'history:deleteDay', date: workDate });
    if (!res.ok) console.error("[Pause & Salat] Suppression de l'historique du jour impossible :", res.error);
    // Les réglages (Ramadan, rappel salat) et les horaires sont conservés
    chrome.storage.local.remove(DAY_KEYS, () => location.reload());
});

// --- FONCTIONS ---

function applyModeStyles() {
    appWrapper.classList.toggle('ramadan-active', isRamadanMode);
    limitBadge.innerText = isRamadanMode ? "Entre 15:30 et 16:30" : "Entre 17:00 et 18:00";
    availLabel.innerText = "Pause dispo (max " + formatDuration(dayRules(isRamadanMode).maxPauseMins) + ")";
}

function formatPauseDur(p) {
    const diff = pauseMins(p);
    return Number.isNaN(diff) || diff < 0 ? "--" : formatDuration(diff);
}

function updateDurDisplay(span) {
    span.innerText = formatPauseDur(pauses[span.dataset.idx]);
}

function renderHistory() {
    pausesList.innerHTML = "";
    if (pauses.length === 0) {
        const empty = document.createElement('p');
        empty.className = "pauses-empty";
        empty.innerText = "Aucune pause enregistrée aujourd'hui.";
        pausesList.appendChild(empty);
        return;
    }

    pauses.forEach((p, index) => {
        const row = document.createElement('div');
        row.className = "pause-row";
        row.innerHTML = `
            <span class="p-idx">P${index + 1}</span>
            <input type="time" class="time-input p-start" data-idx="${index}" aria-label="Début de la pause ${index + 1}">
            <span class="p-sep" aria-hidden="true">→</span>
            <input type="time" class="time-input p-end" data-idx="${index}" aria-label="Fin de la pause ${index + 1}">
            <span class="p-dur" data-idx="${index}"></span>
            <button type="button" class="btn-del" data-idx="${index}" title="Supprimer" aria-label="Supprimer la pause ${index + 1}">×</button>
        `;
        row.querySelector('.p-start').value = p.start || "";
        row.querySelector('.p-end').value = p.end || "";
        pausesList.appendChild(row);
    });

    document.querySelectorAll('.p-dur').forEach(updateDurDisplay);

    document.querySelectorAll('.p-start, .p-end').forEach(input => {
        input.addEventListener('change', (e) => {
            const idx = Number(e.target.dataset.idx);
            const key = e.target.classList.contains('p-start') ? 'start' : 'end';
            pauses = pauses.map((p, i) => (i === idx ? { ...p, [key]: e.target.value } : p));
            saveData();
            updateUI();
            updateDurDisplay(document.querySelector(`.p-dur[data-idx="${idx}"]`));
        });
    });

    document.querySelectorAll('.btn-del').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = Number(e.currentTarget.dataset.idx);
            pauses = pauses.filter((_, i) => i !== idx);
            renderHistory();
            saveData();
            updateUI();
        });
    });
}

function updateSalatBanner() {
    const today = moroccoDateKey();
    const times = salatDay && salatDay.date === today ? salatDay.times : null;
    if (!times) requestSalatDay();

    const isUnavailable = !times && Boolean(salatError);
    salatSection.classList.toggle('is-unavailable', isUnavailable);
    salatRetryBtn.hidden = !isUnavailable;
    if (!times) {
        salatName.innerText = "--";
        salatTime.innerText = "--:--";
        if (isUnavailable) salatCountdown.innerText = "Horaires indisponibles";
        else if (salatCountdown.innerText !== "Chargement…") salatCountdown.innerText = "--:--:--";
        return;
    }

    const nowSecs = moroccoNowSecs();
    const next = nextPrayer(times, nowSecs);
    const remSecs = next.mins * 60 - nowSecs;

    salatName.innerText = PRAYER_LABELS[next.name];
    salatTime.innerText = minsToHM(next.mins);
    salatCountdown.innerText =
        `${pad2(Math.floor(remSecs / 3600))}:${pad2(Math.floor((remSecs % 3600) / 60))}:${pad2(remSecs % 60)}`;
}

function updateUI() {
    updateSalatBanner();

    const activeSecs = isPaused && pauseStartTime ? Math.floor((Date.now() - pauseStartTime) / 1000) : 0;
    const day = computeDay({ clockIn: clockInInput.value, dayPauses: pauses, activeSecs, ramadan: isRamadanMode });

    // Pause en cours
    timerRow.classList.toggle('is-running', isPaused);
    pauseActionBtn.innerText = isPaused ? "Terminer la pause" : "Démarrer la pause";
    pauseActionBtn.className = isPaused ? "btn-action btn-stop" : "btn-action btn-start";
    activePauseDisplay.innerText =
        `${pad2(Math.floor(activeSecs / 3600))}:${pad2(Math.floor((activeSecs % 3600) / 60))}:${pad2(activeSecs % 60)}`;

    totalPauseDisplay.innerText = `Total: ${formatDuration(day.totalPauseMins)}`;

    // Capital pause
    const isBreakEmpty = day.remainingBreakMins < 0;
    availableBreakDisplay.innerText = formatDuration(isBreakEmpty ? 0 : day.remainingBreakMins);
    availableBreakDisplay.classList.toggle('is-empty', isBreakEmpty);

    // Sortie réelle + compte à rebours (heure du Maroc)
    clockOutDisplay.innerText = minsToHM(day.departureMins);
    const diffSecs = (day.departureMins % 1440) * 60 - moroccoNowSecs();
    timerDisplay.classList.toggle('is-done', diffSecs <= 0);
    timerDisplay.innerText = diffSecs <= 0
        ? "00:00:00"
        : `${pad2(Math.floor(diffSecs / 3600))}:${pad2(Math.floor((diffSecs % 3600) / 60))}:${pad2(diffSecs % 60)}`;
}

// --- HISTORIQUE (SQLite, via le service worker) ---

function sendHistoryMessage(msg) {
    return chrome.runtime.sendMessage(msg)
        .then((res) => res || { ok: false, error: 'Pas de réponse' })
        .catch((err) => ({ ok: false, error: String(err.message || err) }));
}

async function archiveDay(state) {
    if (!state.workDate) return;
    const clockIn = state.clockIn || DEFAULT_CLOCK_IN;
    const dayPauses = state.pauses || [];
    const ramadan = Boolean(state.isRamadanMode);
    const { departureMins } = computeDay({ clockIn, dayPauses, activeSecs: 0, ramadan });
    const res = await sendHistoryMessage({
        type: 'history:saveDay',
        day: { date: state.workDate, clockIn, ramadan, departure: minsToHM(departureMins), pauses: dayPauses }
    });
    if (!res.ok) console.error("[Pause & Salat] Enregistrement de l'historique impossible :", res.error);
    setHistoryStatus(res.ok ? 'saved' : (isHistoryWasmBlocked(res.error) ? 'reload' : 'error'));
}

// Même détection que HistoryDb.isWasmBlocked (le popup ne charge pas SQLite)
function isHistoryWasmBlocked(error) {
    return /WebAssembly|wasm-eval|Content Security/i.test(String(error));
}

const HISTORY_STATUS_TITLES = {
    saved: "Journée enregistrée dans l'historique",
    error: "Historique non enregistré, réessayez en modifiant la journée",
    reload: "Historique bloqué : rechargez l'extension dans chrome://extensions (bouton ↻)"
};

function setHistoryStatus(state) {
    historyStatus.dataset.state = state;
    document.getElementById('historyBtn').title = `Voir l'historique. ${HISTORY_STATUS_TITLES[state]}`;
}

function saveData() {
    chrome.storage.local.set({
        clockIn: clockInInput.value,
        pauses: pauses,
        isPaused: isPaused,
        pauseStartTime: pauseStartTime,
        isRamadanMode: isRamadanMode,
        workDate: workDate
    });
    archiveDay({ workDate, clockIn: clockInInput.value, pauses, isRamadanMode });
}

// Mise à jour toutes les secondes
setInterval(updateUI, 1000);
