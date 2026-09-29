// Fenêtre « Je suis en pause » : ouverte en plein écran sur chaque écran du PC
// dès qu'une pause démarre.
// Se ferme d'elle-même quand la pause se termine, d'ici ou d'ailleurs.

const TICK_MS = 1000;
const STATE_KEYS = ['isPaused', 'pauseStartTime', 'clockIn', 'pauses', 'isRamadanMode', DAY_RULES_KEY];

const root = document.getElementById('host').attachShadow({ mode: 'open' });
root.innerHTML = `<style>${OVERLAY_CSS}</style><div class="compact"><div class="veil"></div></div>`;
const veil = root.querySelector('.veil');

let stored = {};
let els = null;
let cardKey = null; // thème de la carte affichée

function buildCard(isRamadan) {
    applyOverlayTheme(veil, OVERLAY_THEMES[isRamadan ? 'ramadan' : 'normal'], chrome.runtime.getURL('sallepause.jpg'));
    veil.innerHTML = `
        <div class="card" role="status">
            <div class="medallion" aria-hidden="true">${isRamadan ? '🌙' : '☕'}</div>
            <h1>${isRamadan ? 'Je suis en pause Dodo !' : 'Je suis en pause !'}</h1>
            <p class="countdown" aria-live="off">00:00:00</p>
            <p class="detail"></p>
            <button class="close" type="button">Terminer la pause</button>
        </div>`;
    els = {
        countdown: veil.querySelector('.countdown'),
        detail: veil.querySelector('.detail'),
        close: veil.querySelector('.close')
    };
    els.close.addEventListener('click', endPause);
    cardKey = `${isRamadan}`;
}

async function endPause() {
    if (els && els.close) els.close.disabled = true;
    try {
        await chrome.runtime.sendMessage({ type: 'pause:stop' });
    } catch (err) {
        console.error('[Pause] Fin de pause impossible :', err);
    }
    window.close();
}

function render() {
    if (!stored.isPaused) {
        window.close();
        return;
    }
    applyDayRulesConfig(stored[DAY_RULES_KEY]); // règles configurées, pour la sortie prévue
    const isRamadan = Boolean(stored.isRamadanMode);
    if (!els || cardKey !== `${isRamadan}`) buildCard(isRamadan);

    const activeSecs = stored.pauseStartTime ? Math.max(0, Math.floor((Date.now() - stored.pauseStartTime) / 1000)) : 0;
    els.countdown.textContent =
        `${pad2(Math.floor(activeSecs / 3600))}:${pad2(Math.floor((activeSecs % 3600) / 60))}:${pad2(activeSecs % 60)}`;

    const day = computeDay({
        clockIn: stored.clockIn || DEFAULT_CLOCK_IN,
        dayPauses: stored.pauses,
        activeSecs,
        ramadan: isRamadan
    });
    els.detail.textContent = `Sortie prévue : ${minsToHM(day.departureMins)}`;
    document.title = `Je suis en pause — ${els.countdown.textContent}`;
}

chrome.storage.local.get(STATE_KEYS, (res) => {
    stored = res;
    render();
    setInterval(render, TICK_MS);
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const k of STATE_KEYS) if (changes[k]) stored = { ...stored, [k]: changes[k].newValue };
    render();
});
