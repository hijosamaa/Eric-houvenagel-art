function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export default async function handler(req, res) {
  const { code, state } = req.query || {};
  const cookies = parseCookies(req.headers.cookie);
  if (!code || !state || cookies.decap_state !== state) {
    res.status(400).send('Paramètres OAuth invalides (state). Relancez la connexion depuis /admin/');
    return;
  }
  const origin = decodeURIComponent(cookies.decap_origin || `https://${req.headers.host}`);
  let token;
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${origin}/api/callback`,
      }),
    });
    const data = await tokenRes.json();
    if (!data.access_token) throw new Error(JSON.stringify(data).slice(0, 200));
    token = data.access_token;
  } catch (e) {
    res.status(502).send(`Échec de l'échange du token GitHub : ${e.message}`);
    return;
  }
  const html = `<!doctype html><html><body><script>
    window.opener.postMessage(
      { type: 'authorization:github:success', data: { token: ${JSON.stringify(token)}, provider: 'github' } },
      ${JSON.stringify(origin)}
    );
    window.close();
  </script></body></html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Set-Cookie', [
    'decap_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure',
    'decap_origin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure',
  ]);
  res.status(200).send(html);
}
