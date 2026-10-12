// Générateur dynamique de notes de version en français à partir de l'historique Git.
// Écrit CHANGELOG_RELEASE.md et injecte releaseNotes (texte brut) dans release/latest.yml.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TYPE_LABELS = {
    feat: 'Nouveauté',
    fix: 'Correction',
    perf: 'Performance',
    refactor: 'Amélioration',
    style: 'Interface',
    docs: 'Documentation'
};

const SCOPE_LABELS = {
    ui: 'Interface',
    popup: 'Fenêtre principale',
    simulator: 'Simulateur',
    sim: 'Simulateur',
    rules: 'Règles de journée',
    core: 'Calculs',
    updater: 'Mise à jour',
    release: 'Mise à jour',
    settings: 'Réglages',
    history: 'Historique',
    sync: 'Synchronisation',
    salat: 'Horaires de prière',
    pause: 'Pauses',
    tray: 'Zone de notification',
    export: 'Export'
};

/** Traduit dynamiquement un sujet de commit anglais en français s'il n'est pas déjà en français */
function translateSubjectToFrench(text) {
    let s = String(text || '').trim();
    if (!s) return '';

    // Si le message contient déjà des accents ou mots français courants, on le garde tel quel
    if (/[éèêëàâùûîïôç]|(\b(ajout|correction|mise à jour|simulateur|pause\s+minimum|affichage|fenêtre|réglages|journée|horaires|prise\s+en\s+charge)\b)/i.test(s)) {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    const replacements = [
        [/\buse plain text release notes in latest\.yml and UI\b/gi, 'affichage des notes de mise à jour en texte brut'],
        [/\bensure clean window close on update install\b/gi, "fermeture propre des fenêtres lors de l'installation d'une mise à jour"],
        [/\bdecode multi-level HTML entities and include git commit changelog in releases\b/gi, 'décodage des notes de version et génération automatique du journal des modifications'],
        [/\brender HTML release notes as formatted preview instead of escaped code\b/gi, "aperçu formaté des notes de version dans la fenêtre de mise à jour"],
        [/\bmake simulator collapsible and display mandatory pause breakdown\b/gi, 'simulateur pliable et affichage détaillé de la pause minimum obligatoire'],
        [/\badd mandatory minimum pause parameter and integrate into calculations\b/gi, 'ajout du paramètre de pause minimum obligatoire dans les calculs et réglages'],
        [/\badd interactive pause and leaving time simulator panel\b/gi, "ajout du simulateur interactif de temps de pause et d'heure de sortie"],
        [/\badd pause duration and target departure simulation helpers\b/gi, "calculs de simulation pour la durée de pause et l'heure de sortie cible"],
        [/\bprevent duplicate draft releases by disabling electron-builder auto-publish\b/gi, 'correction de la publication des versions sur GitHub'],
        [/\badd quick pause presets, manual entry and fullscreen toggle\b/gi, 'ajout des pauses rapides (+5/+10/+15/+30m), saisie manuelle et option plein écran'],
        [/\badd\b/gi, 'ajout de'],
        [/\bfix\b/gi, 'correction de'],
        [/\bupdate\b/gi, 'mise à jour de'],
        [/\bremove\b/gi, 'suppression de'],
        [/\bimprove\b/gi, 'amélioration de'],
        [/\bprevent\b/gi, 'prévention de'],
        [/\bensure\b/gi, 'vérification de'],
        [/\bsimulator\b/gi, 'simulateur'],
        [/\brelease notes\b/gi, 'notes de version'],
        [/\bchangelog\b/gi, 'journal des modifications'],
        [/\bsettings\b/gi, 'réglages'],
        [/\bhistory\b/gi, 'historique'],
        [/\bwindow\b/gi, 'fenêtre']
    ];

    for (const [pattern, replacement] of replacements) {
        s = s.replace(pattern, replacement);
    }

    return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Transforme une ligne de commit brute en puce française lisible */
function formatCommitLine(rawLine) {
    const line = String(rawLine || '').trim();
    if (!line) return null;

    // Ignorer les commits de pur bump de version sans autre description
    if (/^chore(\([^)]+\))?:\s*bump version to\s+v?\d+\.\d+\.\d+\s*$/i.test(line)) {
        return null;
    }

    // Si un commit contient "bump version to X and <autre chose>", extraire <autre chose>
    const bumpAndMatch = line.match(/^chore(?:\(([^)]+)\))?:\s*bump version to\s+v?\d+\.\d+\.\d+\s+and\s+(.+)$/i);
    if (bumpAndMatch) {
        const extra = translateSubjectToFrench(bumpAndMatch[2]);
        return extra ? `- Mise à jour : ${extra}` : null;
    }

    const convMatch = line.match(/^([a-z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/i);
    if (convMatch) {
        const type = convMatch[1].toLowerCase();
        const scope = (convMatch[2] || '').toLowerCase();
        const subject = convMatch[3].trim();

        if (type === 'chore' && /^bump version/i.test(subject)) {
            return null;
        }

        const translated = translateSubjectToFrench(subject);
        const scopeLabel = SCOPE_LABELS[scope];
        const typeLabel = TYPE_LABELS[type];

        if (scopeLabel) {
            return `- ${scopeLabel} : ${translated}`;
        }
        if (typeLabel) {
            return `- ${typeLabel} : ${translated}`;
        }
        return `- ${translated}`;
    }

    return `- ${translateSubjectToFrench(line)}`;
}

function getTagsSorted() {
    try {
        const out = execSync('git tag --sort=-version:refname', { encoding: 'utf8' });
        return out
            .split(/\r?\n/)
            .map((t) => t.trim())
            .filter((t) => /^v?\d+\.\d+\.\d+/.test(t));
    } catch (_) {
        return [];
    }
}

function getCommitsBetween(range) {
    try {
        const cmd = range ? `git log "${range}" --pretty=format:"%s"` : 'git log -n 15 --pretty=format:"%s"';
        const out = execSync(cmd, { encoding: 'utf8' });
        return out
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
    } catch (_) {
        return [];
    }
}

function generateFrenchChangelog() {
    const tags = getTagsSorted();
    let headTag = '';
    try {
        headTag = execSync('git tag --points-at HEAD', { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
    } catch (_) {}

    const startIdx = headTag && tags[0] === headTag ? 1 : 0;
    const formatted = [];
    const seen = new Set();

    const addCommits = (rawCommits, maxCount = Infinity) => {
        for (const c of rawCommits) {
            const bullet = formatCommitLine(c);
            if (bullet && !seen.has(bullet.toLowerCase())) {
                seen.add(bullet.toLowerCase());
                formatted.push(bullet);
                if (formatted.length >= maxCount) break;
            }
        }
    };

    // 1. Commits depuis le tag précédent
    if (startIdx < tags.length) {
        const prevTag = tags[startIdx];
        addCommits(getCommitsBetween(`${prevTag}..HEAD`));
    }

    // 2. Si moins de 3 changements (ex: correctifs rapides le même jour), compléter avec les commits des dernières 24h
    if (formatted.length < 3) {
        try {
            const recent24h = execSync('git log --since="24 hours ago" --pretty=format:"%s"', { encoding: 'utf8' })
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean);
            addCommits(recent24h, 5);
        } catch (_) {}
    }

    // 3. Repli sur les derniers commits de l'historique si toujours vide
    if (formatted.length === 0) {
        addCommits(getCommitsBetween(''), 5);
    }

    if (formatted.length === 0) {
        formatted.push('- Améliorations générales de stabilité et de performance');
    }

    return formatted;
}

function main() {
    const bullets = generateFrenchChangelog();
    const content = bullets.join('\n');

    const changelogPath = path.join(process.cwd(), 'CHANGELOG_RELEASE.md');
    fs.writeFileSync(changelogPath, content + '\n', 'utf8');
    console.log('[Changelog] Généré dans CHANGELOG_RELEASE.md :\n' + content);

    const latestYmlPath = path.join(process.cwd(), 'release', 'latest.yml');
    if (fs.existsSync(latestYmlPath)) {
        let yml = fs.readFileSync(latestYmlPath, 'utf8');
        // Supprimer un éventuel bloc releaseNotes existant
        yml = yml.replace(/\r?\nreleaseNotes:\s*\|-[\s\S]*$/, '').trimEnd();
        const indented = bullets.map((b) => `  ${b}`).join('\n');
        yml += `\nreleaseNotes: |-\n${indented}\n`;
        fs.writeFileSync(latestYmlPath, yml, 'utf8');
        console.log('[Changelog] Injecté dans release/latest.yml');
    }
}

main();
