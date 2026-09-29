// Code PIN de l'écran de pause, vérifié uniquement dans le processus principal.
// Les fenêtres ne voient jamais l'empreinte : seulement « un code est défini » (clé pausePinSet).
// Empreinte PBKDF2 salée : un code à 4 chiffres ne se retrouve pas facilement à partir du fichier.
// Après FREE_ATTEMPTS erreurs, chaque nouvel essai impose une attente qui double.

import * as crypto from 'crypto';
import { Store } from './store';
import { PinVerdict } from './types';

export const PIN_SET_KEY = 'pausePinSet';
const PIN_PATTERN = /^\d{4,8}$/;
const ITERATIONS = 210000;
const FREE_ATTEMPTS = 5;
const BASE_WAIT_SECS = 30;
const MAX_WAIT_SECS = 15 * 60;

function derive(pin: string | number, salt: string): Buffer {
    return crypto.pbkdf2Sync(String(pin), Buffer.from(salt, 'hex'), ITERATIONS, 32, 'sha256');
}

export class PinLock {
    private secrets: Store;
    private publicStore: Store;

    /** secrets : Store privé (jamais envoyé aux fenêtres) ; publicStore reçoit pausePinSet */
    constructor(secrets: Store, publicStore: Store) {
        this.secrets = secrets;
        this.publicStore = publicStore;
        this.publicStore.set({ [PIN_SET_KEY]: this.isSet() });
    }

    isSet(): boolean {
        return Boolean(this.secrets.value('pinHash'));
    }

    /** Secondes à attendre avant le prochain essai (0 si libre) */
    waitSecs(): number {
        const until = Number(this.secrets.value('pinLockedUntil')) || 0;
        return Math.max(0, Math.ceil((until - Date.now()) / 1000));
    }

    recordFailure(): void {
        const failures = Number(this.secrets.value('pinFailures') || 0) + 1;
        const values: Record<string, any> = { pinFailures: failures };
        if (failures >= FREE_ATTEMPTS) {
            const wait = Math.min(MAX_WAIT_SECS, BASE_WAIT_SECS * 2 ** (failures - FREE_ATTEMPTS));
            values.pinLockedUntil = Date.now() + wait * 1000;
        }
        this.secrets.set(values);
    }

    resetFailures(): void {
        this.secrets.remove(['pinFailures', 'pinLockedUntil']);
    }

    /**
     * { ok: true } si aucun code n'est défini ou si `pin` est le bon code ;
     * sinon { ok: false, error: 'pin' | 'wait', retryInSecs }.
     */
    check(pin?: string | number | null): PinVerdict {
        if (!this.isSet()) return { ok: true };
        const wait = this.waitSecs();
        if (wait > 0) return { ok: false, error: 'wait', retryInSecs: wait };

        const expectedHash = String(this.secrets.value('pinHash') || '');
        const expected = Buffer.from(expectedHash, 'hex');
        const salt = String(this.secrets.value('pinSalt') || '');
        const pinStr = String(pin || '');

        const ok = PIN_PATTERN.test(pinStr)
            && expected.length > 0
            && crypto.timingSafeEqual(derive(pinStr, salt), expected);

        if (ok) {
            this.resetFailures();
            return { ok: true };
        }
        this.recordFailure();
        const retryInSecs = this.waitSecs();
        return { ok: false, error: 'pin', retryInSecs: retryInSecs || undefined };
    }

    /** Définit ou remplace le code (le code actuel est exigé s'il y en a un) */
    set(current?: string | number | null, next?: string | number | null): PinVerdict {
        const nextStr = String(next || '');
        if (!PIN_PATTERN.test(nextStr)) return { ok: false, error: 'format' };
        const verdict = this.check(current);
        if (!verdict.ok) return verdict;
        const salt = crypto.randomBytes(16).toString('hex');
        this.secrets.set({ pinSalt: salt, pinHash: derive(nextStr, salt).toString('hex') });
        this.publicStore.set({ [PIN_SET_KEY]: true });
        return { ok: true };
    }

    remove(current?: string | number | null): PinVerdict {
        const verdict = this.check(current);
        if (!verdict.ok) return verdict;
        this.forget();
        return { ok: true };
    }

    /** Supprime le code sans le vérifier (récupération par mot de passe Windows) */
    forget(): void {
        this.secrets.remove(['pinSalt', 'pinHash']);
        this.resetFailures();
        this.publicStore.set({ [PIN_SET_KEY]: false });
    }
}
