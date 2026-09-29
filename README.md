# Pause — application Windows

Version bureau (Electron + TypeScript 7) de « Pause ». Suivi de la journée de travail, capital pause, horaires de prière Aladhan, historique SQLite local et **mises à jour automatiques via GitHub Releases**.

## Pourquoi une application plutôt qu'une extension

Une extension de navigateur ne voit que les onglets et fenêtres Chrome. L'application, elle, agit au niveau du système :

- l'**écran de pause** s'affiche en plein écran sur **chaque moniteur**, par‑dessus toutes les applications ;
- **Auto-Updater intégré** : vérification périodique et au démarrage des nouvelles versions publiées sur GitHub Releases, avec dialogue de changelog en markdown, suivi de téléchargement en direct et redémarrage automatique.

---

## Commandes de développement

Le projet est entièrement typé sous **TypeScript 7** avec vérification stricte des types.

```bash
# Installer les dépendances
npm install

# Vérification stricte des types (TypeScript 7)
npm run typecheck

# Compilation TypeScript (vers dist/)
npm run build

# Lancer l'application en développement
npm start

# Construire l'installateur Windows NSIS (.exe)
npm run dist
```

Les installateurs et fichiers d'auto-mise à jour (`.exe`, `.blockmap`, `latest.yml`) sont générés dans le dossier `release/`.

---

## Système d'Auto-Update (GitHub Releases)

L'application intègre un module d'auto-mise à jour intelligent :
- **Au démarrage** : vérification silencieuse et non-bloquante différée de 6 secondes.
- **Périodique** : vérification en tâche de fond toutes les 45 minutes.
- **Manuelle** : déclenchement direct depuis la page Réglages ou le menu de la zone de notification (Systray).
- **Interface utilisateur** :
  - Modal avec numéro de version, date de publication et notes de version Markdown.
  - Boutons « Télécharger et mettre à jour » et « Plus tard ».
  - Barre de progression avec débit de téléchargement (Mo/s) et volume transféré.
  - Notification « Redémarrer et installer ».
  - Gestion des états hors-ligne, limitation de débit GitHub API et erreurs réseau.

---

## Liaison GitHub & Déploiement CI/CD

### 1. Lier le dépôt local à votre GitHub

Pour lier ce dépôt local au dépôt GitHub [DevHolako/pause-desktop](https://github.com/DevHolako/pause-desktop) :

```bash
# Ajouter le remote GitHub
git remote add origin https://github.com/DevHolako/pause-desktop.git

# Définir la branche principale
git branch -M main

# Pousser le code vers GitHub
git push -u origin main
```

### 2. Publier une nouvelle version automatiquement

Le workflow GitHub Actions [`.github/workflows/release.yml`](file:///d:/desktop/.github/workflows/release.yml) compile le projet sur Windows et publie la release automatiquement dès qu'un tag de version est poussé :

```bash
# 1. Incrémentez la version dans package.json (ex: 1.0.1)
npm version 1.0.1 --no-git-tag-version

# 2. Commitez le changement
git commit -am "chore(release): bump version to 1.0.1"

# 3. Créez le tag Git correspondant
git tag v1.0.1

# 4. Poussez la branche et le tag sur GitHub
git push origin main
git push origin v1.0.1
```

GitHub Actions prend ensuite le relais :
1. Vérification stricte des types TypeScript 7 (`npm run typecheck`).
2. Compilation de l'application (`npm run build`).
3. Génération de l'installateur Windows NSIS (`release/Pause & Salat Setup 1.0.1.exe`), du blockmap delta et du descripteur `latest.yml`.
4. Création de la **GitHub Release** avec changelog automatique et téléversement des binaires.
5. Vos utilisateurs déjà installés recevront automatiquement la notification de mise à jour !

---

## Où sont stockées les données

Dans `%APPDATA%\Pause\` :

| Fichier          | Contenu                                                        |
|------------------|----------------------------------------------------------------|
| `state.json`     | journée en cours, réglages, horaires du jour, date de vérif màj |
| `history.sqlite` | historique des journées (base SQLite sql.js)                   |

---

## Architecture du projet

```
.
├── .github/workflows/
│   └── release.yml        # CI/CD GitHub Actions de build et publication de releases
├── build/                 # Icônes de l'application (.ico, .png)
├── src/
│   ├── main/              # Processus principal (Node / Electron en TypeScript 7)
│   │   ├── main.ts        # Point d'entrée Electron, fenêtres, systray, IPC
│   │   ├── updater.ts     # Moteur Auto-Updater GitHub Releases (téléchargement, progression, semver)
│   │   ├── store.ts       # Stockage clé/valeur persistant atomique
│   │   ├── history.ts     # Base SQLite (sql.js) pour l'historique des journées
│   │   ├── exporter.ts    # Génération des exports Excel (.xlsx) et CSV (.csv)
│   │   ├── preload.ts     # Pont IPC exposant chrome, psHistory, psSystem, psUpdater
│   │   ├── shared.ts      # Injection des règles partagées dans l'environnement global
│   │   └── types.ts       # Définitions d'interfaces et types TypeScript
│   ├── shared/            # Règles de calcul partagées (salat-core, day-core, salat-card)
│   └── renderer/          # Interfaces web Chromium (popup, réglages, alerte, pause, historique)
│       ├── updater-ui.js  # Contrôleur UI de l'auto-updater (dialogue modal, bannière, markdown)
│       ├── updater.css    # Styles du modal de mise à jour et barre de progression
│       └── ...
├── dist/                  # Code JavaScript compilé par tsc (exclu de Git)
├── release/               # Installateurs .exe générés par electron-builder (exclu de Git)
├── package.json           # Scripts, configuration electron-builder et publication
├── tsconfig.json          # Configuration TypeScript 7 (strict, NodeNext, ES2022)
└── .gitignore             # Règles d'exclusion Git pour production
```
