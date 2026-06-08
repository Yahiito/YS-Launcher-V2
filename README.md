# Y&S Launcher V2

Launcher Minecraft Electron relie au site LaPepterie.

## Developpement

```bash
npm install
npm run dev
```

## Build local

```bash
npm run build
```

## Release GitHub

1. Creer un repo GitHub nomme `YS-Launcher-V2`.
2. Pousser le projet dessus.
3. Creer un tag de version :

```bash
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions construit automatiquement Windows, Linux et macOS, puis publie les fichiers dans la release.

## Mise a jour automatique

En production, le launcher verifie GitHub au demarrage via `electron-updater`.
Les updates utilisent la release GitHub correspondant au repo configure dans `package.json`.
