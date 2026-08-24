# listening-spotify

Uma página com um carrossel 3D das capas das **20 músicas** que mais toquei no
Spotify nos últimos 7 dias. As capas se movem sozinhas. Sem backend, sem
servidor, sem build.

Publicado em <https://bonbap.com.br/listening-spotify/>.

## Como funciona

Um GitHub Action roda a cada 30 minutos, puxa `/me/player/recently-played`,
anexa as faixas novas num histórico versionado e recalcula o ranking da janela
de 7 dias. O resultado vai pra `data/listening.json`, servido pelo GitHub
Pages, e a página monta o carrossel a partir dele.

**Por que acumular em vez de usar `/me/top`:** o endpoint `/me/top` só aceita
janelas de ~4 semanas, ~6 meses ou "todo o sempre" — não existe opção de 1
semana. Contando os plays de `recently-played` a janela vira o que a gente
quiser, e as contagens passam a ser plays reais em vez de um score opaco da
Spotify.

```
index.html          # a página do carrossel (CSS e JS embutidos)
scripts/auth.mjs    # roda 1x na sua máquina, gera o refresh token
scripts/update.mjs  # roda no Action, coleta e agrega
data/history.json   # plays brutos, 14 dias
data/listening.json # o que a página consome
```

### O carrossel

É um porte em CSS puro do componente React/Tailwind de marquee 3D — mesmo
efeito, zero dependência, roda no Pages do jeito que está.

Um quadrado grande girado em isometria (`rotateX(50deg) rotateZ(45deg)`) vira
um losango, e a tela mostra só uma fatia dele. Pra não sobrar canto vazio o
lado do quadrado tem que ser pelo menos `largura/√2 + altura` — daí o
`calc(71vw + 100vh)` no CSS. As colunas derivam pra cima e pra baixo em
períodos que não são múltiplos (13s e 19s), então o conjunto demora muito a
repetir a mesma configuração.

Faixas do mesmo disco dividem a mesma capa, então `track_art` vem deduplicado:
20 músicas de um álbum só viravam 20 quadrados idênticos girando na tela. Se
sobrarem menos capas que os 36 quadros da grade, elas se repetem — a repetição
é distribuída pra que a mesma capa nunca fique colada nela mesma.

## Setup

### 1. Cria o app no Spotify

Em <https://developer.spotify.com/dashboard>, cria um app e adiciona como
Redirect URI **exatamente** isto:

```
http://127.0.0.1:8888/callback
```

Tem que ser `127.0.0.1`, não `localhost` — a Spotify descontinuou `localhost`
como redirect URI. Anota o Client ID e o Client Secret.

O app fica em *development mode*, limitado a 25 usuários. Pra uso pessoal tanto
faz: você é o único, e não precisa pedir extensão de quota.

### 2. Pega o refresh token (uma vez só)

Precisa de Node 20+.

```bash
SPOTIFY_CLIENT_ID=seu_id SPOTIFY_CLIENT_SECRET=seu_secret node scripts/auth.mjs
```

Abre a URL que aparecer, autoriza, e o refresh token sai no terminal. Ele não
expira.

### 3. Guarda os secrets no repositório

Em **Settings → Secrets and variables → Actions**, cria os três:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REFRESH_TOKEN`

### 4. Liga o Pages e o Action

- **Settings → Pages** → Source: *Deploy from a branch* → `main` / `/ (root)`.
- **Actions → Atualiza dados do Spotify → Run workflow** pra rodar a primeira
  coleta na hora, sem esperar o cron.

Como o CNAME `bonbap.com.br` está no repo de user site (`henribon.github.io`),
este project site é servido em `bonbap.com.br/listening-spotify/` — mesmo
domínio, então a página busca o JSON por caminho relativo e a fonte Valmist de
`/fonts/` funciona sem cópia.

### 5. Linka no bonbap.com.br

No `index.html` do site, dentro do `<nav>`:

```html
<a class="link" href="/listening-spotify/">
  <span>
    <span class="name">Ouvindo</span>
    <span class="desc">As músicas que mais toquei nos últimos 7 dias</span>
  </span>
  <span class="go" aria-hidden="true">&rarr;</span>
</a>
```

## Notas

- **A primeira semana fica magra.** O histórico se acumula a partir do momento
  em que o Action começa a rodar; até completar 7 dias a legenda mostra o
  número real de faixas, que pode ser menor que 20.
- `recently-played` só devolve as últimas 50 faixas e só conta reprodução acima
  de ~30 s. Rodando de 30 em 30 min sobra folga (50 faixas ≈ 2h30 de escuta),
  mas se o Action ficar dias parado, perde o que passar disso.
- Podcasts e arquivos locais não entram — a API não os reporta nesse endpoint.
- O JSON também traz `top_artists` e `top_albums` (10 cada), que a página do
  carrossel não usa. Ficam ali caso você queira uma listagem depois.
- Ajustes ficam no topo do `scripts/update.mjs`: `WINDOW_DAYS` (janela),
  `RETAIN_DAYS` (histórico bruto), `TRACK_N` (músicas do carrossel) e `TOP_N`
  (demais rankings). No `index.html`, `COLUMNS` e `MIN_TILES` controlam a
  densidade da grade — se mudar `COLUMNS`, `MIN_TILES` precisa ser pelo menos
  `COLUMNS²` pra coluna nenhuma ficar curta demais e descobrir a borda.
