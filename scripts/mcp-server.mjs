// Serveur MCP (stdio) pour la galerie virtuelle d'Eric Houvenagel.
// Lancé par un client MCP (Vibe, Claude Desktop, selftest) :
//   node scripts/mcp-server.mjs
// Ne fait PAS partie du bundle client (scripts/ n'est pas importé par src/).
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import {
  build, devStart, devStop, shoot, perf, verifyDup, consoleErrorsLast,
  worksList, worksGet, worksUpdate, devPort,
} from './mcp/helpers.mjs';

const server = new McpServer(
  { name: 'galerie-3d', version: '1.0.0' },
  { capabilities: { tools: { listChanged: false } } },
);

function json(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}
function err(error) {
  return { content: [{ type: 'text', text: String(error?.stack || error) }], isError: true };
}
function register(name, description, inputSchema, handler) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      return json(await handler(args ?? {}));
    } catch (e) {
      return err(e);
    }
  });
}

register('build', 'Exécute `npm run build` (tsc --noEmit + vite build). Retourne { exitCode, tail }.', z.object({}), () => build());

register('dev_start', 'Démarre `npm run dev -- --port <port>` en arrière-plan et attend que le port réponde. Défaut port=5199.', z.object({
  port: z.number().int().min(1).max(65535).default(5199),
}), ({ port }) => devStart(port));

register('dev_stop', 'Arrête le serveur dev lancé par dev_start (tue l’arbre npm→vite) et vérifie que le port est libéré.', z.object({}), () => devStop());

register(
  'shoot',
  'Lance le harness .vibe/shotkit/shoot.mjs (Playwright) contre http://localhost:<port>/ avec les specs données. spec = "nom=t:WxH[:dup[:actions]]" ex: "desktop=0.45:1440x900:1". Retourne la liste des PNG produits + les erreurs console collectées.',
  z.object({
    specs: z.array(z.string()).default(['desktop=0.45:1440x900:1']),
    outDir: z.string().default('.vibe/shots-mcp'),
    port: z.number().int().min(1).max(65535).optional(),
  }),
  ({ specs, outDir, port }) => shoot(specs, outDir, port ?? devPort()),
);

register('perf', 'Via Playwright : lit window.__gallery.perf() (renderer.info) + fps mesuré sur 2 s en 1440x900. Retourne le JSON.', z.object({
  port: z.number().int().min(1).max(65535).optional(),
}), ({ port }) => perf(port ?? devPort()));

register('console_errors', 'Erreurs console (console + pageerror) collectées lors du dernier run shoot / verify_dup.', z.object({}), () => consoleErrorsLast());

register('works_list', 'Liste les œuvres (data/works/*.json) : id + schéma complet (title, year, medium, dimensions, description, room, order, image).', z.object({}), () => worksList());

register('works_get', 'Retourne une œuvre par id (nom du fichier data/works/<id>.json).', z.object({
  id: z.string().min(1),
}), ({ id }) => worksGet(id));

register(
  'works_update',
  'Patch une œuvre (clés autorisées : title, year, medium, dimensions, description, room, order, image), réécrit data/works/<id>.json, relance `node scripts/build-data.mjs` et retourne le works.json régénéré (public/data/works.json).',
  z.object({
    id: z.string().min(1),
    patch: z.record(z.string(), z.unknown()),
  }),
  ({ id, patch }) => worksUpdate(id, patch),
);

register(
  'verify_dup',
  'Lance la galerie avec ?dup=n à 1440x900 et 390x844, scrolle t=0→1 en échantillonnant __gallery.controls.currentZ() vs __gallery.layout.zEnd (caméra jamais derrière le mur) + collecte les erreurs console. Retourne un verdict JSON { ok, violationsTotal, consoleErrorCount, ... }.',
  z.object({
    n: z.number().int().min(1).max(50).default(3),
    outDir: z.string().default('.vibe/shots-mcp/verify-dup'),
    port: z.number().int().min(1).max(65535).optional(),
  }),
  ({ n, outDir, port }) => verifyDup(n, outDir, port ?? devPort()),
);

serveStdio(() => server);
console.error('[mcp] galerie-3d MCP server ready on stdio');
