'use strict';
/**
 * Motor de automação no estilo "Expect": espera um padrão aparecer no texto que
 * chega da sessão e responde com um comando. Não conhece UI nem IPC — só uma
 * conexão viva (EventEmitter com `.on('data')` e `.write()`) e a lista de passos.
 */
const { EventEmitter } = require('node:events');
const { stripAnsi } = require('../logger');

/** Quanto de texto recente fica no buffer de casamento. */
const MAX_BUFFER = 8192;
const DEFAULT_TIMEOUT = 8000;

/**
 * Roda um roteiro expect/send contra uma conexão já aberta.
 * Eventos: 'step' ({ index, step }) quando um passo casa e o comando é
 * enviado; 'timeout' ({ index, step }) quando o passo estoura o prazo sem
 * casar; 'done' quando todos os passos terminam; 'error' (Error).
 */
class AutomationRun extends EventEmitter {
  constructor(conn, steps) {
    super();
    this.conn = conn;
    this.steps = Array.isArray(steps) ? steps : [];
    this.index = 0;
    this.buffer = '';
    this.timer = null;
    this.stopped = false;
    this._onData = (d) => this._feed(d);
  }

  start() {
    if (this.stopped) return;
    if (!this.steps.length) { this.stopped = true; this.emit('done'); return; }
    this.conn.on('data', this._onData);
    this._armTimeout();
    // O prompt que interessa quase sempre já passou antes de o usuário mandar
    // rodar o roteiro, e ele não volta sozinho. Por isso o primeiro passo é
    // avaliado de imediato contra o buffer vazio: um `expect` que casa com
    // vazio (`.*`, por exemplo) vira o "empurrão" inicial — tipicamente um
    // Enter — que faz o equipamento reimprimir o prompt para os passos seguintes.
    this._feed('');
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    this.conn.removeListener('data', this._onData);
  }

  _armTimeout() {
    clearTimeout(this.timer);
    const step = this.steps[this.index];
    const ms = Number(step && step.timeoutMs) > 0 ? Number(step.timeoutMs) : DEFAULT_TIMEOUT;
    this.timer = setTimeout(() => {
      if (this.stopped) return;
      const idx = this.index;
      this.stop();
      this.emit('timeout', { index: idx, step });
    }, ms);
  }

  _feed(chunk) {
    if (this.stopped) return;
    // As cores e o reposicionamento de cursor saem antes de casar: um prompt
    // costuma vir seguido de escapes, e isso quebraria qualquer padrão ancorado
    // em fim de texto — justo os mais úteis, como "[Pp]assword:\s*$".
    // A limpeza é do buffer inteiro (e não só do pedaço novo) porque uma
    // sequência de escape pode chegar picotada entre dois chunks.
    this.buffer = stripAnsi(this.buffer + chunk);
    // Não deixa o buffer crescer sem limite numa sessão barulhenta.
    if (this.buffer.length > MAX_BUFFER) this.buffer = this.buffer.slice(-MAX_BUFFER);

    const step = this.steps[this.index];
    let re;
    try {
      re = new RegExp(step.expect);
    } catch (err) {
      this.stop();
      this.emit('error', new Error(`Passo ${this.index + 1}: regex inválida — ${err.message}`));
      return;
    }
    if (!re.test(this.buffer)) return;

    // O texto que já casou não pode casar de novo no passo seguinte.
    this.buffer = '';
    const index = this.index;
    try {
      this.conn.write(String(step.send ?? '') + (step.sendEnter === false ? '' : '\n'));
    } catch (err) {
      this.stop();
      this.emit('error', new Error(`Passo ${index + 1}: falha ao enviar — ${err.message}`));
      return;
    }
    this.emit('step', { index, step });

    this.index++;
    if (this.index >= this.steps.length) {
      this.stop();
      this.emit('done');
      return;
    }
    this._armTimeout();
  }
}

module.exports = { AutomationRun, MAX_BUFFER, DEFAULT_TIMEOUT };
