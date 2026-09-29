// Stockage clé/valeur persistant dans un fichier JSON : remplace chrome.storage.local.
// Émet 'changed' ({ clé: { oldValue, newValue } }) seulement pour les valeurs qui changent,
// comme chrome.storage.onChanged.

import * as fs from 'fs';
import { EventEmitter } from 'events';
import { StoreValues, StoreChanges } from './types';

export class Store extends EventEmitter {
    private file: string;
    private data: StoreValues;

    constructor(file: string) {
        super();
        this.file = file;
        this.data = {};
        try {
            if (fs.existsSync(file)) {
                this.data = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
            }
        } catch (err: any) {
            if (err?.code !== 'ENOENT') {
                console.error('[Pause & Salat] Stockage illisible, repart à vide :', err);
            }
        }
    }

    /** keys : null (tout), une clé ou une liste. Renvoie des copies, clés absentes omises */
    get(keys: string | string[] | null = null): Partial<StoreValues> {
        const list = keys === null ? Object.keys(this.data) : Array.isArray(keys) ? keys : [keys];
        const out: Record<string, any> = {};
        for (const k of list) {
            if (k in this.data) {
                out[k] = structuredClone(this.data[k]);
            }
        }
        return out;
    }

    value<K extends keyof StoreValues>(key: K): StoreValues[K] | undefined {
        return this.data[key];
    }

    set(values: Partial<StoreValues>): StoreChanges {
        const changes: StoreChanges = {};
        for (const [k, v] of Object.entries(values)) {
            if (v === undefined) continue;
            if (JSON.stringify(this.data[k]) === JSON.stringify(v)) continue;
            changes[k] = { oldValue: this.data[k], newValue: structuredClone(v) };
            this.data[k] = structuredClone(v);
        }
        this.commit(changes);
        return changes;
    }

    remove(keys: string | string[]): StoreChanges {
        const changes: StoreChanges = {};
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) {
            if (!(k in this.data)) continue;
            changes[k] = { oldValue: this.data[k] };
            delete this.data[k];
        }
        this.commit(changes);
        return changes;
    }

    private commit(changes: StoreChanges): void {
        if (!Object.keys(changes).length) return;
        // Écriture atomique : un arrêt brutal ne laisse jamais un fichier à moitié écrit
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1), 'utf8');
        fs.renameSync(tmp, this.file);
        this.emit('changed', changes);
    }
}
