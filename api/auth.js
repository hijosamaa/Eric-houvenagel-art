import { randomUUID } from 'node:crypto';

export default function handler(req, res) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    res.status(500).send('Variable GITHUB_CLIENT_ID manquante (voir docs/admin.md)');
    return;
  }
  const origin = req.headers.origin || `https://${req.headers.host}`;
  const state = randomUUID();
  const redirectUri = `${origin}/api/callback`;
  const url =
    'https://github.com/login/oauth/authorize' +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    '&scope=repo' +
    `&state=${state}`;
  res.setHeader('Set-Cookie', [
    `decap_state=${state}; HttpOnly; SameSite=Lax; Path=/; Secure`,
    `decap_origin=${encodeURIComponent(origin)}; HttpOnly; SameSite=Lax; Path=/; Secure`,
  ]);
  res.writeHead(302, { Location: url });
  res.end();
}
