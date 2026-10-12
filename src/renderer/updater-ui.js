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

    const ALLOWED_TAGS = new Set([
        'H1', 'H2', 'H3', 'H4', 'P', 'UL', 'OL', 'LI',
        'STRONG', 'B', 'EM', 'I', 'CODE', 'PRE', 'BR', 'HR', 'BLOCKQUOTE', 'SPAN', 'A'
    ]);
    const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH']);

    /** Nettoie un arbre HTML pour ne conserver que les balises de formatage sûres */
    function sanitizeHtml(dirtyHtml) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(dirtyHtml, 'text/html');

        function cleanNode(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                return document.createTextNode(node.textContent || '');
            }
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return null;
            }

            let tag = node.tagName.toUpperCase();
            if (DROP_TAGS.has(tag)) return null;
            if (tag === 'TT') tag = 'CODE';
            if (tag === 'DIV') tag = 'P';

            const frag = document.createDocumentFragment();
            for (const child of Array.from(node.childNodes)) {
                const cleanedChild = cleanNode(child);
                if (cleanedChild) frag.appendChild(cleanedChild);
            }

            if (!ALLOWED_TAGS.has(tag)) {
                return frag;
            }

            const el = document.createElement(tag.toLowerCase());
            if (tag === 'A') {
                const href = (node.getAttribute('href') || '').trim();
                if (/^https?:\/\//i.test(href)) {
                    el.setAttribute('href', href);
                    el.setAttribute('target', '_blank');
                    el.setAttribute('rel', 'noopener');
                }
            }
            el.appendChild(frag);
            return el;
        }

        const container = document.createElement('div');
        for (const child of Array.from(doc.body.childNodes)) {
            const cleaned = cleanNode(child);
            if (cleaned) container.appendChild(cleaned);
        }
        return container.innerHTML || '<p>Nouvelle mise à jour disponible.</p>';
    }

    /** Décode les entités HTML de base si le flux Atom a été doublement échappé */
    function decodeHtmlEntitiesIfEscaped(str) {
        if (!/&lt;\s*\/?\s*(h[1-6]|ul|ol|li|p|div|strong|em|code|tt|a|br)\b/i.test(str)) {
            return str;
        }
        const txt = document.createElement('textarea');
        txt.innerHTML = str;
        return txt.value;
    }

    /** Analyse et convertit les notes de version (HTML d'electron-updater ou Markdown GitHub) en HTML sécurisé */
    function renderMarkdown(raw) {
        if (!raw || !String(raw).trim()) return '<p>Nouvelle mise à jour disponible.</p>';
        const normalized = decodeHtmlEntitiesIfEscaped(String(raw).trim());

        // Si le contenu contient déjà des balises HTML (cas d'electron-updater via releases.atom)
        if (/<(h[1-6]|ul|ol|li|p|div|strong|em|b|i|code|tt|pre|a|br|hr|blockquote)\b/i.test(normalized)) {
            return sanitizeHtml(normalized);
        }

        // Sinon conversion Markdown -> HTML
        const lines = escapeHtml(normalized).split(/\r?\n/);
        let html = '';
        let listType = null;

        const closeList = () => {
            if (listType) {
                html += `</${listType}>`;
                listType = null;
            }
        };

        for (let line of lines) {
            line = line.trim();
            if (!line) {
                closeList();
                continue;
            }

            if (line.startsWith('#### ')) {
                closeList();
                html += `<h4>${formatInline(line.slice(5))}</h4>`;
            } else if (line.startsWith('### ')) {
                closeList();
                html += `<h3>${formatInline(line.slice(4))}</h3>`;
            } else if (line.startsWith('## ')) {
                closeList();
                html += `<h2>${formatInline(line.slice(3))}</h2>`;
            } else if (line.startsWith('# ')) {
                closeList();
                html += `<h1>${formatInline(line.slice(2))}</h1>`;
            } else if (line.startsWith('- ') || line.startsWith('* ')) {
                if (listType !== 'ul') {
                    closeList();
                    html += '<ul>';
                    listType = 'ul';
                }
                html += `<li>${formatInline(line.slice(2))}</li>`;
            } else if (/^\d+\.\s+/.test(line)) {
                if (listType !== 'ol') {
                    closeList();
                    html += '<ol>';
                    listType = 'ol';
                }
                html += `<li>${formatInline(line.replace(/^\d+\.\s+/, ''))}</li>`;
            } else {
                closeList();
                html += `<p>${formatInline(line)}</p>`;
            }
        }

        closeList();
        return sanitizeHtml(html);
    }

    /** Formate gras, italique, code et liens inline */
    function formatInline(text) {
        return text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
            .replace(/(^|[\s(])(https?:\/\/[^\s)<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
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
        const notesBody = dialog.querySelector('#updateNotesBody');

        if (notesBody) {
            notesBody.addEventListener('click', (e) => {
                const link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
                if (link && link.href) {
                    e.preventDefault();
                    window.psUpdater.openReleaseUrl(link.href);
                }
            });
        }

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
