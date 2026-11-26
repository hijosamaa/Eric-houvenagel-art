# Serveur MCP local — galerie virtuelle 3D

`scripts/mcp-server.mjs` expose le projet à un agent IA via le **Model Context Protocol** (stdio).
Il tourne en local uniquement, n'ajoute **rien au bundle client** (vérifié : build byte-identique
avec/sans, JS 611 862 B / 154 152 B gzip), et ne touche ni `src/`, ni `index.html`, ni la config Vite/TS.

- Lancer à la main : `npm run mcp` (équivalent à `node scripts/mcp-server.mjs`)
- Selftest complet (client MCP stdio du SDK) : `npm run mcp:selftest`
- SDK utilisé : `@modelcontextprotocol/server` + `@modelcontextprotocol/core` **v2.0.0** (déjà dans
  `node_modules`, épinglés en `devDependencies`) — API v2 : `new McpServer(...)` + `server.registerTool(...)`
  + `serveStdio(() => server)` depuis `@modelcontextprotocol/server/stdio`.
- Playwright n'est pas dans le root : il est résolu depuis `.vibe/shotkit/node_modules`, avec
  `PLAYWRIGHT_BROWSERS_PATH=C:\Users\Hijo\AppData\Local\ms-playwright` (forme native Windows —
  un chemin `/c/...` serait interprété comme UNC `\\c\...`).

## Tools exposés

| Tool | Args | Rôle |
|---|---|---|
| `build` | — | `npm run build` (tsc + vite) → `{ exitCode, tail }` |
| `dev_start` | `port=5199` | démarre `vite --port <port> --strictPort --bypass-lock` en arrière-plan (predev `build-data.mjs` d'abord), attend que le port réponde → `{ started, url, pid }` |
| `dev_stop` | — | tue le process vite et vérifie que le port est libéré |
| `shoot` | `specs=["desktop=0.45:1440x900:1"]`, `outDir=".vibe/shots-mcp"`, `port?` | lance `.vibe/shotkit/shoot.mjs` contre `http://localhost:<port>/` → liste des PNG + erreurs console (`errors.json`) |
| `perf` | `port?` | Playwright : `window.__gallery.perf()` (renderer.info) + fps mesuré sur 2 s en 1440x900 |
| `console_errors` | — | erreurs console du dernier run `shoot` / `verify_dup` |
| `works_list` | — | liste `data/works/*.json` (id + schéma complet) |
| `works_get` | `id` | lit `data/works/<id>.json` (id validé, pas de traversal) |
| `works_update` | `id`, `patch` | patch (clés whitelistées : `title, year, medium, dimensions, description, room, order, image`), relance `node scripts/build-data.mjs`, retourne le `public/data/works.json` régénéré |
| `verify_dup` | `n=3`, `outDir`, `port?` | `?dup=n` à 1440x900 et 390x844, scrolle t=0→1 en lisant `__gallery.controls.currentZ()` vs `__gallery.layout.zEnd` → verdict `{ ok, violationsTotal, consoleErrorCount }` |

Spécification d'un shot : `nom=t:WxH[:dup[:actions]]`, ex `"desktop=0.45:1440x900:1"` (voir l'en-tête de `.vibe/shotkit/shoot.mjs`).

État persistant (pid dev, port, dernières erreurs console) : `.vibe/mcp-state.json` — tout ce que le
serveur produit (shots, état) est sous `.vibe/`, donc gitignoré.

## Connecter un client MCP (stdio)

Bloc stdio générique (à adapter avec le chemin absolu du projet) :

```json
{
  "mcpServers": {
    "galerie-3d": {
      "command": "node",
      "args": ["C:\\Users\\Hijo\\Documents\\Antigravity\\Mistral\\Eric Houvenagel\\scripts\\mcp-server.mjs"],
      "env": {
        "PLAYWRIGHT_BROWSERS_PATH": "C:\\Users\\Hijo\\AppData\\Local\\ms-playwright"
      }
    }
  }
}
```

### Vibe

Depuis le shell (écrit dans la config utilisateur) :

```bash
vibe mcp add galerie-3d --transport stdio ^
  --command node ^
  --arg "C:\Users\Hijo\Documents\Antigravity\Mistral\Eric Houvenagel\scripts\mcp-server.mjs" ^
  --env PLAYWRIGHT_BROWSERS_PATH=C:\Users\Hijo\AppData\Local\ms-playwright
```

(sous Git Bash,échappe les backslashes ; dans Vibe Desktop, `/mcp` liste les serveurs et la config
équivalente est le `mcpServers` du `mcp.json` — `~/.vibe/` ou plugin projet — avec le bloc JSON ci-dessus).
Les tools apparaissent alors préfixés `mcp_galerie-3d.` (ex: `mcp_galerie-3d.shoot`).

### Claude Desktop (Windows)

`%APPDATA%\Claude\claude_desktop_config.json` :

```json
{
  "mcpServers": {
    "galerie-3d": {
      "command": "node",
      "args": ["C:\\Users\\Hijo\\Documents\\Antigravity\\Mistral\\Eric Houvenagel\\scripts\\mcp-server.mjs"]
    }
  }
}
```

Redémarrer le client après ajout. `PLAYWRIGHT_BROWSERS_PATH` est optionnel (valeur par défaut codée
en dur dans `scripts/mcp/helpers.mjs`).

## Selftest

```bash
npm run mcp:selftest
```

`scripts/mcp/selftest.mjs` spawn le serveur en stdio, parle JSON-RPC avec `Protocol` du SDK
(`@modelcontextprotocol/server`) + schémas zod de `@modelcontextprotocol/core`, et enchaîne :
`initialize → tools/list → dev_start(5199) → build → works_list → works_get(1er id) →
shoot(["desktop=0.45:1440x900:1"], ".vibe/shots-mcp") → perf → console_errors → verify_dup(3) → dev_stop`.
Exit 0 si tout passe, 0 erreur console, ≥ 1 PNG. Voir le rapport : `.vibe/critiques/mcp.md`.
