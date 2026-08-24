/**
 * Passo unico, roda so na sua maquina.
 *
 *   1. Cria um app em https://developer.spotify.com/dashboard
 *   2. Em "Redirect URIs" poe exatamente:  http://127.0.0.1:8888/callback
 *   3. SPOTIFY_CLIENT_ID=xxx SPOTIFY_CLIENT_SECRET=yyy node scripts/auth.mjs
 *   4. Autoriza no browser; o refresh token aparece no terminal.
 *
 * O refresh token nao expira. Guarda ele como secret do repositorio.
 */
import http from 'node:http';
import crypto from 'node:crypto';

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

// Spotify exige 127.0.0.1 explicito: "localhost" foi descontinuado como
// redirect URI. Tem que bater byte a byte com o que esta no dashboard.

const SCOPES = ['user-read-recently-played', 'user-read-currently-playing'].join(' ');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Faltou SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET no ambiente.');
  process.exit(1);
}

const state = crypto.randomBytes(16).toString('hex');
const authUrl =
  'https://accounts.spotify.com/authorize?' +
  new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    state,
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname !== '/callback') {
    res.writeHead(404).end();
    return;
  }

  const err = url.searchParams.get('error');
  if (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Autorizacao negada: ${err}`);
    console.error('Autorizacao negada:', err);
    server.close();
    process.exit(1);
  }

  if (url.searchParams.get('state') !== state) {
    res.writeHead(400).end('state nao confere');
    console.error('state nao confere - possivel CSRF, abortando.');
    server.close();
    process.exit(1);
  }

  const code = url.searchParams.get('code');
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  const body = await r.json();

  if (!r.ok) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Falhou a troca do code. Ve o terminal.');
    console.error('Erro na troca do code:', body);
    server.close();
    process.exit(1);
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>Pronto</h1><p>Pode fechar essa aba e voltar pro terminal.</p>');

  console.log('\n=======================================================');
  console.log('SPOTIFY_REFRESH_TOKEN=' + body.refresh_token);
  console.log('=======================================================');
  console.log('\nGuarda como secret do repositorio (Settings > Secrets and');
  console.log('variables > Actions), junto com CLIENT_ID e CLIENT_SECRET.\n');

  server.close();
  process.exit(0);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\nAbre essa URL no browser:\n');
  console.log(authUrl + '\n');
});
