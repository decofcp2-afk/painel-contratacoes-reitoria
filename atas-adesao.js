(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AtasAdesao = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const BASE = 'https://dadosabertos.compras.gov.br/modulo-arp/';
  const PAGE_SIZE = 500;
  const MAX_PAGES = 12;

  function number(value) {
    if (value === null || value === undefined || value === '') return null;
    const result = Number(String(value).replace(',', '.'));
    return Number.isFinite(result) && result >= 0 ? result : null;
  }

  function identity(value) {
    const s = String(value || '').trim();
    const m = /^(\d+)[/-](\d{4})$/.exec(s);
    if (!m) return s.replace(/^0+(?=\d)/, '');
    return m[1].replace(/^0+(?=\d)/, '') + '/' + m[2];
  }

  function normalizeItem(value, knownItems = []) {
    const input = String(value || '').trim();
    if (!/^\d+$/.test(input)) return input;
    const exact = knownItems.find(item => /^\d+$/.test(String(item)) &&
      Number(item) === Number(input));
    return exact === undefined ? input.padStart(5, '0') : String(exact);
  }

  function context(ata) {
    const uasg = String(ata.codigoUnidadeGerenciadora || '').trim();
    const numeroAta = String(ata.numeroAtaRegistroPreco || '').trim();
    if (!/^\d{5,6}$/.test(uasg) || !/^\d+[/-]\d{4}$/.test(numeroAta)) return null;
    return {uasg, numeroAta};
  }

  function percentage(row) {
    const balance = number(row.saldoAdesao);
    const limit = number(row.qtdLimiteAdesao);
    if (balance === null || limit === null || limit === 0 || balance > limit) return null;
    return balance / limit * 100;
  }

  async function withDeadline(task, timeoutMs) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        task(controller.signal),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Tempo limite da consulta excedido.'));
          }, timeoutMs || 15000);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function pages(endpoint, params, fetcher, signal) {
    const records = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const query = new URLSearchParams({...params, pagina:String(page), tamanhoPagina:String(PAGE_SIZE)});
      const response = await fetcher(BASE + endpoint + '?' + query, {signal});
      if (!response.ok) throw new Error('Consulta de saldos indisponível no Compras.gov.br.');
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.resultado) ||
          !Number.isInteger(payload.totalPaginas) || payload.totalPaginas < 0)
        throw new Error('Resposta inesperada da consulta de saldos.');
      records.push(...payload.resultado);
      if (page >= payload.totalPaginas) return records;
    }
    throw new Error('A consulta trouxe muitos resultados. Informe o número do item.');
  }

  async function listItems(ata, fetcher, signal) {
    const ctx = context(ata);
    if (!ctx) throw new Error('A ata não tem número ou UASG compatível com a consulta do Compras.gov.br.');
    const date = String(ata.dataVigenciaInicial || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new Error('Informe o número do item: a ata não tem início de vigência para localizar seus itens.');
    const params = {
      codigoUnidadeGerenciadora:ctx.uasg,
      dataVigenciaInicialMin:date,
      dataVigenciaInicialMax:date
    };
    if (ata.origemConsulta !== 'pncp' && /^\d+$/.test(String(ata.numeroCompra || '')))
      params.numeroCompra = String(ata.numeroCompra);
    const items = new Map();
    const collect = records => records.forEach(record => {
      if (!record || record.itemExcluido === true ||
          String(record.codigoUnidadeGerenciadora || '') !== ctx.uasg ||
          identity(record.numeroAtaRegistroPreco) !== identity(ctx.numeroAta)) return;
      if (ata.numeroControlePncpAta && record.numeroControlePncpAta &&
          String(record.numeroControlePncpAta) !== String(ata.numeroControlePncpAta)) return;
      const item = String(record.numeroItem || '').trim();
      if (!/^\d+$/.test(item)) return;
      if (!items.has(item)) items.set(item, {
        numeroItem:item,
        descricao:String(record.descricaoItem || '').trim()
      });
    });
    collect(await pages('2_consultarARPItem', params, fetcher, signal));
    // Algumas atas publicadas trazem o início com diferença de data na API de itens.
    // Com a compra conhecida, uma segunda consulta restrita ao mesmo ano continua segura.
    if (!items.size && params.numeroCompra) {
      collect(await pages('2_consultarARPItem', {
        ...params, dataVigenciaInicialMin:date.slice(0, 4) + '-01-01',
        dataVigenciaInicialMax:date.slice(0, 4) + '-12-31'
      }, fetcher, signal));
    }
    return [...items.values()].sort((a, b) => Number(a.numeroItem) - Number(b.numeroItem));
  }

  async function getBalance(ata, item, fetcher, signal) {
    const ctx = context(ata);
    if (!ctx || !/^\d+$/.test(String(item || '')))
      throw new Error('Informe um número de item válido para esta ata.');
    const rows = await pages('3_consultarUnidadesItem', {
      numeroAta:ctx.numeroAta, unidadeGerenciadora:ctx.uasg, numeroItem:String(item)
    }, fetcher, signal);
    return rows.filter(row => row && row.excluida !== true &&
      identity(row.numeroAta) === identity(ctx.numeroAta) &&
      String(row.unidadeGerenciadora || '') === ctx.uasg &&
      String(row.numeroItem || '').replace(/^0+(?=\d)/, '') === String(item).replace(/^0+(?=\d)/, '')
    ).map(row => ({
      unidade:String(row.unidade || row.unidadeGerenciadora || '').trim(),
      fornecedor:String(row.fornecedor || '').trim(),
      descricao:String(row.descricaoItem || '').trim(),
      registrado:number(row.quantidadeRegistrada),
      saldo:number(row.saldoAdesao),
      limite:number(row.qtdLimiteAdesao),
      percentual:percentage(row),
      atualizadoEm:String(row.dataHoraAtualizacao || '').trim()
    }));
  }

  return {context, identity, normalizeItem, percentage, withDeadline, listItems, getBalance};
});
