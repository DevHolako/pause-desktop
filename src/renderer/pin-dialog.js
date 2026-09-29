// Boîte de dialogue du code PIN dans la fenêtre principale : définir / modifier / supprimer,
// ou le demander avant une action verrouillée. Version bureau : toute vérification passe par
// le processus principal (psPin) ; l'empreinte n'existe jamais côté fenêtre.
// Dépend de pin-core.js.

const PIN_FIELD_LABELS = { current: 'Code actuel', next: 'Nouveau code', confirm: 'Confirmer le code' };

/**
 * Ouvre la boîte avec les champs demandés (current / next / confirm).
 * onSubmit(values) et onRemove(values) renvoient un message d'erreur, ou null si c'est bon.
 * Résout true quand l'action a réussi, false si l'utilisateur annule.
 */
function openPinDialog({ title, hint = '', fields, submitLabel = 'Valider', onSubmit, onRemove = null }) {
    const dialog = document.createElement('dialog');
    dialog.className = 'pin-dialog';
    dialog.innerHTML = `
        <form class="pin-dialog-form">
            <h2 class="pin-dialog-title"></h2>
            <p class="pin-dialog-hint"></p>
            ${fields.map((f) => `
                <label class="pin-dialog-field">
                    <span class="field-label">${PIN_FIELD_LABELS[f]}</span>
                    <input class="time-input pin-dialog-input" name="${f}" type="password" inputmode="numeric"
                           autocomplete="off" maxlength="8" required>
                </label>`).join('')}
            <p class="pin-dialog-error" role="alert"></p>
            <div class="pin-dialog-actions">
                ${onRemove ? '<button type="button" class="pin-dialog-remove">Supprimer le code</button>' : ''}
                <button type="button" class="btn-action pin-dialog-cancel">Annuler</button>
                <button type="submit" class="btn-action btn-start pin-dialog-submit"></button>
            </div>
        </form>`;
    dialog.querySelector('.pin-dialog-title').textContent = title;
    dialog.querySelector('.pin-dialog-hint').textContent = hint;
    dialog.querySelector('.pin-dialog-submit').textContent = submitLabel;
    document.getElementById('appWrapper').appendChild(dialog);

    const form = dialog.querySelector('form');
    const error = dialog.querySelector('.pin-dialog-error');
    const buttons = dialog.querySelectorAll('button');
    const values = () => Object.fromEntries(fields.map((f) => [f, form.elements[f].value]));

    form.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '');
        error.textContent = '';
    });

    return new Promise((resolve) => {
        let done = false;
        const finish = (ok) => { done = ok; dialog.close(); };
        dialog.addEventListener('close', () => { dialog.remove(); resolve(done); });

        async function run(action) {
            buttons.forEach((b) => { b.disabled = true; });
            const message = await action(values());
            buttons.forEach((b) => { b.disabled = false; });
            if (!message) return finish(true);
            error.textContent = message;
            form.elements[fields[0]].select();
        }

        form.addEventListener('submit', (e) => { e.preventDefault(); run(onSubmit); });
        dialog.querySelector('.pin-dialog-cancel').addEventListener('click', () => finish(false));
        if (onRemove) dialog.querySelector('.pin-dialog-remove').addEventListener('click', () => {
            if (form.elements.current && !form.elements.current.value) {
                error.textContent = 'Tapez le code actuel pour le supprimer';
                form.elements.current.focus();
                return;
            }
            run(onRemove);
        });

        dialog.showModal();
    });
}

/** Traduit le verdict du processus principal en message (ou null si tout va bien) */
function pinVerdictMessage(verdict, fallback) {
    if (verdict && verdict.ok) return null;
    if (verdict && verdict.error === 'wait') return pinRetryMessage(verdict.retryInSecs);
    if (verdict && verdict.error === 'pin') return pinRetryMessage(verdict.retryInSecs);
    if (verdict && verdict.error === 'format') return 'Le code doit contenir 4 à 8 chiffres';
    return fallback;
}

/** Demande le code avant une action verrouillée ; vrai tout de suite si aucun code n'est défini */
async function confirmPin(title) {
    if (!(await window.psPin.isSet())) return true;
    return openPinDialog({
        title,
        hint: 'Tapez le code PIN pour continuer.',
        fields: ['current'],
        onSubmit: async ({ current }) => pinVerdictMessage(await window.psPin.check(current), 'Code incorrect')
    });
}

/** Définir un code, ou modifier / supprimer le code existant */
async function editPin() {
    const isSet = await window.psPin.isSet();

    return openPinDialog({
        title: isSet ? 'Modifier le code PIN' : 'Définir un code PIN',
        hint: "Il sera demandé pour terminer la pause sur l'écran de pause. 4 à 8 chiffres.",
        fields: isSet ? ['current', 'next', 'confirm'] : ['next', 'confirm'],
        submitLabel: 'Enregistrer',
        onSubmit: async (v) => {
            if (!isValidPin(v.next)) return 'Le code doit contenir 4 à 8 chiffres';
            if (v.next !== v.confirm) return 'Les deux codes ne correspondent pas';
            return pinVerdictMessage(await window.psPin.set(isSet ? v.current : null, v.next), 'Enregistrement impossible');
        },
        onRemove: isSet
            ? async (v) => pinVerdictMessage(await window.psPin.remove(v.current), 'Suppression impossible')
            : null
    });
}
