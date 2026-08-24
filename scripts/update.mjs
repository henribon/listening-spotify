/**
 * Roda no GitHub Actions. Puxa as faixas tocadas desde a ultima execucao,
 * anexa no historico e recalcula o ranking dos ultimos 7 dias.
 *
 * Por que acumular em vez de usar /me/top: o endpoint /me/top so aceita
 * janelas de ~4 semanas, ~6 meses ou "todo o sempre" - nao existe 1 semana.
 * E nao existe endpoint de top albuns. Contando os plays de
 * /me/player/recently-played a gente resolve os dois problemas de uma vez.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const WINDOW_DAYS = 7;    // janela mostrada na pagina
const RETAIN_DAYS = 14;   // quanto historico bruto fica guardado
const TRACK_N = 20;       // musicas que alimentam o carrossel
const TOP_N = 10;         // demais rankings (artistas, albuns)

const DATA_DIR = path.join(process.cwd(), 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'listening.json');

const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } = process.env;

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REFRESH_TOKEN) {
  console.error('Faltam os secrets SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET / SPOTIFY_REFRESH_TOKEN.');
  process.exit(1);
}

/* ---------------------------------------------------------------- auth --- */

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

async function api(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 429) {
    // Rate limit. Nao vale esperar dentro do Action: a proxima execucao do
    // cron pega tudo de novo, o cursor esta salvo no historico.
    throw new Error(`rate limited, tenta de novo em ${r.headers.get('retry-after')}s`);
  }
  if (!r.ok) throw new Error(`${url} -> ${r.status} ${await r.text()}`);
  return r.json();
}

/* ------------------------------------------------------------- historico --- */

async function loadHistory() {
  try {
    return JSON.parse(await fs.readFile(HISTORY_FILE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

/** Achata a resposta da API no minimo que a pagina precisa. */
function toPlay(item) {
  const t = item.track;
  const images = t.album?.images ?? [];
  return {
    t: item.played_at,
    id: t.id,
    n: t.name,
    d: t.duration_ms,
    u: t.external_urls?.spotify ?? null,
    a: (t.artists ?? []).map((x) => ({ id: x.id, n: x.name })),
    al: {
      id: t.album?.id ?? null,
      n: t.album?.name ?? null,
      // images vem do maior pro menor; o do meio (~300px) serve bem
      img: images[1]?.url ?? images[0]?.url ?? null,
      u: t.album?.external_urls?.spotify ?? null,
      type: t.album?.album_type ?? null,
    },
  };
}

async function fetchNewPlays(token, sinceMs) {
  const plays = [];
  let url = sinceMs
    ? `https://api.spotify.com/v1/me/player/recently-played?limit=50&after=${sinceMs}`
    : 'https://api.spotify.com/v1/me/player/recently-played?limit=50';

  // Sem cursor a API devolve as ultimas 50 e pagina pra tras - nao interessa.
  // Com cursor ela pagina pra frente, ai vale a pena seguir o `next`.
  const maxPages = sinceMs ? 10 : 1;

  for (let page = 0; page < maxPages && url; page++) {
    const body = await api(url, token);
    for (const item of body.items ?? []) plays.push(toPlay(item));
    url = body.next;
  }
  return plays;
}

/* ------------------------------------------------------------- agregacao --- */

function rank(map, n) {
  return [...map.values()]
    .sort((a, b) => b.plays - a.plays || b.last - a.last)
    .slice(0, n);
}

function aggregate(plays) {
  const tracks = new Map();
  const artists = new Map();
  const albums = new Map();
  let ms = 0;

  for (const p of plays) {
    const at = Date.parse(p.t);
    ms += p.d ?? 0;

    if (p.id) {
      const cur = tracks.get(p.id) ?? {
        id: p.id, name: p.n, artist: p.a.map((x) => x.n).join(', '),
        album: p.al.n, image: p.al.img, url: p.u, plays: 0, last: 0,
      };
      cur.plays++;
      cur.last = Math.max(cur.last, at);
      tracks.set(p.id, cur);
    }

    // Um play conta uma vez por artista, mesmo em faixa com varios creditos.
    for (const id of new Set(p.a.map((x) => x.id).filter(Boolean))) {
      const name = p.a.find((x) => x.id === id).n;
      const cur = artists.get(id) ?? { id, name, image: null, url: null, plays: 0, last: 0 };
      cur.plays++;
      cur.last = Math.max(cur.last, at);
      artists.set(id, cur);
    }

    if (p.al.id) {
      const cur = albums.get(p.al.id) ?? {
        id: p.al.id, name: p.al.n, artist: p.a[0]?.n ?? null,
        image: p.al.img, url: p.al.u, type: p.al.type, plays: 0, last: 0,
      };
      cur.plays++;
      cur.last = Math.max(cur.last, at);
      albums.set(p.al.id, cur);
    }
  }

  return {
    tracks, artists, albums,
    totals: {
      plays: plays.length,
      minutes: Math.round(ms / 60000),
      unique_tracks: tracks.size,
      unique_artists: artists.size,
      unique_albums: albums.size,
    },
  };
}

/** recently-played nao traz foto de artista; busca so a dos que entraram no top. */
async function attachArtistImages(top, token) {
  const ids = top.map((a) => a.id).filter(Boolean);
  if (!ids.length) return top;
  const body = await api(`https://api.spotify.com/v1/artists?ids=${ids.join(',')}`, token);
  const byId = new Map((body.artists ?? []).filter(Boolean).map((a) => [a.id, a]));
  for (const a of top) {
    const full = byId.get(a.id);
    if (!full) continue;
    a.image = full.images?.[1]?.url ?? full.images?.[0]?.url ?? null;
    a.url = full.external_urls?.spotify ?? null;
  }
  return top;
}

/* ------------------------------------------------------------------ main --- */

const token = await getAccessToken();
const history = await loadHistory();

const latest = history.length ? Date.parse(history[0].t) : null;
const fresh = await fetchNewPlays(token, latest ? latest + 1 : null);
console.log(`Novos plays: ${fresh.length}`);

// Dedupe por played_at: e unico por play e a API pode repetir na borda do cursor.
const seen = new Set(history.map((p) => p.t));
const merged = [...fresh.filter((p) => !seen.has(p.t)), ...history];
merged.sort((a, b) => Date.parse(b.t) - Date.parse(a.t));

const now = Date.now();
const retained = merged.filter((p) => now - Date.parse(p.t) < RETAIN_DAYS * 864e5);
const windowStart = now - WINDOW_DAYS * 864e5;
const inWindow = retained.filter((p) => Date.parse(p.t) >= windowStart);

const { tracks, artists, albums, totals } = aggregate(inWindow);
const topTracks = rank(tracks, TRACK_N);

const out = {
  generated_at: new Date(now).toISOString(),
  window_days: WINDOW_DAYS,
  window_start: new Date(windowStart).toISOString(),
  // Quantos dias de dado a gente realmente tem. A pagina usa isso pra avisar
  // que o historico ainda esta enchendo.
  days_collected: retained.length
    ? Math.min(WINDOW_DAYS, (now - Date.parse(retained[retained.length - 1].t)) / 864e5)
    : 0,
  totals,
  top_tracks: topTracks,
  top_artists: await attachArtistImages(rank(artists, TOP_N), token),
  top_albums: rank(albums, TOP_N),
  // Capas do carrossel, em ordem de plays. Varias faixas do mesmo disco
  // dividem a mesma capa, entao dedupa: 20 musicas de um album so viravam
  // 20 quadrados identicos girando na tela.
  track_art: [...new Set(topTracks.map((t) => t.image).filter(Boolean))],
};

await fs.mkdir(DATA_DIR, { recursive: true });
// Um registro por linha deixa o diff de cada commit pequeno.
await fs.writeFile(
  HISTORY_FILE,
  '[\n' + retained.map((p) => JSON.stringify(p)).join(',\n') + '\n]\n',
);
await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2) + '\n');

console.log(
  `Historico: ${retained.length} plays | janela ${WINDOW_DAYS}d: ` +
  `${totals.plays} plays, ${totals.minutes} min, ${totals.unique_albums} albuns`,
);
