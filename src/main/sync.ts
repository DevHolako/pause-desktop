// Moteur de synchronisation (Historique & Configuration).
// Synchronisation basée sur dossier : fonctionne directement avec votre dossier
// Google Drive (ex: G:\Mon Drive, Google Drive pour ordinateur), OneDrive, Dropbox,
// clé USB ou tout dossier local / réseau de votre choix.
//
// Effectue une fusion bidirectionnelle intelligente : aucune journée d'historique
// n'est écrasée, les réglages les plus récents prévalent, et le dossier distant
// est mis à jour avec l'ensemble complet fusionné.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { dialog, BrowserWindow } from 'electron';
import { Store } from './store';
import { HistoryManager } from './history';
import {
    SyncConfig,
    SyncPayload,
    SyncResult,
    SyncStatus,
    DayData
} from './types';

const SYNC_FILE_NAME = 'pause_sync_data.json';
const BACKUP_FILE_NAME = 'pause_sync_data.backup.json';
const SYNC_PAYLOAD_VERSION = 1;

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
    enabled: false,
    folderPath: '',
    autoSync: false,
    syncIntervalMins: 30,
    lastSyncStatus: 'idle'
};

/** Recherche automatique d'un dossier Google Drive (ou OneDrive) sur la machine */
export function detectGoogleDrivePath(): string | null {
    const homedir = os.homedir();
    const candidates = [
        'G:\\Mon Drive',
        'G:\\My Drive',
        'G:\\',
        path.join(homedir, 'Google Drive', 'Mon Drive'),
        path.join(homedir, 'Google Drive', 'My Drive'),
        path.join(homedir, 'Google Drive'),
        path.join(homedir, 'OneDrive')
    ];
    for (const c of candidates) {
        try {
            if (fs.existsSync(c)) return c;
        } catch (_) {}
    }
    return null;
}

export class SyncManager {
    private store: Store;
    private history: HistoryManager;
    private timer: NodeJS.Timeout | null = null;
    private startupTimer: NodeJS.Timeout | null = null;
    private isSyncing = false;
    private deviceId: string;

    constructor(store: Store, history: HistoryManager) {
        this.store = store;
        this.history = history;
        this.deviceId = this.getOrCreateDeviceId();
    }

    private getOrCreateDeviceId(): string {
        let id = this.store.value('syncDeviceId');
        if (!id) {
            id = `pause_${crypto.randomBytes(6).toString('hex')}`;
            this.store.set({ syncDeviceId: id });
        }
        return id;
    }

    getConfig(): SyncConfig {
        const saved = this.store.value('syncConfig');
        return { ...DEFAULT_SYNC_CONFIG, ...(saved || {}) };
    }

    saveConfig(patch: Partial<SyncConfig>): SyncConfig {
        const current = this.getConfig();
        const updated: SyncConfig = { ...current, ...patch };
        this.store.set({ syncConfig: updated });
        this.restartSchedule();
        this.broadcastStatus();
        return updated;
    }

    getStatus(): SyncStatus {
        const config = this.getConfig();
        return {
            isSyncing: this.isSyncing,
            lastSyncTime: config.lastSyncTime,
            lastSyncStatus: config.lastSyncStatus,
            lastSyncError: config.lastSyncError,
            lastSyncMergedCount: config.lastSyncMergedCount,
            detectedDrivePath: detectGoogleDrivePath(),
            config
        };
    }

    startSchedule(): void {
        this.stopSchedule();
        const config = this.getConfig();
        if (!config.enabled || !config.autoSync || !config.folderPath) return;

        const intervalMs = Math.max(5, config.syncIntervalMins || 30) * 60 * 1000;
        this.timer = setInterval(() => {
            this.sync().catch((err) => console.error('[Sync] Erreur synchro périodique :', err));
        }, intervalMs);

        // Synchro initiale après 8 secondes au démarrage
        this.startupTimer = setTimeout(() => {
            this.startupTimer = null;
            if (this.getConfig().enabled && this.getConfig().autoSync) {
                this.sync().catch((err) => console.error('[Sync] Erreur synchro initiale :', err));
            }
        }, 8000);
    }

    stopSchedule(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.startupTimer) {
            clearTimeout(this.startupTimer);
            this.startupTimer = null;
        }
    }

    private restartSchedule(): void {
        this.startSchedule();
    }

    async chooseFolder(win?: BrowserWindow | null): Promise<string | null> {
        const defaultPath = this.getConfig().folderPath || detectGoogleDrivePath() || os.homedir();
        const options = {
            title: 'Sélectionner le dossier de synchronisation (Google Drive, local...)',
            defaultPath,
            properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[]
        };
        const result = win
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options);

        if (result.canceled || !result.filePaths.length) return null;
        const selected = result.filePaths[0];
        this.saveConfig({ folderPath: selected, enabled: true });
        return selected;
    }

    async sync(): Promise<SyncResult> {
        if (this.isSyncing) {
            return { ok: false, error: 'Une synchronisation est déjà en cours' };
        }

        const config = this.getConfig();
        if (!config.folderPath) {
            return { ok: false, error: 'Veuillez sélectionner un dossier de synchronisation (ex: votre dossier Google Drive)' };
        }

        this.isSyncing = true;
        this.saveConfig({ lastSyncStatus: 'syncing', lastSyncError: undefined });
        this.broadcastStatus();

        try {
            const localPayload = await this.buildLocalPayload();

            // 1. Lire la charge distante depuis le dossier de synchronisation
            const remotePayload = await this.readFromFolder(config.folderPath);

            // 2. Fusionner données locales et distantes
            const { mergedPayload, mergedDaysCount, configUpdated } = await this.mergePayloads(localPayload, remotePayload);

            // 3. Écrire la charge fusionnée vers le dossier
            await this.writeToFolder(config.folderPath, mergedPayload);

            const now = Date.now();
            this.saveConfig({
                lastSyncTime: now,
                lastSyncStatus: 'success',
                lastSyncError: undefined,
                lastSyncMergedCount: mergedDaysCount
            });

            const result: SyncResult = {
                ok: true,
                mergedDaysCount,
                configUpdated,
                syncedAt: now,
                folderPath: config.folderPath
            };
            this.broadcastStatus();
            return result;
        } catch (err: any) {
            const errorMsg = String(err?.message || err);
            console.error('[Sync] Échec de la synchronisation :', err);
            this.saveConfig({
                lastSyncStatus: 'error',
                lastSyncError: errorMsg
            });
            this.broadcastStatus();
            return { ok: false, error: errorMsg, folderPath: config.folderPath };
        } finally {
            this.isSyncing = false;
            this.broadcastStatus();
        }
    }

    // ------------------------------------------------------------- Construction & Fusion

    async buildLocalPayload(): Promise<SyncPayload> {
        const days = await this.history.listDays({ fromDate: null });
        const configTimestamp = this.store.value('syncConfigUpdatedAt') || Date.now();

        return {
            version: SYNC_PAYLOAD_VERSION,
            appName: 'Pause',
            exportDate: new Date().toISOString(),
            deviceId: this.deviceId,
            updatedAt: Date.now(),
            config: {
                dayRulesConfig: this.store.value('dayRulesConfig'),
                isRamadanMode: this.store.value('isRamadanMode'),
                salatAlertLead: this.store.value('salatAlertLead'),
                autoLaunch: this.store.value('autoLaunch'),
                updatedAt: configTimestamp
            },
            history: days
        };
    }

    async mergePayloads(
        local: SyncPayload,
        remote: SyncPayload | null
    ): Promise<{ mergedPayload: SyncPayload; mergedDaysCount: number; configUpdated: boolean }> {
        if (!remote) {
            return { mergedPayload: local, mergedDaysCount: local.history.length, configUpdated: false };
        }

        let mergedDaysCount = 0;
        let configUpdated = false;

        // --- Fusion de l'historique par date ---
        const localDaysMap = new Map<string, DayData>();
        for (const d of local.history) localDaysMap.set(d.date, d);

        const remoteDaysMap = new Map<string, DayData>();
        for (const d of remote.history || []) remoteDaysMap.set(d.date, d);

        const allDates = new Set<string>([...localDaysMap.keys(), ...remoteDaysMap.keys()]);
        const mergedDays: DayData[] = [];

        for (const date of allDates) {
            const localDay = localDaysMap.get(date);
            const remoteDay = remoteDaysMap.get(date);

            if (localDay && !remoteDay) {
                mergedDays.push(localDay);
            } else if (!localDay && remoteDay) {
                // Nouvelle journée reçue de la machine distante : on l'enregistre en local
                await this.history.saveDay(remoteDay);
                mergedDays.push(remoteDay);
                mergedDaysCount++;
            } else if (localDay && remoteDay) {
                // Journée présente des deux côtés : on choisit la version la plus complète
                const chosen = this.pickBestDay(localDay, remoteDay);
                if (chosen === remoteDay && JSON.stringify(chosen) !== JSON.stringify(localDay)) {
                    await this.history.saveDay(remoteDay);
                    mergedDaysCount++;
                }
                mergedDays.push(chosen);
            }
        }

        // Trier par date décroissante
        mergedDays.sort((a, b) => b.date.localeCompare(a.date));

        // --- Fusion de la configuration ---
        let mergedConfig = local.config;
        if (remote.config && typeof remote.config.updatedAt === 'number') {
            const localConfigTime = local.config.updatedAt || 0;
            if (remote.config.updatedAt > localConfigTime) {
                // La configuration distante est plus récente : l'appliquer en local
                const patch: Record<string, any> = {
                    syncConfigUpdatedAt: remote.config.updatedAt
                };
                if (remote.config.dayRulesConfig !== undefined) patch.dayRulesConfig = remote.config.dayRulesConfig;
                if (remote.config.isRamadanMode !== undefined) patch.isRamadanMode = remote.config.isRamadanMode;
                if (remote.config.salatAlertLead !== undefined) patch.salatAlertLead = remote.config.salatAlertLead;
                if (remote.config.autoLaunch !== undefined) patch.autoLaunch = remote.config.autoLaunch;

                this.store.set(patch);
                mergedConfig = { ...remote.config };
                configUpdated = true;
            }
        }

        const mergedPayload: SyncPayload = {
            version: SYNC_PAYLOAD_VERSION,
            appName: 'Pause',
            exportDate: new Date().toISOString(),
            deviceId: this.deviceId,
            updatedAt: Date.now(),
            config: mergedConfig,
            history: mergedDays
        };

        return { mergedPayload, mergedDaysCount, configUpdated };
    }

    private pickBestDay(a: DayData, b: DayData): DayData {
        const aHasDep = Boolean(a.departure);
        const bHasDep = Boolean(b.departure);
        if (aHasDep && !bHasDep) return a;
        if (bHasDep && !aHasDep) return b;

        const aPausesCount = (a.pauses || []).length;
        const bPausesCount = (b.pauses || []).length;
        if (bPausesCount > aPausesCount) return b;
        if (aPausesCount > bPausesCount) return a;

        const aTotal = a.totalPauseMins || 0;
        const bTotal = b.totalPauseMins || 0;
        return bTotal >= aTotal ? b : a;
    }

    // ------------------------------------------------------------- Export / Import Manuel

    async exportSyncPackage(): Promise<string> {
        const payload = await this.buildLocalPayload();
        return JSON.stringify(payload, null, 2);
    }

    async importSyncPackage(jsonStr: string): Promise<SyncResult> {
        let parsed: any;
        try {
            parsed = JSON.parse(jsonStr);
        } catch (_) {
            return { ok: false, error: 'Fichier JSON invalide' };
        }

        if (!parsed || !Array.isArray(parsed.history)) {
            return { ok: false, error: 'Le fichier ne contient pas d’historique valide' };
        }

        const localPayload = await this.buildLocalPayload();
        const { mergedDaysCount, configUpdated } = await this.mergePayloads(localPayload, parsed as SyncPayload);

        return {
            ok: true,
            mergedDaysCount,
            configUpdated,
            syncedAt: Date.now()
        };
    }

    // ------------------------------------------------------------- Fichiers du dossier

    private async readFromFolder(folderPath: string): Promise<SyncPayload | null> {
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
            return null;
        }

        const filePath = path.join(folderPath, SYNC_FILE_NAME);
        if (!fs.existsSync(filePath)) return null;

        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(raw);
        } catch (err: any) {
            console.warn('[Sync] Lecture du fichier local corrompue, tentative de restauration de la sauvegarde...', err);
            const backupPath = path.join(folderPath, BACKUP_FILE_NAME);
            if (fs.existsSync(backupPath)) {
                return JSON.parse(fs.readFileSync(backupPath, 'utf8'));
            }
            throw new Error(`Fichier de synchronisation corrompu : ${err.message}`);
        }
    }

    private async writeToFolder(folderPath: string, payload: SyncPayload): Promise<void> {
        if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

        const targetFile = path.join(folderPath, SYNC_FILE_NAME);
        const backupFile = path.join(folderPath, BACKUP_FILE_NAME);
        const tempFile = path.join(folderPath, `${SYNC_FILE_NAME}.tmp`);

        const content = JSON.stringify(payload, null, 2);

        // Sauvegarder la version précédente s'il y en a une
        if (fs.existsSync(targetFile)) {
            try {
                fs.copyFileSync(targetFile, backupFile);
            } catch (_) {}
        }

        // Écriture atomique
        fs.writeFileSync(tempFile, content, 'utf8');
        fs.renameSync(tempFile, targetFile);
    }

    // ------------------------------------------------------------- Diffusion de statut

    broadcastStatus(): void {
        const status = this.getStatus();
        if (BrowserWindow && typeof BrowserWindow.getAllWindows === 'function') {
            try {
                for (const w of BrowserWindow.getAllWindows()) {
                    if (!w.isDestroyed()) {
                        w.webContents.send('sync:status', status);
                    }
                }
            } catch (_) {}
        }
    }
}
