// Page Réglages : édite les règles de la journée (mode normal et mode Ramadan) et les
// enregistre sous la clé dayRulesConfig, lue par day-core.js (applyDayRulesConfig).
// Dépend de salat-core.js (timeToMins, minsToHM) et day-core.js (DEFAULT_DAY_RULES, DAY_RULE_FIELDS).

const form = document.getElementById('rulesForm');
const errorEl = document.getElementById('formError');
const savedNote = document.getElementById('savedNote');
const modeCards = { normal: form.querySelector('[data-mode="normal"]'), ramadan: form.querySelector('[data-mode="ramadan"]') };

// Durées comme heures : 480 min ↔ "08:00". minsToHM borne à 24 h, ce qui suffit ici.
function minsToInput(mins) {
    return minsToHM(mins);
}
function inputToMins(value) {
    const m = timeToMins(value);
    return Number.isNaN(m) ? null : m;
}

/** Remplit les champs d'un mode à partir d'un objet de règles (minutes) */
function fillMode(mode, rules) {
    const card = modeCards[mode];
    DAY_RULE_FIELDS.forEach((field) => {
        card.querySelector(`[name="${field}"]`).value = minsToInput(rules[field]);
    });
}

function fillForm(config) {
    ['normal', 'ramadan'].forEach((mode) => {
        const base = DEFAULT_DAY_RULES[mode];
        const user = (config && config[mode]) || {};
        const rules = {};
        DAY_RULE_FIELDS.forEach((f) => {
            rules[f] = typeof user[f] === 'number' && Number.isFinite(user[f]) ? user[f] : base[f];
        });
        fillMode(mode, rules);
    });
}

function clearInvalid() {
    form.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
    errorEl.textContent = '';
}

/** Lit et valide un mode ; renvoie { rules } ou { error, field } */
function readMode(mode) {
    const card = modeCards[mode];
    const rules = {};
    for (const field of DAY_RULE_FIELDS) {
        const input = card.querySelector(`[name="${field}"]`);
        const mins = inputToMins(input.value);
        if (mins === null) return { error: 'Remplissez tous les champs (heures valides).', input };
        rules[field] = mins;
    }
    if (rules.workMins <= 0) return { error: 'La durée de travail doit être supérieure à zéro.', input: card.querySelector('[name="workMins"]') };
    if (rules.maxPauseMins < 0) return { error: 'La pause maximum ne peut pas être négative.', input: card.querySelector('[name="maxPauseMins"]') };
    if (rules.maxOut < rules.minOut) return { error: 'La sortie au plus tard doit être postérieure (ou égale) à la sortie au plus tôt.', input: card.querySelector('[name="maxOut"]') };
    return { rules };
}

function labelFor(mode) {
    return mode === 'ramadan' ? 'Ramadan' : 'normal';
}

function showSaved() {
    savedNote.textContent = 'Enregistré';
    savedNote.classList.add('is-shown');
    setTimeout(() => savedNote.classList.remove('is-shown'), 2200);
}

form.addEventListener('input', clearInvalid);

form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearInvalid();
    const config = {};
    for (const mode of ['normal', 'ramadan']) {
        const res = readMode(mode);
        if (res.error) {
            errorEl.textContent = `Mode ${labelFor(mode)} : ${res.error}`;
            if (res.input) { res.input.classList.add('is-invalid'); res.input.focus(); }
            return;
        }
        config[mode] = res.rules;
    }
    chrome.storage.local.set({ [DAY_RULES_KEY]: config }, showSaved);
});

document.getElementById('resetBtn').addEventListener('click', () => {
    clearInvalid();
    fillForm(null); // recharge les valeurs par défaut dans les champs
    chrome.storage.local.remove(DAY_RULES_KEY, () => {
        savedNote.textContent = 'Réinitialisé';
        savedNote.classList.add('is-shown');
        setTimeout(() => savedNote.classList.remove('is-shown'), 2200);
    });
});

// Démarrage automatique avec Windows : seulement dans l'application (window.psSystem).
// Dans l'extension de navigateur, cette API n'existe pas → section masquée.
const startupSection = document.getElementById('startupSection');
const autoLaunchToggle = document.getElementById('autoLaunch');
if (window.psSystem && startupSection) {
    startupSection.hidden = false;
    window.psSystem.getAutoLaunch()
        .then((on) => { autoLaunchToggle.checked = Boolean(on); })
        .catch(() => { /* indisponible : la case reste décochée */ });
    autoLaunchToggle.addEventListener('change', () => {
        window.psSystem.setAutoLaunch(autoLaunchToggle.checked)
            .then((on) => { autoLaunchToggle.checked = Boolean(on); })
            .catch(() => { /* échec : on ne bloque pas l'utilisateur */ });
    });
}

// Chargement initial
chrome.storage.local.get(DAY_RULES_KEY, (res) => fillForm(res[DAY_RULES_KEY]));

// ------------------------------------------------------------- Mises à jour (window.psUpdater)

const updaterSection = document.getElementById('updaterSection');
if (window.psUpdater && updaterSection) {
    updaterSection.hidden = false;

    const currentVersionLabel = document.getElementById('currentVersionLabel');
    const lastCheckLabel = document.getElementById('lastCheckLabel');
    const updateStatusPill = document.getElementById('updateStatusPill');
    const checkUpdateBtn = document.getElementById('checkUpdateBtn');
    const checkUpdateBtnText = document.getElementById('checkUpdateBtnText');
    const checkUpdateIcon = document.getElementById('checkUpdateIcon');
    const updateStatusDetail = document.getElementById('updateStatusDetail');
    const updateActionRow = document.getElementById('updateActionRow');
    const updateActionDescription = document.getElementById('updateActionDescription');
    const updateNowBtn = document.getElementById('updateNowBtn');

    function formatTime(ts) {
        if (!ts) return 'Jamais';
        const d = new Date(ts);
        const now = Date.now();
        const diffSecs = Math.round((now - ts) / 1000);
        if (diffSecs < 60) return "À l'instant";
        if (diffSecs < 3600) return `Il y a ${Math.floor(diffSecs / 60)} min`;
        return `Aujourd'hui à ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    function renderUpdaterState(status) {
        if (!status) return;

        currentVersionLabel.textContent = `Version ${status.currentVersion}`;
        lastCheckLabel.textContent = `Dernière vérification : ${formatTime(status.lastCheck)}`;

        // Reset classes
        updateStatusPill.className = 'update-status-pill';
        checkUpdateIcon.classList.remove('spinner-icon');
        checkUpdateBtn.disabled = false;
        checkUpdateBtnText.textContent = 'Vérifier';

        switch (status.state) {
            case 'checking':
                updateStatusPill.classList.add('update-status-pill--checking');
                updateStatusPill.textContent = 'Recherche...';
                checkUpdateIcon.classList.add('spinner-icon');
                checkUpdateBtn.disabled = true;
                checkUpdateBtnText.textContent = 'Vérification...';
                updateStatusDetail.textContent = 'Recherche de nouvelles versions sur GitHub Releases...';
                updateActionRow.style.display = 'none';
                break;

            case 'available':
                updateStatusPill.classList.add('update-status-pill--available');
                updateStatusPill.textContent = `v${status.latestVersion} disponible`;
                updateStatusDetail.textContent = `Une nouvelle version (${status.latestVersion}) est disponible sur GitHub.`;
                updateActionRow.style.display = 'flex';
                updateActionDescription.textContent = `Version ${status.latestVersion} prête au téléchargement`;
                updateNowBtn.disabled = false;
                updateNowBtn.textContent = 'Télécharger la mise à jour';
                break;

            case 'downloading':
                updateStatusPill.classList.add('update-status-pill--available');
                const percent = status.progress ? `${status.progress.percent}%` : '...';
                updateStatusPill.textContent = `Téléchargement ${percent}`;
                updateStatusDetail.textContent = status.progress
                    ? `${window.psUpdaterUi.formatBytes(status.progress.transferred)} / ${window.psUpdaterUi.formatBytes(status.progress.total)} (${percent})`
                    : 'Téléchargement en cours...';
                updateActionRow.style.display = 'flex';
                updateActionDescription.textContent = 'Téléchargement en arrière-plan...';
                updateNowBtn.disabled = true;
                updateNowBtn.textContent = 'Téléchargement...';
                break;

            case 'downloaded':
                updateStatusPill.classList.add('update-status-pill--latest');
                updateStatusPill.textContent = 'Prêt à installer';
                updateStatusDetail.textContent = 'La mise à jour a été téléchargée avec succès.';
                updateActionRow.style.display = 'flex';
                updateActionDescription.textContent = 'Redémarrez pour appliquer la mise à jour';
                updateNowBtn.disabled = false;
                updateNowBtn.textContent = 'Redémarrer & installer';
                break;

            case 'offline':
                updateStatusPill.classList.add('update-status-pill--error');
                updateStatusPill.textContent = 'Hors-ligne';
                updateStatusDetail.textContent = status.error || 'Connexion internet indisponible.';
                updateActionRow.style.display = 'none';
                break;

            case 'rate-limited':
                updateStatusPill.classList.add('update-status-pill--error');
                updateStatusPill.textContent = 'Limite atteinte';
                updateStatusDetail.textContent = status.error || 'Limite de requêtes atteinte. Réessayez plus tard.';
                updateActionRow.style.display = 'none';
                break;

            case 'error':
                updateStatusPill.classList.add('update-status-pill--error');
                updateStatusPill.textContent = 'Erreur';
                updateStatusDetail.textContent = status.error || 'Impossible de vérifier les mises à jour.';
                updateActionRow.style.display = 'none';
                break;

            case 'not-available':
            default:
                updateStatusPill.classList.add('update-status-pill--latest');
                updateStatusPill.textContent = 'À jour';
                updateStatusDetail.textContent = 'Vous disposez de la version la plus récente.';
                updateActionRow.style.display = 'none';
                break;
        }
    }

    checkUpdateBtn.addEventListener('click', async () => {
        checkUpdateBtn.disabled = true;
        checkUpdateIcon.classList.add('spinner-icon');
        checkUpdateBtnText.textContent = 'Vérification...';
        try {
            const status = await window.psUpdater.check(true);
            renderUpdaterState(status);
            if (status.state === 'available' && window.psUpdaterUi) {
                window.psUpdaterUi.showUpdateModal(status);
            }
        } catch (err) {
            console.error('Erreur vérification mise à jour :', err);
        } finally {
            checkUpdateBtn.disabled = false;
            checkUpdateIcon.classList.remove('spinner-icon');
        }
    });

    updateNowBtn.addEventListener('click', async () => {
        const status = await window.psUpdater.getStatus();
        if (status.state === 'downloaded') {
            updateNowBtn.disabled = true;
            updateNowBtn.textContent = 'Installation...';
            await window.psUpdater.install();
        } else if (status.state === 'available') {
            if (window.psUpdaterUi) {
                window.psUpdaterUi.showUpdateModal(status);
            }
            await window.psUpdater.download();
        }
    });

    window.psUpdater.onStatusChange(renderUpdaterState);
    window.psUpdater.getStatus().then(renderUpdaterState);
}
