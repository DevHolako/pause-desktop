// Types partagés pour le processus principal et les modules TypeScript

export interface DayPause {
    start: string;
    end: string;
    durationMins?: number;
    position?: number;
}

export interface DayData {
    date: string;
    clockIn: string;
    ramadan: boolean;
    departure?: string | null;
    totalPauseMins?: number;
    pauses: DayPause[];
}

export interface SalatDayTimes {
    Fajr: number;
    Dhuhr: number;
    Asr: number;
    Maghrib: number;
    Isha: number;
    Sunrise?: number;
    [key: string]: number | undefined;
}

export interface SalatDay {
    date: string;
    times: SalatDayTimes;
}

export interface DayRuleModeConfig {
    workMins?: number;
    maxPauseMins?: number;
    minOut?: number;
    maxOut?: number;
}

export interface DayRulesConfig {
    normal?: DayRuleModeConfig;
    ramadan?: DayRuleModeConfig;
}

export interface StoreValues {
    salatAlertLead?: number;
    salatDay?: SalatDay | null;
    salatError?: string | null;
    salatDismissedKey?: string | null;
    dayRulesConfig?: DayRulesConfig;
    autoLaunch?: boolean;
    workDate?: string;
    clockIn?: string;
    pauses?: DayPause[];
    isPaused?: boolean;
    pauseStartTime?: number | null;
    isRamadanMode?: boolean;
    pausePinSet?: boolean;
    lastUpdateCheck?: number;
    [key: string]: any;
}

export interface StoreChange {
    oldValue?: any;
    newValue?: any;
}

export type StoreChanges = Record<string, StoreChange>;

export interface PinVerdict {
    ok: boolean;
    error?: 'pin' | 'wait' | 'format';
    retryInSecs?: number;
}

// ------------------------------------------------------------- Types Auto-Updater

export interface ReleaseAsset {
    name: string;
    browser_download_url: string;
    size: number;
    content_type: string;
}

export interface GitHubRelease {
    tag_name: string;
    name: string;
    body: string;
    published_at: string;
    html_url: string;
    draft: boolean;
    prerelease: boolean;
    assets: ReleaseAsset[];
}

export interface UpdateInfo {
    version: string;
    releaseName?: string;
    releaseDate?: string;
    releaseNotes?: string;
    htmlUrl?: string;
    downloadUrl?: string;
    fileName?: string;
    fileSize?: number;
}

export interface ProgressInfo {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
}

export type UpdaterState =
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'offline'
    | 'rate-limited';

export interface UpdaterStatus {
    state: UpdaterState;
    currentVersion: string;
    latestVersion?: string;
    updateInfo?: UpdateInfo;
    progress?: ProgressInfo;
    error?: string;
    lastCheck?: number;
    isManual?: boolean;
}
