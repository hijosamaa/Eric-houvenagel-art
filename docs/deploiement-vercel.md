# Déploiement Vercel — diagnostic & procédure de déblocage (2026-11-27)

## Situation constatée

- Les textures IA et tout le code sont bien sur `main` (dernier commit : `7c99663`, textures dans `ac7d19a`).
- L'URL publique `https://eric-houvenagel.vercel.app` sert un **vieux déploiement** (bundle JS sans la chaîne
  `assets/textures` — build d'avant le 2026-11-26 13:00). Conséquence : `assets/textures/*` et
  `assets/textures/ai/*` y répondent `200 text/html` (rewrite SPA `/(.*) → /index.html`) au lieu de
  fichiers statiques → le site retombe sur les textures procédurales canvas 2D ("anciennes textures").
- Chaque push sur `main` crée bien un déploiement Vercel (status GitHub « Vercel: Deployment has
  completed »), ex. `FwXENTTG82nGMUyCh8rtX1wVT8S6` pour `7c99663`, mais ces déploiements redirigent vers
  `vercel.com/login` : la **protection de déploiement (Vercel Authentication / SSO) est activée** sur la
  team `arthurforgerit-1751s-projects`, projet `eric-houvenagel`. Ils ne sont donc jamais servis sur l'alias
  public, qui garde l'ancien déploiement.
- Le token Vercel de la CLI locale (`AppData/Roaming/com.vercel.cli/Data/auth.json`) est **révoqué**
  (API → `403 invalidToken`). Le secret GitHub Actions `VERCEL_TOKEN` **n'existe pas** (ni repo ni compte),
  donc le workflow `.github/workflows/deploy-vercel.yml` échoue à chaque exécution.

## Pour débloquer (une seule de ces 3 manips, par un membre de la team Vercel)

### A. Désactiver la protection puis redéployer (recommandé, 2 min)
1. https://vercel.com/arthurforgerit-1751s-projects/eric-houvenagel → **Settings → Deployment Protection** →
   mettre sur **Disabled** (ou « Standard » sans SSO team).
2. Onglet **Deployments** → ligne du dernier commit de `main` (`7c99663`) → **⋯ → Promote to Production**
   (ou **Redeploy**).
3. Vérifier que **Settings → Git → Production Branch = `main`**.

### B. Promouvoir directement le déploiement existant
Deployments → ouvrir `FwXENTTG82nGMUyCh8rtX1wVT8S6` (commit `7c99663`) → **Promote to Production**.
(Ne marche que si la protection ne bloque pas la promotion.)

### C. Recréer un token et réparable le workflow manuel GitHub Actions
1. vercel.com → **Account Settings → Tokens → Create** (scope team `arthurforgerit-1751s-projects`).
2. GitHub → repo `hijosamaa/Eric-houvenagel-art` → **Settings → Secrets and variables → Actions →
   New repository secret** : nom `VERCEL_TOKEN`, valeur = le token.
3. Onglet **Actions → « Déployer sur Vercel (manuel) » → Run workflow** sur `main`
   (`npm ci && npm run build && vercel deploy --prebuilt --prod`).

## Vérification post-déploiement

```bash
curl -sI https://eric-houvenagel.vercel.app/assets/textures/ai/plaster.webp
# attendu : 200 + Content-Type: image/webp + ~4,3 Mo (pas 2772 o de text/html)
curl -s https://eric-houvenagel.vercel.app/ | grep -o 'assets/index-[^"]*\.js'   # hash du NOUVEAU bundle
```

Puis hard-reload (Ctrl+F5) côté navigateur : le vieux bundle/les vieilles textures peuvent être en cache.

## Note

En attendant, le build local est sain : `npm run build` OK, `dist/assets/textures/ai/*.webp` présents,
`vite preview` sert les textures IA en `200 image/webp` et la scène les charge en priorité
(voir `src/gallery/textures.ts` → `precalcTexture`, ordre : `ai/<name>.webp` → `<name>.webp` → canvas 2D).
