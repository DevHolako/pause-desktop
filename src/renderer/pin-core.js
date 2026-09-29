// Version bureau : le code PIN est vérifié dans le processus principal (psPin).
// Les fenêtres ne connaissent que « un code est défini » (stocké sous pausePinSet),
// jamais l'empreinte. Ce fichier ne garde que ce dont l'interface a besoin.

var PIN_HASH_KEY = 'pausePinSet'; // clé booléenne : conserve le nom pour popup.js / pause.js
var PIN_PATTERN = /^\d{4,8}$/;

function isValidPin(pin) {
    return PIN_PATTERN.test(String(pin || ''));
}

/** Message d'attente lisible après trop d'essais ratés */
function pinRetryMessage(retryInSecs) {
    if (!retryInSecs) return 'Code incorrect';
    if (retryInSecs >= 60) {
        const m = Math.ceil(retryInSecs / 60);
        return `Trop d'essais. Réessayez dans ${m} min.`;
    }
    return `Trop d'essais. Réessayez dans ${retryInSecs} s.`;
}
