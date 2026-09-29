// Pont entre le processus principal et les fenêtres.
// Expose un objet `chrome` minimal (storage.local, runtime, tabs) de même forme que l'API
// de l'extension : les fichiers d'interface (popup.js, pause.js…) tournent sans modification.
// En plus, `psPin`, `psHistory`, `psSystem` et `psUpdater` donnent accès au code PIN,
// à l'historique SQLite, aux réglages système et à l'auto-updater GitHub Releases.

import { ipcRenderer } from 'electron';
import { UpdaterStatus } from './types';

const changeListeners = new Set<(changes: any, area: string) => void>();
ipcRenderer.on('store-changed', (_e, changes) => {
    for (const fn of changeListeners) {
        try {
            fn(changes, 'local');
        } catch (err) {
            console.error(err);
        }
    }
});

const runtimeMessageListeners = new Set<(msg: any, sender: any, sendResponse: any) => void>();
ipcRenderer.on('runtime-message', (_e, msg) => {
    for (const fn of runtimeMessageListeners) {
        try {
            fn(msg, {}, () => {});
        } catch (err) {
            console.error(err);
        }
    }
});

const chromeShim = {
    storage: {
        local: {
            get(keys: any, cb?: (res: any) => void) {
                const res = ipcRenderer.sendSync('store:get', keys ?? null);
                if (typeof cb === 'function') {
                    queueMicrotask(() => cb(res));
                    return;
                }
                return Promise.resolve(res);
            },
            set(values: any, cb?: () => void) {
                ipcRenderer.sendSync('store:set', values);
                if (typeof cb === 'function') queueMicrotask(cb);
                return Promise.resolve();
            },
            remove(keys: any, cb?: () => void) {
                ipcRenderer.sendSync('store:remove', keys);
                if (typeof cb === 'function') queueMicrotask(cb);
                return Promise.resolve();
            }
        },
        onChanged: {
            addListener(fn: (changes: any, area: string) => void) {
                changeListeners.add(fn);
            },
            removeListener(fn: (changes: any, area: string) => void) {
                changeListeners.delete(fn);
            }
        }
    },
    runtime: {
        id: 'pause-salat-desktop',
        getURL(pathStr: string) {
            return String(pathStr || '').replace(/^\/+/, '');
        },
        sendMessage(msg: any) {
            return ipcRenderer.invoke('runtime:message', msg);
        },
        onMessage: {
            addListener(fn: (msg: any, sender: any, sendResponse: any) => void) {
                runtimeMessageListeners.add(fn);
            },
            removeListener(fn: (msg: any, sender: any, sendResponse: any) => void) {
                runtimeMessageListeners.delete(fn);
            }
        }
    },
    tabs: {
        create({ url }: { url: string }) {
            return ipcRenderer.invoke('tabs:create', url);
        }
    }
};

const psPin = {
    isSet: () => ipcRenderer.invoke('pin:isSet'),
    check: (pin: string | number) => ipcRenderer.invoke('pin:check', pin),
    set: (current: string | number, next: string | number) => ipcRenderer.invoke('pin:set', { current, next }),
    remove: (current: string | number) => ipcRenderer.invoke('pin:remove', current)
};

const psHistory = {
    listDays: (opts?: any) => ipcRenderer.invoke('history:listDays', opts),
    exportFile: () => ipcRenderer.invoke('history:exportFile'),
    deleteDay: (date: string) => ipcRenderer.invoke('runtime:message', { type: 'history:deleteDay', date }),
    onChange: (cb: () => void) => {
        const handler = () => cb();
        ipcRenderer.on('history-changed', handler);
        return () => ipcRenderer.removeListener('history-changed', handler);
    }
};

// Réglages système propres à l'application Windows (démarrage automatique)
const psSystem = {
    getAutoLaunch: () => ipcRenderer.invoke('system:getAutoLaunch'),
    setAutoLaunch: (on: boolean) => ipcRenderer.invoke('system:setAutoLaunch', Boolean(on))
};

// Auto-Updater GitHub Releases
const psUpdater = {
    check: (isManual: boolean = true): Promise<UpdaterStatus> => ipcRenderer.invoke('updater:check', isManual),
    download: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('updater:download'),
    install: (): Promise<void> => ipcRenderer.invoke('updater:install'),
    getStatus: (): Promise<UpdaterStatus> => ipcRenderer.invoke('updater:getStatus'),
    openReleaseUrl: (url?: string): Promise<boolean> => ipcRenderer.invoke('updater:openReleaseUrl', url),
    onStatusChange: (cb: (status: UpdaterStatus) => void): (() => void) => {
        const handler = (_e: any, status: UpdaterStatus) => cb(status);
        ipcRenderer.on('updater:status', handler);
        return () => ipcRenderer.removeListener('updater:status', handler);
    }
};

// Remplace le window.chrome de Chromium par notre passerelle
function define(name: string, value: any): void {
    try {
        Object.defineProperty(window, name, { value, writable: true, configurable: true });
    } catch (_) {
        try {
            (window as any)[name] = value;
        } catch (err) {
            console.error('[Pause & Salat] Exposition impossible :', name, err);
        }
    }
}

define('chrome', chromeShim);
define('psPin', psPin);
define('psHistory', psHistory);
define('psSystem', psSystem);
define('psUpdater', psUpdater);
