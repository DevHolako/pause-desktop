// Carte « NOD TWADDA ! » partagée entre l'overlay des pages (content.js)
// et la fenêtre de secours (alert.js). Réinjectable : var/function uniquement.
// Dépend de salat-core.js.

var OVERLAY_THEMES = {
    normal: { veil: 'rgba(23, 26, 58, 0.82)', card: '#3b3dbf', title: '#ffffff', accent: '#f2b632', border: 'rgba(255, 255, 255, 0.18)' },
    ramadan: { veil: 'rgba(15, 17, 51, 0.88)', card: '#1c1f66', title: '#fde68a', accent: '#f2b632', border: 'rgba(242, 182, 50, 0.55)' }
};

var OVERLAY_ZELLIGE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Cg fill='none' stroke='white' stroke-opacity='0.12' stroke-width='1'%3E%3Crect x='15' y='15' width='18' height='18'/%3E%3Crect x='15' y='15' width='18' height='18' transform='rotate(45 24 24)'/%3E%3C/g%3E%3C/svg%3E")`;

var OVERLAY_CSS = `
    :host { all: initial; }
    .veil {
        position: fixed; inset: 0;
        display: flex; align-items: center; justify-content: center;
        padding: 24px; box-sizing: border-box;
        background-size: cover; background-position: center;
        font-family: 'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
        user-select: none;
        animation: veil-in 0.35s ease-out both;
    }
    .card {
        position: relative; box-sizing: border-box;
        width: min(640px, 100%);
        padding: 44px 48px 40px;
        border-radius: 24px;
        text-align: center;
        background-color: var(--card);
        background-image: ${OVERLAY_ZELLIGE};
        border: 1px solid var(--border);
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45);
        color: #fff;
        animation: card-in 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    .medallion {
        width: 84px; height: 84px; margin: 0 auto 18px;
        display: grid; place-items: center;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid var(--border);
        font-size: 44px; line-height: 1;
    }
    .arabic {
        margin: 0 0 6px;
        font-size: 30px; font-weight: 700; line-height: 1.3;
        color: var(--accent);
    }
    h1 {
        margin: 0;
        font-size: clamp(34px, 5vw, 54px); font-weight: 800; line-height: 1.05;
        letter-spacing: -0.01em;
        color: var(--title);
    }
    .detail { margin: 14px 0 0; font-size: 20px; font-weight: 600; color: var(--accent); }
    .countdown {
        margin: 6px 0 0;
        font-size: 44px; font-weight: 700; line-height: 1.1;
        font-variant-numeric: tabular-nums;
        color: #fff;
    }
    .countdown[hidden], .arabic[hidden] { display: none; }
    .close {
        margin-top: 28px;
        padding: 14px 28px;
        border: none; border-radius: 999px;
        font-family: inherit; font-size: 16px; font-weight: 700; line-height: 1;
        color: #3a2a00; background: var(--accent);
        box-shadow: 0 3px 0 #b8861b;
        cursor: pointer;
        transition: transform 0.15s ease, filter 0.2s ease;
    }
    .close:hover { filter: brightness(1.08); }
    .close:active { transform: translateY(2px); box-shadow: 0 1px 0 #b8861b; }
    .close:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
    .rule { width: 56px; height: 4px; margin: 24px auto 0; border-radius: 4px; background: var(--accent); }
    .compact .veil { padding: 0; }
    .compact .card { width: 100%; height: 100%; border-radius: 0; border: none; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    @keyframes veil-in { from { opacity: 0; } }
    @keyframes card-in { from { opacity: 0; transform: translateY(12px) scale(0.98); } }
    @media (prefers-reduced-motion: reduce) {
        .veil, .card { animation: none; }
    }
`;

/** Applique les couleurs du thème (jour / Ramadan) et la photo de fond au voile */
function applyOverlayTheme(veil, theme, imageUrl) {
    const s = veil.style;
    s.setProperty('--card', theme.card);
    s.setProperty('--title', theme.title);
    s.setProperty('--accent', theme.accent);
    s.setProperty('--border', theme.border);
    s.backgroundImage = imageUrl
        ? `linear-gradient(${theme.veil}, ${theme.veil}), url("${imageUrl}")`
        : `linear-gradient(${theme.veil}, ${theme.veil})`;
}

/**
 * Construit la carte de rappel dans `veil` et renvoie { update(alert) }.
 * onClose(alert) est appelé au clic sur « Fermer le rappel ».
 */
function createSalatCard(veil, onClose) {
    veil.innerHTML = `
        <div class="card" role="alertdialog" aria-modal="true" aria-labelledby="ps-title" aria-describedby="ps-detail">
            <div class="medallion" aria-hidden="true">🕌</div>
            <p class="arabic" lang="ar" dir="rtl" hidden>حان وقت الصلاة</p>
            <h1 id="ps-title">NOD TWADDA !</h1>
            <p class="detail" id="ps-detail"></p>
            <p class="countdown" aria-live="off"></p>
            <button class="close" type="button">Fermer le rappel</button>
        </div>`;
    const els = {
        arabic: veil.querySelector('.arabic'),
        detail: veil.querySelector('.detail'),
        countdown: veil.querySelector('.countdown'),
        close: veil.querySelector('.close')
    };
    let current = null;
    els.close.addEventListener('click', () => { if (current) onClose(current); });

    return {
        update(alert) {
            current = alert;
            const at = minsToHM(alert.mins);
            const label = PRAYER_LABELS[alert.name];
            const isTime = alert.secsUntil <= 0;
            els.arabic.hidden = !isTime;
            els.countdown.hidden = isTime;
            if (isTime) {
                els.detail.textContent = `C'est l'heure de la prière de ${label} (${at})`;
            } else {
                els.detail.textContent = `${label} à ${at}`;
                els.countdown.textContent = `dans ${Math.floor(alert.secsUntil / 60)}m ${pad2(alert.secsUntil % 60)}s`;
            }
        }
    };
}

/** Rappel à afficher maintenant (null si aucun, désactivé ou déjà fermé), à partir de chrome.storage */
function pendingSalatAlert(stored) {
    const lead = stored.salatAlertLead === undefined ? DEFAULT_ALERT_LEAD_MINS : stored.salatAlertLead;
    const alert = activeSalatAlert(stored.salatDay || null, lead, moroccoNowSecs(), moroccoDateKey());
    return alert && alert.key !== stored.salatDismissedKey ? alert : null;
}

var SALAT_ALERT_KEYS = ['salatDay', 'salatAlertLead', 'salatDismissedKey'];
