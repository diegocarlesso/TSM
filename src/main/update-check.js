'use strict';
/**
 * Aviso de nova versão — roda INTEIRAMENTE no processo principal.
 *
 * O renderer tem CSP com `connect-src 'none'`: nenhuma chamada de rede sai da
 * interface, de propósito. Fazendo a consulta aqui, essa garantia continua
 * valendo — o main é processo Node de confiança e só pergunta à API pública do
 * GitHub "qual é a última tag?", sem mandar nenhum dado do usuário. O resultado
 * volta ao renderer por IPC.
 *
 * `fetch` é o global do Node (Electron 38 roda sobre Node 20+), então não entra
 * dependência nova só para isso.
 */
const repo = require('./store/repo');

const RELEASES_URL = 'https://api.github.com/repos/diegocarlesso/TSM/releases/latest';
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Compara duas versões "major.minor.patch". Função pura, sem I/O, para poder
 * ser testada sem rede.
 *
 * Aceita o prefixo `v` (`v1.3.2` === `1.3.2`) e ignora sufixos de pré-lançamento
 * (`1.3.2-beta` === `1.3.2`): o objetivo aqui é só decidir se existe versão mais
 * nova publicada, não implementar semver completo. Partes ausentes valem 0, de
 * modo que `1.4` === `1.4.0`.
 *
 * @returns {-1|0|1}
 */
function compareVersions(a, b) {
  const parse = (v) => String(v ?? '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]            // descarta sufixo de pré-lançamento
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);

  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** Versão do app; isolado numa função para o `require('electron')` ficar tardio. */
function currentVersion() {
  return require('electron').app.getVersion();
}

/**
 * Consulta o GitHub Releases e devolve o que o renderer precisa para avisar.
 *
 * - desligado nas preferências e sem `force` -> `{ skipped: true }`;
 * - consultado há menos de uma semana e sem `force` -> devolve o resultado em cache;
 * - falha de rede -> `{ error: true }` e NÃO marca `lastCheckAt`, para tentar de
 *   novo na próxima oportunidade em vez de esperar uma semana por causa de uma
 *   queda momentânea.
 */
async function checkForUpdate({ force = false } = {}) {
  if (!repo.settings.get('update.checkEnabled', true) && !force) {
    return { skipped: true };
  }

  if (!force) {
    const lastCheckAt = Number(repo.settings.get('update.lastCheckAt', 0)) || 0;
    if (Date.now() - lastCheckAt < ONE_WEEK_MS) {
      const cached = repo.settings.get('update.lastResult', null);
      if (cached && cached.latest) {
        const current = currentVersion();
        return {
          current,
          latest: cached.latest,
          hasUpdate: compareVersions(cached.latest, current) > 0,
          url: cached.url,
          checkedAt: cached.checkedAt,
          cached: true
        };
      }
    }
  }

  let payload;
  try {
    const res = await fetch(RELEASES_URL, { headers: { 'User-Agent': 'TSM-update-check' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } catch {
    // Offline, GitHub fora do ar, rate limit: nada disso é erro do usuário.
    return { error: true };
  }

  const latest = String(payload.tag_name || '').trim();
  if (!latest) return { error: true };

  const url = payload.html_url || 'https://github.com/diegocarlesso/TSM/releases';
  const current = currentVersion();
  const checkedAt = Date.now();

  repo.settings.set('update.lastCheckAt', checkedAt);
  repo.settings.set('update.lastResult', { latest, url, checkedAt });

  return {
    current,
    latest,
    hasUpdate: compareVersions(latest, current) > 0,
    url,
    checkedAt
  };
}

module.exports = { compareVersions, checkForUpdate, RELEASES_URL };
