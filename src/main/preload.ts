// Pont entre le processus principal et les fenêtres.
// Expose un objet `chrome` minimal (storage.local, runtime, tabs) de même forme que l'API
// de l'extension : les fichiers d'interface (popup.js, pause.js…) tournent sans modification.
// En plus, `psHistory`, `psSystem`, `psUpdater` et `psSync` donnent accès
// à l'historique SQLite, aux réglages système, à l'auto-updater et à la synchronisation.

import { ipcRenderer } from 'electron';
import { UpdaterStatus, SyncConfig, SyncResult, SyncStatus } from './types';

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

const psHistory = {
    listDays: (opts?: any) => ipcRenderer.invoke('history:listDays', opts),
    exportFile: () => ipcRenderer.invoke('history:exportFile'),
    exportXlsx: (opts?: any) => ipcRenderer.invoke('history:exportXlsx', opts),
    exportCsv: (opts?: any) => ipcRenderer.invoke('history:exportCsv', opts),
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

// Synchronisation (Historique & Configuration)
const psSync = {
    getConfig: (): Promise<SyncConfig> => ipcRenderer.invoke('sync:getConfig'),
    saveConfig: (config: Partial<SyncConfig>): Promise<SyncConfig> => ipcRenderer.invoke('sync:saveConfig', config),
    syncNow: (): Promise<SyncResult> => ipcRenderer.invoke('sync:syncNow'),
    chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('sync:chooseFolder'),
    openFolder: (folderPath?: string): Promise<string> => ipcRenderer.invoke('sync:openFolder', folderPath),
    exportPackage: (): Promise<string> => ipcRenderer.invoke('sync:exportPackage'),
    importPackage: (jsonStr: string): Promise<SyncResult> => ipcRenderer.invoke('sync:importPackage', jsonStr),
    getStatus: (): Promise<SyncStatus> => ipcRenderer.invoke('sync:getStatus'),
    onStatusChange: (cb: (status: SyncStatus) => void): (() => void) => {
        const handler = (_e: any, status: SyncStatus) => cb(status);
        ipcRenderer.on('sync:status', handler);
        return () => ipcRenderer.removeListener('sync:status', handler);
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
define('psHistory', psHistory);
define('psSystem', psSystem);
define('psUpdater', psUpdater);
define('psSync', psSync);

