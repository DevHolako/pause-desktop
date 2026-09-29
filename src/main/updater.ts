// Module d'auto-mise à jour automatique basé sur GitHub Releases.
// Gère la vérification en arrière-plan, périodique, manuelle, le téléchargement
// avec suivi de progression, et l'installation via electron-updater & GitHub API.

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as https from 'https';
import { Store } from './store';
import { GitHubRelease, ProgressInfo, UpdateInfo, UpdaterStatus, UpdaterState } from './types';

// Dépôt GitHub par défaut (configurable via package.json ou variables d'environnement)
const GITHUB_OWNER = process.env.GH_REPO_OWNER || 'weshore';
const GITHUB_REPO = process.env.GH_REPO_NAME || 'pause-salat-desktop';

// Période de vérification périodique en arrière-plan (45 minutes)
const BACKGROUND_CHECK_INTERVAL_MS = 45 * 60 * 1000;
// Délai avant la première vérification au démarrage (6 secondes, non-bloquant)
const STARTUP_CHECK_DELAY_MS = 6 * 1000;

/** Compare deux versions semver ('1.0.1' vs '1.0.0'). Renvoie 1 si v1 > v2, -1 si v1 < v2, 0 si égal */
export function semverCompare(v1: string, v2: string): number {
    const clean1 = (v1 || '').replace(/^v/i, '').trim();
    const clean2 = (v2 || '').replace(/^v/i, '').trim();
    const parts1 = clean1.split('.').map((p) => parseInt(p, 10) || 0);
    const parts2 = clean2.split('.').map((p) => parseInt(p, 10) || 0);
    const maxLen = Math.max(parts1.length, parts2.length, 3);
    for (let i = 0; i < maxLen; i++) {
        const num1 = parts1[i] ?? 0;
        const num2 = parts2[i] ?? 0;
        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }
    return 0;
}

export class AppUpdater {
    private store: Store;
    private status: UpdaterStatus;
    private periodicTimer: NodeJS.Timeout | null = null;
    private startupTimer: NodeJS.Timeout | null = null;
    private isDownloading: boolean = false;

    constructor(store: Store) {
        this.store = store;
        this.status = {
            state: 'idle',
            currentVersion: app.getVersion(),
            lastCheck: this.store.value('lastUpdateCheck') || undefined
        };

        this.configureAutoUpdater();
        this.registerIpcHandlers();
    }

    /** Configuration d'electron-updater */
    private configureAutoUpdater(): void {
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = true;

        autoUpdater.on('checking-for-update', () => {
            this.updateStatus({ state: 'checking' });
        });

        autoUpdater.on('update-available', (info) => {
            const releaseNotes = Array.isArray(info.releaseNotes)
                ? info.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note || '')).join('\n\n')
                : typeof info.releaseNotes === 'string'
                ? info.releaseNotes
                : '';

            const updateInfo: UpdateInfo = {
                version: info.version,
                releaseName: (info as any).releaseName || `Version ${info.version}`,
                releaseDate: info.releaseDate,
                releaseNotes,
                fileName: info.files?.[0]?.url
            };

            this.updateStatus({
                state: 'available',
                latestVersion: info.version,
                updateInfo
            });
        });

        autoUpdater.on('update-not-available', (info) => {
            this.updateStatus({
                state: 'not-available',
                latestVersion: info.version
            });
        });

        autoUpdater.on('download-progress', (progress) => {
            const progressInfo: ProgressInfo = {
                percent: Math.round(progress.percent * 10) / 10,
                bytesPerSecond: progress.bytesPerSecond,
                transferred: progress.transferred,
                total: progress.total
            };
            this.updateStatus({
                state: 'downloading',
                progress: progressInfo
            });
        });

        autoUpdater.on('update-downloaded', (info) => {
            this.isDownloading = false;
            this.updateStatus({
                state: 'downloaded',
                latestVersion: info.version
            });
        });

        autoUpdater.on('error', (err) => {
            this.isDownloading = false;
            console.error('[Pause & Salat Updater] Erreur electron-updater :', err);
            const message = this.humanizeError(err);
            this.updateStatus({
                state: message.state,
                error: message.text
            });
        });
    }

    /** Démarre les vérifications automatiques (au boot + périodique) */
    public startBackgroundChecks(): void {
        // Vérification non-bloquante au démarrage après quelques secondes
        this.startupTimer = setTimeout(() => {
            this.checkForUpdates(true).catch((err) => {
                console.warn('[Pause & Salat Updater] Vérification au démarrage silencieuse échouée :', err?.message || err);
            });
        }, STARTUP_CHECK_DELAY_MS);

        // Vérification périodique toutes les 45 minutes
        this.periodicTimer = setInterval(() => {
            this.checkForUpdates(true).catch((err) => {
                console.warn('[Pause & Salat Updater] Vérification périodique silencieuse échouée :', err?.message || err);
            });
        }, BACKGROUND_CHECK_INTERVAL_MS);
    }

    /** Arrête les timers d'arrière-plan (lors de la fermeture) */
    public stopBackgroundChecks(): void {
        if (this.startupTimer) {
            clearTimeout(this.startupTimer);
            this.startupTimer = null;
        }
        if (this.periodicTimer) {
            clearInterval(this.periodicTimer);
            this.periodicTimer = null;
        }
    }

    /** Enregistrement des écouteurs IPC pour le renderer */
    private registerIpcHandlers(): void {
        ipcMain.handle('updater:check', async (_e, isManual = true) => {
            return this.checkForUpdates(!isManual);
        });

        ipcMain.handle('updater:download', async () => {
            return this.downloadUpdate();
        });

        ipcMain.handle('updater:install', async () => {
            return this.installUpdate();
        });

        ipcMain.handle('updater:getStatus', () => {
            return this.status;
        });

        ipcMain.handle('updater:openReleaseUrl', (_e, url?: string) => {
            const target = url || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
            shell.openExternal(target);
            return true;
        });
    }

    /** Vérifie si une mise à jour est disponible */
    public async checkForUpdates(isSilent = false): Promise<UpdaterStatus> {
        this.updateStatus({
            state: 'checking',
            isManual: !isSilent,
            error: undefined
        });

        const now = Date.now();
        this.store.set({ lastUpdateCheck: now });

        // Si l'application est packagée, on utilise electron-updater en priorité
        if (app.isPackaged) {
            try {
                await autoUpdater.checkForUpdates();
                return this.status;
            } catch (err: any) {
                console.warn('[Pause & Salat Updater] electron-updater a échoué, repli sur GitHub API :', err?.message);
            }
        }

        // Mode développement ou fallback GitHub Releases API
        try {
            const release = await this.fetchLatestGitHubRelease(GITHUB_OWNER, GITHUB_REPO);
            if (!release) {
                this.updateStatus({
                    state: 'not-available',
                    latestVersion: app.getVersion(),
                    lastCheck: now
                });
                return this.status;
            }

            const current = app.getVersion();
            const latest = release.tag_name.replace(/^v/i, '');
            const hasUpdate = semverCompare(latest, current) > 0;

            if (hasUpdate) {
                const exeAsset = release.assets?.find((a) => a.name.endsWith('.exe')) || release.assets?.[0];
                const updateInfo: UpdateInfo = {
                    version: latest,
                    releaseName: release.name || `Version ${latest}`,
                    releaseDate: release.published_at,
                    releaseNotes: release.body,
                    htmlUrl: release.html_url,
                    downloadUrl: exeAsset?.browser_download_url,
                    fileName: exeAsset?.name,
                    fileSize: exeAsset?.size
                };

                this.updateStatus({
                    state: 'available',
                    latestVersion: latest,
                    updateInfo,
                    lastCheck: now
                });
            } else {
                this.updateStatus({
                    state: 'not-available',
                    latestVersion: current,
                    lastCheck: now
                });
            }
        } catch (err: any) {
            console.error('[Pause & Salat Updater] Échec vérification GitHub Releases :', err);
            const parsed = this.humanizeError(err);
            this.updateStatus({
                state: parsed.state,
                error: parsed.text,
                lastCheck: now
            });
        }

        return this.status;
    }

    /** Déclenche le téléchargement */
    public async downloadUpdate(): Promise<{ ok: boolean; error?: string }> {
        if (this.isDownloading) return { ok: true };
        this.isDownloading = true;

        if (app.isPackaged) {
            try {
                this.updateStatus({ state: 'downloading' });
                await autoUpdater.downloadUpdate();
                return { ok: true };
            } catch (err: any) {
                this.isDownloading = false;
                const parsed = this.humanizeError(err);
                this.updateStatus({ state: 'error', error: parsed.text });
                return { ok: false, error: parsed.text };
            }
        }

        // En mode développement : simulation de téléchargement fluide pour tester l'UI
        this.simulateDownloadInDev();
        return { ok: true };
    }

    /** Simulation de téléchargement fluide en dev pour tester l'UI */
    private simulateDownloadInDev(): void {
        this.updateStatus({ state: 'downloading' });
        const totalSize = this.status.updateInfo?.fileSize || 120 * 1024 * 1024;
        let progress = 0;

        const interval = setInterval(() => {
            progress += 10;
            const transferred = Math.round((progress / 100) * totalSize);
            this.updateStatus({
                state: 'downloading',
                progress: {
                    percent: progress,
                    bytesPerSecond: 1024 * 1024 * 4.5,
                    transferred,
                    total: totalSize
                }
            });

            if (progress >= 100) {
                clearInterval(interval);
                this.isDownloading = false;
                this.updateStatus({
                    state: 'downloaded',
                    latestVersion: this.status.latestVersion
                });
            }
        }, 350);
    }

    /** Quitte et installe la mise à jour */
    public installUpdate(): void {
        if (app.isPackaged) {
            autoUpdater.quitAndInstall(false, true);
        } else {
            if (this.status.updateInfo?.htmlUrl) {
                shell.openExternal(this.status.updateInfo.htmlUrl);
            }
            app.relaunch();
            app.quit();
        }
    }

    /** Requête directe à l'API publique GitHub Releases */
    private fetchLatestGitHubRelease(owner: string, repo: string): Promise<GitHubRelease | null> {
        return new Promise((resolve, reject) => {
            const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
            const options: https.RequestOptions = {
                headers: {
                    'User-Agent': 'Pause-Salat-Desktop-App',
                    Accept: 'application/vnd.github.v3+json'
                }
            };

            const req = https.get(url, options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 404) {
                        // Pas encore de release ou dépôt privé/inexistant
                        resolve(null);
                        return;
                    }
                    if (res.statusCode === 403) {
                        const remaining = res.headers['x-ratelimit-remaining'];
                        if (remaining === '0') {
                            const err = new Error('rate_limit');
                            (err as any).isRateLimit = true;
                            reject(err);
                            return;
                        }
                    }
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const json = JSON.parse(data) as GitHubRelease;
                            resolve(json);
                        } catch (err) {
                            reject(err);
                        }
                    } else {
                        reject(new Error(`GitHub HTTP ${res.statusCode}: ${data}`));
                    }
                });
            });

            req.on('error', (err) => {
                reject(err);
            });

            req.setTimeout(12000, () => {
                req.destroy(new Error('timeout'));
            });
        });
    }

    /** Convertit les erreurs techniques en messages clairs et compréhensibles */
    private humanizeError(err: any): { state: UpdaterState; text: string } {
        const msg = String(err?.message || err || '').toLowerCase();
        if (msg.includes('enotfound') || msg.includes('offline') || msg.includes('net::err_internet_disconnected') || msg.includes('timeout')) {
            return {
                state: 'offline',
                text: 'Aucune connexion internet détectée. Vérifiez votre réseau.'
            };
        }
        if (msg.includes('rate_limit') || msg.includes('rate limit') || (err && (err as any).isRateLimit)) {
            return {
                state: 'rate-limited',
                text: 'Limite de requêtes GitHub temporairement atteinte. Veuillez réessayer plus tard.'
            };
        }
        if (msg.includes('404')) {
            return {
                state: 'not-available',
                text: 'Aucune version publiée trouvée sur GitHub Releases pour le moment.'
            };
        }
        return {
            state: 'error',
            text: `Échec de la recherche de mise à jour (${err?.message || 'Erreur réseau'}).`
        };
    }

    /** Met à jour l'état local et diffuse l'événement à toutes les fenêtres BrowserWindow */
    private updateStatus(partial: Partial<UpdaterStatus>): void {
        this.status = {
            ...this.status,
            ...partial,
            currentVersion: app.getVersion(),
            lastCheck: this.store.value('lastUpdateCheck') || this.status.lastCheck
        };

        // Diffuse aux fenêtres actives
        for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) {
                w.webContents.send('updater:status', this.status);
            }
        }
    }

    public getStatus(): UpdaterStatus {
        return this.status;
    }
}
