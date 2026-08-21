/**
 * Confere que o suporte a serial funciona no aplicativo EMPACOTADO.
 *
 * O binario do serialport vem pre-compilado; se o empacotamento o deixar de
 * fora do asar, ou se a ABI nao bater, e aqui que aparece.
 */
(async () => {
  const log = [];
  let ok = true;
  const record = (passou, texto, detalhe) => {
    log.push(`  ${passou ? 'ok   ' : 'FALHA'} ${texto}` + (!passou && detalhe ? `\n        ${detalhe}` : ''));
    if (!passou) ok = false;
  };

  try {
    const info = await window.tsm.serial.info();
    record(info.available === true, 'o modulo serial carrega no app empacotado',
      JSON.stringify(info));
    record(Array.isArray(info.baudRates) && info.baudRates.includes(115200),
      'a tabela de velocidades chega ao renderer');

    const portas = await window.tsm.serial.list();
    record(Array.isArray(portas), `enumeracao de portas responde (${portas.length} encontrada(s))`,
      JSON.stringify(portas));
    if (portas.length) {
      record(typeof portas[0].path === 'string' && portas[0].path.length > 0,
        `a porta traz um caminho utilizavel: ${portas[0].path}`);
    }
  } catch (err) {
    record(false, 'suporte a serial indisponivel', err.message);
  }

  return { ok, log };
})()
