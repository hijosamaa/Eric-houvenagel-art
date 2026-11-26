// Selftest du serveur MCP : client MCP stdio basé sur le SDK (@modelcontextprotocol/server).
// Spawn `node scripts/mcp-server.mjs`, parle JSON-RPC newline-delimited sur stdio,
// puis appelle séquentiellement :
//   tools/list, dev_start(5199), build, works_list, works_get(1er id),
//   shoot(["desktop=0.45:1440x900:1"], ".vibe/shots-mcp"), perf, console_errors,
//   verify_dup(3), dev_stop
// Exit 0 si tout réussit, 0 erreur console côté site et >= 1 PNG produit.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Protocol, LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server';
import { InitializeResultSchema, ListToolsResultSchema, CallToolResultSchema } from '@modelcontextprotocol/core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = path.join(ROOT, 'scripts', 'mcp-server.mjs');

// Transport stdio client : spawn du serveur, messages JSON délimités par \n.
class StdioClientTransport {
  constructor(command, args, options) {
    this.onmessage = undefined;
    this.onclose = undefined;
    this.onerror = undefined;
    this._child = spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
  }
  async start() {
    let buf = '';
    this._child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        try {
          this.onmessage?.(JSON.parse(line));
        } catch (e) {
          this.onerror?.(e);
        }
      }
    });
    this._child.stderr.on('data', (d) => process.stderr.write(`[server-stderr] ${d}`));
    this._child.on('error', (e) => this.onerror?.(e));
    this._child.on('close', (code) => this.onclose?.(code));
  }
  async send(message) {
    this._child.stdin.write(JSON.stringify(message) + '\n');
  }
  async close() {
    try { this._child.kill('SIGKILL'); } catch {}
  }
}

const results = [];
function record(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const transport = new StdioClientTransport(process.execPath, [SERVER], { cwd: ROOT });
  // Le package server n'exporte pas de Client (c'est un package séparé) :
  // on dérive Protocol du SDK, en no-op sur le check de capability serveur (inutile côté client).
  class SelftestClient extends Protocol {
    assertRequestHandlerCapability() {}
    assertNotificationCapability() {}
    assertCapabilityForMethod() {}
  }
  const client = new SelftestClient();
  client.onerror = (e) => console.error('[client onerror]', e);
  await client.connect(transport);

  const init = await client.request(
    {
      method: 'initialize',
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'mcp-selftest', version: '1.0.0' },
      },
    },
    InitializeResultSchema,
    { timeout: 30000 },
  );
  record('initialize', !!init?.serverInfo, `server=${init?.serverInfo?.name}@${init?.serverInfo?.version} protocol=${init?.protocolVersion}`);
  await client.notification({ method: 'notifications/initialized' });

  const tools = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema, { timeout: 30000 });
  const names = (tools.tools ?? []).map((t) => t.name).sort();
  record('tools/list', names.length >= 10, `${names.length} tools: ${names.join(', ')}`);

  const call = async (name, args = {}, timeout = 600000) => {
    const res = await client.request(
      { method: 'tools/call', params: { name, arguments: args } },
      CallToolResultSchema,
      { timeout },
    );
    const text = (res.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    return { isError: !!res.isError, parsed, raw: text };
  };

  // dev_start(5199)
  let r = await call('dev_start', { port: 5199 }, 180000);
  record('dev_start(5199)', !r.isError && (r.parsed.started || r.parsed.alreadyRunning), `port=${r.parsed.port} url=${r.parsed.url ?? ''} ${r.parsed.error ?? ''}`);

  // build
  r = await call('build', {}, 600000);
  record('build', !r.isError && r.parsed.exitCode === 0, `exitCode=${r.parsed.exitCode}`);

  // works_list
  r = await call('works_list', {}, 60000);
  const firstId = r.parsed?.works?.[0]?.id;
  record('works_list', !r.isError && r.parsed.count > 0, `count=${r.parsed?.count} firstId=${firstId}`);

  // works_get(firstId)
  r = await call('works_get', { id: firstId }, 60000);
  record('works_get', !r.isError && r.parsed?.work?.title, `id=${firstId} title=${r.parsed?.work?.title ?? '?'}`);

  // shoot
  r = await call('shoot', { specs: ['desktop=0.45:1440x900:1'], outDir: '.vibe/shots-mcp' }, 600000);
  const pngCount = r.parsed?.pngCount ?? 0;
  record('shoot(desktop=0.45:1440x900:1)', !r.isError && r.parsed?.exitCode === 0 && pngCount >= 1,
    `pngCount=${pngCount} consoleErrorCount=${r.parsed?.consoleErrorCount} pngs=${(r.parsed?.pngs ?? []).join(',')}`);

  // perf
  r = await call('perf', {}, 300000);
  record('perf', !r.isError && typeof r.parsed?.fps === 'number' && r.parsed?.rendererInfo,
    `fps=${r.parsed?.fps} calls=${r.parsed?.rendererInfo?.render?.calls} tris=${r.parsed?.rendererInfo?.render?.triangles}`);

  // console_errors
  r = await call('console_errors', {}, 60000);
  record('console_errors', !r.isError && r.parsed?.count === 0, `count=${r.parsed?.count} source=${r.parsed?.source ?? ''}`);

  // verify_dup(3)
  r = await call('verify_dup', { n: 3 }, 600000);
  record('verify_dup(3)', !r.isError && r.parsed?.ok === true,
    `ok=${r.parsed?.ok} violations=${r.parsed?.violationsTotal} consoleErrors=${r.parsed?.consoleErrorCount} shots=${(r.parsed?.shots ?? []).length}`);

  // dev_stop
  r = await call('dev_stop', {}, 60000);
  record('dev_stop', !r.isError && (r.parsed?.stopped || r.parsed?.portFree), `stopped=${r.parsed?.stopped} portFree=${r.parsed?.portFree}`);

  await client.close();
  await transport.close();

  const failed = results.filter((x) => !x.ok);
  const summary = {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.map((f) => f.step),
    verdict: failed.length === 0 ? 'READY' : 'NOT READY',
    results,
  };
  console.log('\n== SELFTEST SUMMARY ==');
  console.log(JSON.stringify(summary, null, 2));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('SELFTEST CRASH:', e);
  process.exit(2);
});
