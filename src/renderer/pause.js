// Fenêtre « Je suis en pause » : ouverte en plein écran sur chaque écran du PC
// par le service worker dès qu'une pause démarre (pause-screen.js).
// Se ferme d'elle-même quand la pause se termine, d'ici ou d'ailleurs.

const TICK_MS = 1000;
const WRONG_PIN_DELAY_MS = 1500;
const STATE_KEYS = ['isPaused', 'pauseStartTime', 'clockIn', 'pauses', 'isRamadanMode', PIN_HASH_KEY, DAY_RULES_KEY];

const root = document.getElementById('host').attachShadow({ mode: 'open' });
root.innerHTML = `<style>${OVERLAY_CSS}</style><div class="compact"><div class="veil"></div></div>`;
const veil = root.querySelector('.veil');

let stored = {};
let els = null;
let cardKey = null; // thème + verrouillage de la carte affichée

function buildCard(isRamadan, locked) {
    applyOverlayTheme(veil, OVERLAY_THEMES[isRamadan ? 'ramadan' : 'normal'], chrome.runtime.getURL('sallepause.jpg'));
    // Avec un code PIN, le bouton ne suffit plus : il faut taper le code
    const action = locked
        ? `<form class="pin-form">
               <input class="pin-input" type="password" inputmode="numeric" autocomplete="off"
                      maxlength="8" placeholder="Code PIN" aria-label="Code PIN" aria-describedby="pin-error">
               <p class="pin-error" id="pin-error" role="alert"></p>
               <button class="close" type="submit">Terminer la pause</button>
           </form>`
        : `<button class="close" type="button">Terminer la pause</button>`;
    veil.innerHTML = `
        <div class="card" role="status">
            <div class="medallion" aria-hidden="true">${isRamadan ? '🌙' : '☕'}</div>
            <h1>${isRamadan ? 'Je suis en pause Dodo !' : 'Je suis en pause !'}</h1>
            <p class="countdown" aria-live="off">00:00:00</p>
            <p class="detail"></p>
            ${action}
        </div>`;
    els = {
        countdown: veil.querySelector('.countdown'),
        detail: veil.querySelector('.detail'),
        close: veil.querySelector('.close'),
        pin: veil.querySelector('.pin-input'),
        pinError: veil.querySelector('.pin-error')
    };
    if (locked) {
        veil.querySelector('.pin-form').addEventListener('submit', (e) => {
            e.preventDefault();
            endPause();
        });
        els.pin.addEventListener('input', () => {
            els.pin.value = els.pin.value.replace(/\D/g, '');
            els.pin.classList.remove('is-wrong');
            els.pinError.textContent = '';
        });
        els.pin.focus();
    } else {
        els.close.addEventListener('click', endPause);
    }
    cardKey = `${isRamadan}:${locked}`;
}

async function endPause() {
    els.close.disabled = true;
    const pin = els.pin ? els.pin.value : undefined;
    try {
        const res = await chrome.runtime.sendMessage({ type: 'pause:stop', pin });
        if (res && res.ok) { window.close(); return; }
        if (els.pin) return rejectPin(res);
    } catch (err) {
        console.error('[Pause & Salat] Fin de pause impossible :', err);
    }
    window.close();
}

function rejectPin(res) {
    els.pin.value = '';
    els.pin.classList.remove('is-wrong');
    void els.pin.offsetWidth; // relance l'animation
    els.pin.classList.add('is-wrong');
    els.pinError.textContent = pinRetryMessage(res && res.retryInSecs);
    // Petit délai entre deux essais pour freiner les tentatives au hasard
    setTimeout(() => {
        els.close.disabled = false;
        els.pin.focus();
    }, WRONG_PIN_DELAY_MS);
}

function render() {
    if (!stored.isPaused) {
        window.close();
        return;
    }
    applyDayRulesConfig(stored[DAY_RULES_KEY]); // règles configurées, pour la sortie prévue
    const isRamadan = Boolean(stored.isRamadanMode);
    const locked = Boolean(stored[PIN_HASH_KEY]);
    if (!els || cardKey !== `${isRamadan}:${locked}`) buildCard(isRamadan, locked);

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
