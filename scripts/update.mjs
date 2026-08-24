/**
 * Roda no GitHub Actions, 1x por semana. Busca as faixas mais ouvidas e
 * escreve o JSON que a pagina consome.
 *
 * Usa /me/top/tracks, que ja devolve o ranking pronto - sem historico, sem
 * acumulo. A contrapartida e a janela: o endpoint so aceita short_term
 * (~4 semanas), medium_term (~6 meses) e long_term. Nao existe 1 semana,
 * entao a pagina fala em "ultimas 4 semanas".
 *
 * Tambem nao ha contagem de plays aqui: a Spotify devolve so a ordem, por
 * um criterio proprio que ela nao detalha.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const RANGE = 'short_term';   // ~4 semanas
const RANGE_LABEL = 'nas últimas 4 semanas';
const LIMIT = 20;             // faixas no carrossel

const DATA_DIR = path.join(process.cwd(), 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'listening.json');

const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } = process.env;

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REFRESH_TOKEN) {
  console.error('Faltam os secrets SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET / SPOTIFY_REFRESH_TOKEN.');
  process.exit(1);
}

async function getAccessToken() {
  const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: SPOTIFY_REFRESH_TOKEN,
    }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`refresh falhou (${r.status}): ${JSON.stringify(body)}`);
  return body.access_token;
}

const token = await getAccessToken();

const url = `https://api.spotify.com/v1/me/top/tracks?limit=${LIMIT}&time_range=${RANGE}`;
const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

if (r.status === 403) {
  // Quase sempre e o refresh token velho, gerado antes de user-top-read
  // entrar na lista de scopes do auth.mjs.
  console.error(
    'A Spotify recusou (403). O refresh token provavelmente nao tem o scope\n' +
    '`user-top-read`. Roda o scripts/auth.mjs de novo e troca o secret\n' +
    'SPOTIFY_REFRESH_TOKEN pelo valor novo.',
  );
  process.exit(1);
}
if (!r.ok) throw new Error(`${url} -> ${r.status} ${await r.text()}`);

const body = await r.json();

const tracks = (body.items ?? []).map((t) => {
  const images = t.album?.images ?? [];
  return {
    name: t.name,
    artist: (t.artists ?? []).map((a) => a.name).join(', '),
    album: t.album?.name ?? null,
    // images vem do maior pro menor; o do meio (~300px) serve bem
    image: images[1]?.url ?? images[0]?.url ?? null,
    url: t.external_urls?.spotify ?? null,
  };
});

const out = {
  generated_at: new Date().toISOString(),
  range: RANGE,
  range_label: RANGE_LABEL,
  tracks,
};

await fs.mkdir(DATA_DIR, { recursive: true });
await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2) + '\n');

console.log(`${tracks.length} faixas ${RANGE_LABEL}`);
if (tracks[0]) console.log(`#1: ${tracks[0].name} — ${tracks[0].artist}`);
