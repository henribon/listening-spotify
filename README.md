# listening-spotify

Uma página com um carrossel das capas das 20 músicas que mais ouvi no Spotify.
As capas correm sozinhas, param quando o mouse chega perto e abrem a faixa no
Spotify quando clicadas. Sem backend, sem servidor, sem build.

Publicado em <https://bonbap.com.br/listening-spotify/>.

## Como funciona

Um GitHub Action roda toda segunda-feira, chama `/me/top/tracks` e grava
`data/listening.json`. O GitHub Pages serve o arquivo, e a página monta o
carrossel a partir dele.

**A janela é de ~4 semanas, não de 1 semana.** O `/me/top` só aceita
`short_term` (~4 semanas), `medium_term` (~6 meses) e `long_term`. Não existe
opção de 7 dias, e não existe endpoint de top álbuns. O texto da página diz
"nas últimas 4 semanas" justamente por isso.

Esse endpoint também não devolve contagem de plays — só a ordem, por um
critério que a Spotify não detalha.

```
index.html          # a página do carrossel (CSS e JS embutidos)
scripts/auth.mjs    # roda 1x na sua máquina, gera o refresh token
scripts/update.mjs  # roda no Action, busca o ranking
data/listening.json # o que a página consome
```

### O carrossel

A fita tem duas cópias idênticas da lista lado a lado, e a animação desliza
até `-50%` — exatamente uma cópia. No instante em que termina, o que está na
tela é igual ao quadro inicial, então o loop não tem emenda.

A duração é calculada em JS a partir da largura real, pra velocidade ficar
constante (45 px/s) independente de quantas faixas ou do tamanho da tela. O
cálculo é síncrono de propósito: dentro de um `requestAnimationFrame` ele não
rodaria com a aba em segundo plano.

A segunda cópia é `aria-hidden` e fora da ordem de foco, senão cada faixa
apareceria duas vezes na navegação por teclado. Com `prefers-reduced-motion`
a animação some, a segunda cópia é escondida e a faixa vira rolável na mão.

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

Precisa de Node 20+. Com um arquivo `secrets.env` contendo o Client ID e o
Secret (qualquer `*.env` é ignorado pelo git):

```bash
node --env-file=secrets.env scripts/auth.mjs
```

Abre a URL que aparecer, autoriza, e o refresh token sai no terminal. Ele não
expira.

> **Trocou de endpoint?** O scope pedido aqui é `user-top-read`. Um refresh
> token gerado antes disso não serve, e o Action falha com 403. Se acontecer,
> roda este script de novo e atualiza o secret.

### 3. Guarda os secrets no repositório

```bash
gh secret set SPOTIFY_CLIENT_ID
```

O prompt pede o valor. Repete pros outros dois (`SPOTIFY_CLIENT_SECRET`,
`SPOTIFY_REFRESH_TOKEN`). Ou clicando: **Settings → Secrets and variables →
Actions → New repository secret**.

Depois que os três estiverem lá, apaga o `secrets.env`.

### 4. Liga o Pages e roda a primeira coleta

- **Settings → Pages** → Source: *Deploy from a branch* → `master` / `/ (root)`.
- **Actions → Atualiza dados do Spotify → Run workflow**, pra não esperar até
  segunda.

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
    <span class="desc">As músicas que mais tenho escutado</span>
  </span>
  <span class="go" aria-hidden="true">&rarr;</span>
</a>
```

## Notas

- Podcasts não entram — `/me/top/tracks` só devolve música.
- Faixas do mesmo disco dividem a mesma capa, então pode aparecer a mesma
  imagem mais de uma vez no carrossel. Cada uma linka pra sua própria faixa.
- Ajustes ficam no topo do `scripts/update.mjs`: `RANGE` (janela), `LIMIT`
  (quantas faixas) e `RANGE_LABEL` (o texto da legenda — muda junto com
  `RANGE`, senão a página mente). No `index.html`, `VELOCIDADE` controla os
  px/s do carrossel.
