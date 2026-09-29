// Fenêtre de secours du rappel : ouverte par le service worker au-dessus d'une fenêtre
// Chrome dont l'onglet actif ne peut pas afficher l'overlay (Nouvel onglet, chrome://, PDF...).
// Se ferme d'elle-même quand le rappel est fermé ailleurs ou que le temps de la prière est passé.

const TICK_MS = 1000;

const root = document.getElementById('host').attachShadow({ mode: 'open' });
root.innerHTML = `<style>${OVERLAY_CSS}</style><div class="compact"><div class="veil"></div></div>`;
const veil = root.querySelector('.veil');

let stored = {};
let card = null;
let cardTheme = null;

function render() {
    const alert = pendingSalatAlert(stored);
    if (!alert) {
        window.close();
        return;
    }
    const theme = stored.isRamadanMode ? 'ramadan' : 'normal';
    if (!card || theme !== cardTheme) {
        applyOverlayTheme(veil, OVERLAY_THEMES[theme], chrome.runtime.getURL('sallepause.jpg'));
        card = createSalatCard(veil, (shown) => {
            chrome.storage.local.set({ salatDismissedKey: shown.key }).finally(() => window.close());
        });
        cardTheme = theme;
    }
    card.update(alert);
    document.title = `NOD TWADDA ! ${PRAYER_LABELS[alert.name]} ${minsToHM(alert.mins)}`;
}

chrome.storage.local.get([...SALAT_ALERT_KEYS, 'isRamadanMode'], (res) => {
    stored = res;
    render();
    setInterval(render, TICK_MS);
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [k, v] of Object.entries(changes)) stored = { ...stored, [k]: v.newValue };
    render();
});
