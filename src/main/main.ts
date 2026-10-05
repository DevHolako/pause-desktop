// Processus principal Pause (Windows).
// Rôles : fenêtre principale + icône de la zone de notification, fenêtres de pause
// plein écran sur chaque écran, fenêtre de rappel de prière, récupération des horaires,
// base d'historique SQLite (fichier), et auto-updater GitHub Releases.

import { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, Display } from 'electron';
import * as path from 'path';
import './shared'; // charge salat-core, day-core, salat-card comme globales
import { Store } from './store';
import { createHistory, HistoryManager } from './history';
import { AppUpdater } from './updater';
import { SyncManager } from './sync';
import { generateXlsx, generateCsv } from './exporter';
import { StoreChanges } from './types';

const ROOT_DIR = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT_DIR, 'src', 'renderer');
const DAY_KEYS = ['clockIn', 'pauses', 'isPaused', 'pauseStartTime', 'workDate'];
const REFRESH_PERIOD_MS = 15 * 60 * 1000;
const AUTOSTART_OPTIONS = { path: process.execPath, args: ['--autostart'] };

// Une seule instance : relancer l'application ne fait que ramener la fenêtre au premier plan
if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
}

let store: Store;
let history: HistoryManager;
let updater: AppUpdater;
let syncManager: SyncManager;

let mainWindow: BrowserWindow | null = null;
let historyWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let alertWindow: BrowserWindow | null = null;
const pauseWindows = new Map<string, BrowserWindow>(); // idÉcran -> BrowserWindow
let salatInflight: Promise<any> | null = null;
let alertTimer: NodeJS.Timeout | null = null;
let quitting = false;
let tray: Tray | null = null;

// ---------------------------------------------------------------- Démarrage

app.whenReady().then(() => {
    const userData = app.getPath('userData');
    store = new Store(path.join(userData, 'state.json'));
    history = createHistory(path.join(userData, 'history.sqlite'), broadcastHistoryChanged);
    updater = new AppUpdater(store);
    syncManager = new SyncManager(store, history);

    if (store.value('salatAlertLead') === undefined) {
        store.set({ salatAlertLead: global.DEFAULT_ALERT_LEAD_MINS });
    }
    global.applyDayRulesConfig(store.value(global.DAY_RULES_KEY));

    stampArrivalOnBootLaunch();

    store.on('changed', onStoreChanged);
    registerIpc();
    createTray();
    createMainWindow();

    // Démarrage du planificateur de mise à jour automatique en arrière-plan
    updater.startBackgroundChecks();
    // Démarrage du planificateur de synchronisation automatique
    syncManager.startSchedule();

    ensureSalatDay().then(scheduleAlert).then(dispatchAlert);
    setInterval(() => ensureSalatDay().then(scheduleAlert).then(dispatchAlert), REFRESH_PERIOD_MS);
    dispatchPauseScreens();
});

app.on('second-instance', () => showMainWindow());
app.on('window-all-closed', () => {
    // Vit dans la zone de notification : ne pas quitter l'application
});
app.on('before-quit', () => {
    quitting = true;
    if (updater) updater.stopBackgroundChecks();
    if (syncManager) syncManager.stopSchedule();
});
app.on('will-quit', () => {
    if (tray && !tray.isDestroyed()) tray.destroy();
});

// ---------------------------------------------------------------- Fenêtre principale

function createMainWindow(): void {
    mainWindow = new BrowserWindow({
        width: 480,
        height: 860,
        minWidth: 420,
        minHeight: 600,
        show: false,
        title: 'Pause',
        icon: path.join(ROOT_DIR, 'build', 'icon.png'),
        autoHideMenuBar: true,
        backgroundColor: '#f1f2f7',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: false,
            sandbox: false,
            nodeIntegration: false
        }
    });
    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadFile(path.join(RENDERER, 'popup.html'));
    mainWindow.once('ready-to-show', () => {
        if (mainWindow) mainWindow.show();
    });
    mainWindow.on('close', (e) => {
        if (quitting) return;
        e.preventDefault();
        if (mainWindow) mainWindow.hide();
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function showMainWindow(): void {
    if (!mainWindow) return createMainWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (updater) {
        updater.checkIfDue();
    }
}

// ---------------------------------------------------------------- Zone de notification

function createTray(): void {
    const iconPath = path.join(RENDERER, 'tray.png');
    const fallbackPath = path.join(RENDERER, 'icon.png');
    const img = nativeImage.createFromPath(iconPath);
    tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(fallbackPath) : img);
    tray.setToolTip('Pause');

    const menu = Menu.buildFromTemplate([
        { label: 'Ouvrir', click: showMainWindow },
        {
            label: 'Pause rapide (+)',
            submenu: [
                { label: '+5 min', click: () => { addQuickPause(5); } },
                { label: '+10 min', click: () => { addQuickPause(10); } },
                { label: '+15 min', click: () => { addQuickPause(15); } },
                { label: '+30 min', click: () => { addQuickPause(30); } }
            ]
        },
        { type: 'separator' },
        { label: 'Historique', click: openHistoryWindow },
        { label: 'Réglages', click: openSettingsWindow },
        { type: 'separator' },
        {
            label: 'Synchroniser maintenant',
            click: () => {
                syncManager.sync().catch((err) => console.error('[Tray] Erreur synchro :', err));
            }
        },
        {
            label: 'Vérifier les mises à jour...',
            click: () => {
                showMainWindow();
                updater.checkForUpdates(false);
            }
        },
        { type: 'separator' },
        {
            label: 'Quitter',
            click: () => {
                quitting = true;
                app.quit();
            }
        }
    ]);
    tray.setContextMenu(menu);
    tray.on('click', showMainWindow);
    tray.on('double-click', showMainWindow);
}

// ---------------------------------------------------------------- Historique (fenêtre)

function openHistoryWindow(): void {
    if (historyWindow) {
        historyWindow.show();
        historyWindow.focus();
        return;
    }
    historyWindow = new BrowserWindow({
        width: 1000,
        height: 760,
        title: 'Historique des journées',
        icon: path.join(ROOT_DIR, 'build', 'icon.png'),
        autoHideMenuBar: true,
        backgroundColor: '#f1f2f7',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: false,
            sandbox: false,
            nodeIntegration: false
        }
    });
    historyWindow.setMenuBarVisibility(false);
    historyWindow.loadFile(path.join(RENDERER, 'history.html'));
    historyWindow.on('closed', () => {
        historyWindow = null;
    });
}

// ---------------------------------------------------------------- Réglages (fenêtre)

function openSettingsWindow(): void {
    if (settingsWindow) {
        settingsWindow.show();
        settingsWindow.focus();
        return;
    }
    settingsWindow = new BrowserWindow({
        width: 840,
        height: 780,
        title: 'Réglages — Pause',
        icon: path.join(ROOT_DIR, 'build', 'icon.png'),
        autoHideMenuBar: true,
        backgroundColor: '#f1f2f7',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: false,
            sandbox: false,
            nodeIntegration: false
        }
    });
    settingsWindow.setMenuBarVisibility(false);
    settingsWindow.loadFile(path.join(RENDERER, 'settings.html'));
    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });
}

function broadcastHistoryChanged(): void {
    for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('history-changed');
    }
}

// ---------------------------------------------------------------- Horaires salat

function ensureSalatDay(force = false): Promise<any> {
    if (!salatInflight) salatInflight = loadSalatDay(force).finally(() => { salatInflight = null; });
    return salatInflight;
}

async function loadSalatDay(force: boolean): Promise<any> {
    const today = global.moroccoDateKey();
    const salatDay = store.value('salatDay');
    if (!force && salatDay && salatDay.date === today) return salatDay;
    try {
        const fresh = await global.fetchSalatDay(today);
        store.set({ salatDay: fresh, salatError: null });
        return fresh;
    } catch (err: any) {
        console.error('[Pause & Salat] Échec de récupération des horaires :', err);
        store.set({ salatError: String(err?.message || err) });
        return salatDay || null;
    }
}

// ---------------------------------------------------------------- Rappel de prière (fenêtre)

function currentAlert(): any {
    return global.pendingSalatAlert(store.get(['salatDay', 'salatAlertLead', 'salatDismissedKey']));
}

function scheduleAlert(): void {
    if (alertTimer) {
        clearTimeout(alertTimer);
        alertTimer = null;
    }
    const day = store.value('salatDay');
    const leadRaw = store.value('salatAlertLead');
    const lead = leadRaw === undefined ? global.DEFAULT_ALERT_LEAD_MINS : leadRaw;
    if (lead == null || !day || day.date !== global.moroccoDateKey()) return;

    const nowSecs = global.moroccoNowSecs();
    const nextStart = global.PRAYER_ORDER
        .map((k) => ((day.times[k] ?? 0) - lead) * 60)
        .find((startSecs) => startSecs > nowSecs);
    if (nextStart === undefined) return;
    const delayMs = (nextStart - nowSecs) * 1000;
    alertTimer = setTimeout(() => {
        dispatchAlert();
        scheduleAlert();
    }, Math.min(delayMs, 2 ** 31 - 1));
}

function dispatchAlert(): void {
    const alert = currentAlert();
    if (!alert) {
        if (alertWindow) {
            alertWindow.destroy();
            alertWindow = null;
        }
        return;
    }
    if (alertWindow) {
        alertWindow.showInactive();
        return;
    }
    const { workArea } = screen.getPrimaryDisplay();
    const width = 560;
    const height = 500;
    alertWindow = new BrowserWindow({
        width,
        height,
        x: Math.round(workArea.x + (workArea.width - width) / 2),
        y: Math.round(workArea.y + (workArea.height - height) / 2),
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: false,
        title: 'Rappel de prière',
        backgroundColor: '#171a3a',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: false,
            sandbox: false,
            nodeIntegration: false
        }
    });
    alertWindow.setAlwaysOnTop(true, 'screen-saver');
    alertWindow.loadFile(path.join(RENDERER, 'alert.html'));
    alertWindow.on('closed', () => {
        alertWindow = null;
    });
}

// ---------------------------------------------------------------- Écrans de pause plein écran

function openPauseWindowOn(display: Display): BrowserWindow {
    const b = display.bounds;
    const win = new BrowserWindow({
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        frame: false,
        fullscreen: true,
        kiosk: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        closable: true,
        title: 'Je suis en pause',
        backgroundColor: '#171a3a',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: false,
            sandbox: false,
            nodeIntegration: false
        }
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path.join(RENDERER, 'pause.html'));

    win.on('close', () => {
        if (!quitting && Boolean(store.value('isPaused'))) {
            endPauseNow();
        }
    });
    win.on('leave-full-screen', () => {
        if (Boolean(store.value('isPaused')) && !win.isDestroyed()) {
            win.setFullScreen(true);
        }
    });
    return win;
}

function dispatchPauseScreens(): void {
    const isPaused = Boolean(store.value('isPaused'));
    const isFullscreen = store.value('fullscreenPause') !== false;

    for (const [id, win] of [...pauseWindows]) {
        if (win.isDestroyed()) pauseWindows.delete(id);
    }

    if (!isPaused || !isFullscreen) {
        for (const [id, win] of [...pauseWindows]) {
            win.destroy();
            pauseWindows.delete(id);
        }
        return;
    }

    const displays = screen.getAllDisplays();
    const seen = new Set<string>();
    for (const d of displays) {
        seen.add(String(d.id));
        if (!pauseWindows.has(String(d.id))) {
            pauseWindows.set(String(d.id), openPauseWindowOn(d));
        }
    }
    for (const [id, win] of [...pauseWindows]) {
        if (!seen.has(id)) {
            win.destroy();
            pauseWindows.delete(id);
        }
    }
}

/** Termine la pause en cours, l'enregistre dans l'historique */
async function endPauseNow(): Promise<any> {
    if (!Boolean(store.value('isPaused'))) return { ok: true };

    global.applyDayRulesConfig(store.value(global.DAY_RULES_KEY));
    const s = store.get(['pauseStartTime', 'pauses', 'clockIn', 'workDate', 'isRamadanMode']);
    const pauses = global.recordPause(s.pauses, s.pauseStartTime, Date.now());
    store.set({ isPaused: false, pauseStartTime: null, pauses });

    if (s.workDate) {
        const clockIn = s.clockIn || global.DEFAULT_CLOCK_IN;
        const ramadan = Boolean(s.isRamadanMode);
        const { departureMins } = global.computeDay({ clockIn, dayPauses: pauses, activeSecs: 0, ramadan });
        await history.saveDay({ date: s.workDate, clockIn, ramadan, departure: global.minsToHM(departureMins), pauses });
        if (syncManager && syncManager.getConfig().enabled && syncManager.getConfig().autoSync) {
            syncManager.sync().catch(() => {});
        }
    }
    return { ok: true };
}

/** Ajoute directement une pause de N minutes sans activer le mode plein écran */
async function addQuickPause(mins: number): Promise<any> {
    if (!Number.isFinite(mins) || mins <= 0) return { ok: false, error: 'Durée invalide' };

    global.applyDayRulesConfig(store.value(global.DAY_RULES_KEY));
    const s = store.get(['pauses', 'clockIn', 'workDate', 'isRamadanMode']);
    const nowTs = Date.now();
    const startTs = nowTs - mins * 60 * 1000;
    const today = global.moroccoDateKey();
    const workDate = s.workDate || today;
    const clockIn = s.clockIn || global.DEFAULT_CLOCK_IN;
    const ramadan = Boolean(s.isRamadanMode);

    const pauses = global.recordPause(s.pauses, startTs, nowTs);
    store.set({ pauses, workDate, clockIn });

    const { departureMins } = global.computeDay({ clockIn, dayPauses: pauses, activeSecs: 0, ramadan });
    await history.saveDay({ date: workDate, clockIn, ramadan, departure: global.minsToHM(departureMins), pauses });
    if (syncManager && syncManager.getConfig().enabled && syncManager.getConfig().autoSync) {
        syncManager.sync().catch(() => {});
    }
    return { ok: true, pauses };
}

// ---------------------------------------------------------------- Démarrage automatique

function readRegistryAutoLaunch(): boolean | null {
    try {
        return (app as any).getLoginItemSettings(AUTOSTART_OPTIONS).openAtLogin;
    } catch (err) {
        console.error('[Pause & Salat] Lecture du démarrage automatique impossible :', err);
        return null;
    }
}

function readAutoLaunch(): boolean {
    const reg = readRegistryAutoLaunch();
    if (reg === null) return Boolean(store.value('autoLaunch'));
    if (reg !== Boolean(store.value('autoLaunch'))) store.set({ autoLaunch: reg });
    return reg;
}

// ---------------------------------------------------------------- Démarrage automatique (arrivée)

function archivePreviousDay(): void {
    const s = store.get(['workDate', 'clockIn', 'pauses', 'isRamadanMode']);
    if (!s.workDate) return;
    const clockIn = s.clockIn || global.DEFAULT_CLOCK_IN;
    const ramadan = Boolean(s.isRamadanMode);
    const pauses = s.pauses || [];
    const { departureMins } = global.computeDay({ clockIn, dayPauses: pauses, activeSecs: 0, ramadan });
    history.saveDay({ date: s.workDate, clockIn, ramadan, departure: global.minsToHM(departureMins), pauses });
    if (syncManager && syncManager.getConfig().enabled && syncManager.getConfig().autoSync) {
        syncManager.sync().catch(() => {});
    }
}

function stampArrivalOnBootLaunch(): void {
    if (!process.argv.includes('--autostart')) return;
    const today = global.moroccoDateKey();
    if (store.value('workDate') === today) return;

    archivePreviousDay();
    store.remove(DAY_KEYS);
    store.set({ clockIn: global.formatMoroccoHM(Date.now()), workDate: today });
}

// ---------------------------------------------------------------- Réactions aux changements d'état

function onStoreChanged(changes: StoreChanges): void {
    for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('store-changed', changes);
    }

    if (changes[global.DAY_RULES_KEY]) global.applyDayRulesConfig(store.value(global.DAY_RULES_KEY));
    if (changes.isPaused !== undefined || changes.fullscreenPause !== undefined) dispatchPauseScreens();
    if (changes.salatDay || changes.salatAlertLead) scheduleAlert();
    if (changes.salatDay || changes.salatAlertLead || changes.salatDismissedKey) dispatchAlert();

    // Enregistrement d'un timestamp de modification de config pour la synchronisation
    if (changes[global.DAY_RULES_KEY] || changes.isRamadanMode || changes.salatAlertLead || changes.autoLaunch || changes.fullscreenPause !== undefined) {
        store.set({ syncConfigUpdatedAt: Date.now() });
        if (syncManager && syncManager.getConfig().enabled && syncManager.getConfig().autoSync) {
            setTimeout(() => syncManager.sync().catch(() => {}), 3000);
        }
    }
}

// ---------------------------------------------------------------- IPC

function registerIpc(): void {
    ipcMain.on('store:get', (e, keys) => { e.returnValue = store.get(keys); });
    ipcMain.on('store:set', (e, values) => { store.set(values); e.returnValue = true; });
    ipcMain.on('store:remove', (e, keys) => { store.remove(keys); e.returnValue = true; });

    ipcMain.handle('runtime:message', (_e, msg) => handleMessage(msg));
    ipcMain.handle('tabs:create', (_e, url) => {
        if (/history\.html$/.test(String(url))) return openHistoryWindow();
        if (/settings\.html$/.test(String(url))) return openSettingsWindow();
        return shell.openExternal(String(url));
    });

    ipcMain.handle('system:getAutoLaunch', () => readAutoLaunch());
    ipcMain.handle('system:setAutoLaunch', (_e, on) => {
        const enabled = Boolean(on);
        try {
            app.setLoginItemSettings({ openAtLogin: enabled, ...AUTOSTART_OPTIONS });
        } catch (err) {
            console.error('[Pause & Salat] Démarrage automatique impossible :', err);
        }
        store.set({ autoLaunch: enabled });
        const reg = readRegistryAutoLaunch();
        return reg === null ? enabled : reg;
    });

    ipcMain.handle('history:listDays', (_e, opts) => history.listDays(opts || {}));
    ipcMain.handle('history:exportFile', () => history.exportFile());
    ipcMain.handle('history:exportXlsx', async (_e, opts) => {
        const days = await history.listDays(opts || {});
        return generateXlsx(days);
    });
    ipcMain.handle('history:exportCsv', async (_e, opts) => {
        const days = await history.listDays(opts || {});
        return generateCsv(days);
    });

    // Synchronisation (Historique & Configuration)
    ipcMain.handle('sync:getConfig', () => syncManager.getConfig());
    ipcMain.handle('sync:saveConfig', (_e, config) => syncManager.saveConfig(config));
    ipcMain.handle('sync:syncNow', () => syncManager.sync());
    ipcMain.handle('sync:chooseFolder', (e) => syncManager.chooseFolder(BrowserWindow.fromWebContents(e.sender)));
    ipcMain.handle('sync:openFolder', (_e, folderPath) => {
        const p = folderPath || syncManager.getConfig().folderPath;
        if (p && require('fs').existsSync(p)) return shell.openPath(p);
        return false;
    });
    ipcMain.handle('sync:exportPackage', () => syncManager.exportSyncPackage());
    ipcMain.handle('sync:importPackage', (_e, jsonStr) => syncManager.importSyncPackage(jsonStr));
    ipcMain.handle('sync:getStatus', () => syncManager.getStatus());
}

function handleMessage(msg: any): Promise<any> {
    switch (msg && msg.type) {
        case 'salat:ensure': return ensureSalatDay(Boolean(msg.force));
        case 'pause:stop': return endPauseNow();
        case 'pause:quickAdd': return addQuickPause(Number(msg.mins));
        case 'history:saveDay': return history.saveDay(msg.day);
        case 'history:deleteDay': return history.deleteDay(msg.date);
        default: return Promise.resolve(null);
    }
}
