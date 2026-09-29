// Gestionnaire d'interface utilisateur pour l'Auto-Updater GitHub Releases.
// Intégré dans la fenêtre principale (popup.html) et les réglages (settings.html).

(function () {
    if (!window.psUpdater) return;

    /** Échappe les caractères HTML spéciaux pour éviter les injections XSS */
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /** Formate une taille en octets en Mo ou Ko */
    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 Mo';
        const mb = bytes / (1024 * 1024);
        if (mb >= 1) return `${mb.toFixed(1)} Mo`;
        const kb = bytes / 1024;
        return `${kb.toFixed(0)} Ko`;
    }

    /** Formate une date ISO en français */
    function formatReleaseDate(iso) {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            return d.toLocaleDateString('fr-FR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
        } catch (_) {
            return iso;
        }
    }

    /** Analyse et convertit du Markdown basique en HTML sécurisé */
    function renderMarkdown(md) {
        if (!md) return '<p>Nouvelle mise à jour disponible.</p>';
        const lines = escapeHtml(md).split('\n');
        let html = '';
        let inList = false;

        for (let line of lines) {
            line = line.trim();
            if (!line) {
                if (inList) {
                    html += '</ul>';
                    inList = false;
                }
                continue;
            }

            // Titres
            if (line.startsWith('### ')) {
                if (inList) { html += '</ul>'; inList = false; }
                html += `<h3>${formatInline(line.slice(4))}</h3>`;
            } else if (line.startsWith('## ')) {
                if (inList) { html += '</ul>'; inList = false; }
                html += `<h2>${formatInline(line.slice(3))}</h2>`;
            } else if (line.startsWith('# ')) {
                if (inList) { html += '</ul>'; inList = false; }
                html += `<h1>${formatInline(line.slice(2))}</h1>`;
            } else if (line.startsWith('- ') || line.startsWith('* ')) {
                if (!inList) {
                    html += '<ul>';
                    inList = true;
                }
                html += `<li>${formatInline(line.slice(2))}</li>`;
            } else {
                if (inList) { html += '</ul>'; inList = false; }
                html += `<p>${formatInline(line)}</p>`;
            }
        }

        if (inList) html += '</ul>';
        return html;
    }

    /** Formate gras, italique, code et liens inline */
    function formatInline(text) {
        return text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    }

    /** Met à jour le texte et l'état désactivé du bouton principal en préservant son innerHTML */
    function setActionButtonState(btn, text, disabled) {
        if (!btn) return;
        btn.disabled = Boolean(disabled);
        const span = btn.querySelector('#updateActionBtnText');
        if (span) {
            span.textContent = text;
        } else {
            btn.innerHTML = `<span id="updateActionBtnText">${escapeHtml(text)}</span>`;
        }
    }

    // ------------------------------------------------------------- Dialogue Modal

    let activeDialog = null;
    let dismissedVersion = null;

    function createOrGetDialog() {
        if (activeDialog && document.body.contains(activeDialog)) return activeDialog;
        const dialog = document.createElement('dialog');
        dialog.className = 'update-dialog';
        dialog.id = 'updateModalDialog';
        dialog.innerHTML = `
            <div class="update-dialog-content">
                <div class="update-dialog-header">
                    <div class="update-icon-box" aria-hidden="true">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </div>
                    <div class="update-title-wrap">
                        <h2 class="update-dialog-title">Mise à jour disponible</h2>
                        <div class="update-version-row">
                            <span id="updateVersionBadge" class="update-version-badge">v1.1.0</span>
                            <span id="updateReleaseDate" class="update-release-date"></span>
                        </div>
                    </div>
                </div>

                <!-- Notes de version / Changelog -->
                <div id="updateNotesSection" class="update-notes-container">
                    <div class="update-notes-label">Nouveautés &amp; améliorations</div>
                    <div id="updateNotesBody" class="update-notes-body"></div>
                </div>

                <!-- Barre de progression (téléchargement) -->
                <div id="updateProgressSection" class="update-progress-wrap" style="display: none;">
                    <div class="update-progress-header">
                        <span>Téléchargement en cours...</span>
                        <span id="updateProgressPercent">0%</span>
                    </div>
                    <div class="update-progress-bar-track">
                        <div id="updateProgressBarFill" class="update-progress-bar-fill"></div>
                    </div>
                    <div class="update-progress-stats">
                        <span id="updateProgressTransferred">0 Mo / 0 Mo</span>
                        <span id="updateProgressSpeed">-- Mo/s</span>
                    </div>
                </div>

                <!-- Prêt à installer -->
                <div id="updateReadySection" class="update-ready-box" style="display: none;">
                    <svg class="update-ready-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                    <span>Mise à jour téléchargée ! Redémarrez pour l'appliquer.</span>
                </div>

                <!-- Message d'erreur -->
                <div id="updateErrorSection" class="update-error-box" style="display: none;">
                    <div style="display: flex; flex-direction: column; gap: 6px; width: 100%;">
                        <span id="updateErrorText"></span>
                        <a href="#" id="updateFallbackLink" style="color: inherit; text-decoration: underline; font-weight: 600; cursor: pointer; font-size: 11px; display: inline-block;">Télécharger manuellement depuis GitHub &rarr;</a>
                    </div>
                </div>

                <!-- Boutons d'action -->
                <div class="update-dialog-actions">
                    <button type="button" id="updateLaterBtn" class="btn-update-secondary">Plus tard</button>
                    <button type="button" id="updateActionBtn" class="btn-update-primary">
                        <span id="updateActionBtnText">Télécharger &amp; installer</span>
                    </button>
                </div>
            </div>
        `;

        const container = document.getElementById('appWrapper') || document.body;
        container.appendChild(dialog);
        activeDialog = dialog;

        const laterBtn = dialog.querySelector('#updateLaterBtn');
        const actionBtn = dialog.querySelector('#updateActionBtn');
        const fallbackLink = dialog.querySelector('#updateFallbackLink');

        if (fallbackLink) {
            fallbackLink.addEventListener('click', (e) => {
                e.preventDefault();
                const url = currentStatus?.updateInfo?.downloadUrl || currentStatus?.updateInfo?.htmlUrl;
                window.psUpdater.openReleaseUrl(url);
            });
        }

        laterBtn.addEventListener('click', () => {
            if (currentStatus?.latestVersion) {
                dismissedVersion = currentStatus.latestVersion;
            }
            dialog.close();
        });

        actionBtn.addEventListener('click', async () => {
            if (!currentStatus) return;

            if (currentStatus.state === 'downloaded') {
                setActionButtonState(actionBtn, 'Installation...', true);
                await window.psUpdater.install();
            } else if (currentStatus.state === 'available' || currentStatus.state === 'error') {
                setActionButtonState(actionBtn, 'Démarrage...', true);
                await window.psUpdater.download();
            }
        });

        return dialog;
    }

    // ------------------------------------------------------------- Bannière Popup

    let topBanner = null;

    function renderBanner(status) {
        const appWrapper = document.getElementById('appWrapper');
        if (!appWrapper) return; // pas sur popup.html

        if (status.state !== 'available' && status.state !== 'downloaded') {
            if (topBanner) {
                topBanner.remove();
                topBanner = null;
            }
            return;
        }

        if (!topBanner) {
            topBanner = document.createElement('div');
            topBanner.className = 'update-banner-bar';
            const topbar = appWrapper.querySelector('.topbar');
            if (topbar && topbar.nextSibling) {
                appWrapper.insertBefore(topBanner, topbar.nextSibling);
            } else {
                appWrapper.prepend(topBanner);
            }
        }

        const isReady = status.state === 'downloaded';
        topBanner.innerHTML = `
            <div class="update-banner-text">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span>${isReady ? 'Mise à jour prête !' : `Version ${status.latestVersion} disponible`}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <button type="button" id="openUpdateModalBtn" class="update-banner-btn">
                    ${isReady ? 'Installer' : 'Voir les détails'}
                </button>
                <button type="button" id="closeBannerBtn" class="update-banner-close" aria-label="Fermer la bannière">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        `;

        topBanner.querySelector('#openUpdateModalBtn').addEventListener('click', () => {
            showUpdateModal(status);
        });

        topBanner.querySelector('#closeBannerBtn').addEventListener('click', () => {
            if (status.latestVersion) dismissedVersion = status.latestVersion;
            topBanner.remove();
            topBanner = null;
        });
    }

    // ------------------------------------------------------------- Mise à jour de l'UI

    let currentStatus = null;

    function showUpdateModal(status) {
        const dialog = createOrGetDialog();
        const info = status.updateInfo || {};

        dialog.querySelector('#updateVersionBadge').textContent = `v${status.latestVersion || info.version || '?'}`;
        dialog.querySelector('#updateReleaseDate').textContent = info.releaseDate ? `Publiée le ${formatReleaseDate(info.releaseDate)}` : '';
        dialog.querySelector('#updateNotesBody').innerHTML = renderMarkdown(info.releaseNotes);

        const notesSection = dialog.querySelector('#updateNotesSection');
        const progressSection = dialog.querySelector('#updateProgressSection');
        const readySection = dialog.querySelector('#updateReadySection');
        const errorSection = dialog.querySelector('#updateErrorSection');
        const actionBtn = dialog.querySelector('#updateActionBtn');

        if (status.state === 'downloading') {
            notesSection.style.display = 'none';
            readySection.style.display = 'none';
            errorSection.style.display = 'none';
            progressSection.style.display = 'flex';
            setActionButtonState(actionBtn, 'Téléchargement...', true);

            if (status.progress) {
                const percent = Math.min(100, Math.max(0, status.progress.percent || 0));
                dialog.querySelector('#updateProgressBarFill').style.width = `${percent}%`;
                dialog.querySelector('#updateProgressPercent').textContent = `${percent}%`;
                dialog.querySelector('#updateProgressTransferred').textContent = `${formatBytes(status.progress.transferred)} / ${formatBytes(status.progress.total)}`;
                dialog.querySelector('#updateProgressSpeed').textContent = `${formatBytes(status.progress.bytesPerSecond)}/s`;
            }
        } else if (status.state === 'downloaded') {
            notesSection.style.display = 'none';
            progressSection.style.display = 'none';
            errorSection.style.display = 'none';
            readySection.style.display = 'flex';
            setActionButtonState(actionBtn, 'Redémarrer & installer', false);
        } else if (status.state === 'error') {
            notesSection.style.display = 'block';
            progressSection.style.display = 'none';
            readySection.style.display = 'none';
            errorSection.style.display = 'flex';
            dialog.querySelector('#updateErrorText').textContent = status.error || 'Erreur lors du téléchargement.';
            setActionButtonState(actionBtn, 'Réessayer', false);
        } else {
            notesSection.style.display = 'block';
            progressSection.style.display = 'none';
            readySection.style.display = 'none';
            errorSection.style.display = 'none';
            setActionButtonState(actionBtn, 'Télécharger & installer', false);
        }

        if (!dialog.open) {
            dialog.showModal();
        }
    }

    function handleStatusUpdate(status) {
        currentStatus = status;

        // Mise à jour de la bannière sur popup.html
        renderBanner(status);

        // Si la mise à jour est disponible et non ignorée, ou si on télécharge/prêt, ouvrir la modal
        if (status.state === 'available') {
            if (dismissedVersion !== status.latestVersion) {
                showUpdateModal(status);
            }
        } else if (status.state === 'downloading' || status.state === 'downloaded') {
            showUpdateModal(status);
        } else if (status.state === 'error' && activeDialog && activeDialog.open) {
            showUpdateModal(status);
        }
    }

    // ------------------------------------------------------------- Initialisation

    window.addEventListener('DOMContentLoaded', () => {
        window.psUpdater.onStatusChange(handleStatusUpdate);
        window.psUpdater.getStatus().then((status) => {
            if (status) handleStatusUpdate(status);
        });
    });

    // Expose pour usage manuel (ex. bouton "Vérifier" dans les réglages)
    window.psUpdaterUi = {
        showUpdateModal,
        formatBytes,
        formatReleaseDate
    };
})();
