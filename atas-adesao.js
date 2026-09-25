(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AtasAdesao = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const BASE = 'https://dadosabertos.compras.gov.br/modulo-arp/';
  const PAGE_SIZE = 100;
  const MAX_PAGES = 20;

  async function proxyFetch(url, options = {}, gateway = globalThis.PainelGateway) {
    const request = new URL(url);
    if (request.origin !== 'https://dadosabertos.compras.gov.br')
      throw new Error('Fonte de ARP não permitida.');
    const endpoint = request.pathname === '/modulo-arp/2_consultarARPItem' ? 'itens' :
      request.pathname === '/modulo-arp/3_consultarUnidadesItem' ? 'saldo' : '';
    if (!endpoint || !gateway?.chamarApi) throw new Error('Consulta de ARP não configurada.');
    const payload = await gateway.chamarApi('arp.proxy',
      {endpoint, ...Object.fromEntries(request.searchParams)}, {signal:options.signal});
    if (!payload?.ok) throw new Error(payload?.erro || 'Consulta oficial indisponível.');
    return {ok:true, json:async () => payload};
  }

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
    const balance = number(row.saldoAdesoes ?? row.saldoAdesao);
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
    if (!items.size) {
      const start = new Date(date + 'T12:00:00Z');
      const end = new Date(start);
      start.setUTCDate(start.getUTCDate() - 7);
      end.setUTCDate(end.getUTCDate() + 7);
      const min = start.toISOString().slice(0, 10);
      const max = end.toISOString().slice(0, 10);
      if (min.slice(0, 4) === max.slice(0, 4)) {
        collect(await pages('2_consultarARPItem', {
          ...params, dataVigenciaInicialMin:min, dataVigenciaInicialMax:max
        }, fetcher, signal));
      }
    }
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
    const matches = rows.filter(row => row && row.excluida !== true && !row.dataHoraExclusao &&
      identity(row.numeroAta) === identity(ctx.numeroAta) &&
      String(row.unidadeGerenciadora || '') === ctx.uasg &&
      String(row.numeroItem || '').replace(/^0+(?=\d)/, '') === String(item).replace(/^0+(?=\d)/, '')
    ).map(row => ({
      unidade:String(row.nomeUnidade || row.unidade || row.codigoUnidade || row.unidadeGerenciadora || '').trim(),
      tipoUnidade:String(row.tipoUnidade || '').trim(),
      fornecedor:String(row.fornecedor || '').trim(),
      descricao:String(row.descricaoItem || '').trim(),
      registrado:number(row.quantidadeRegistrada),
      saldo:number(row.saldoAdesoes ?? row.saldoAdesao),
      limite:number(row.qtdLimiteAdesao),
      percentual:percentage(row),
      aceitaAdesao:row.aceitaAdesao !== false,
      atualizadoEm:String(row.dataHoraAtualizacao || '').trim()
    }));
    const suppliers = new Map();
    matches.forEach(row => {
      const key = row.fornecedor || 'Fornecedor não informado';
      const current = suppliers.get(key);
      if (!current) { suppliers.set(key, {...row, unidades:1, divergente:false}); return; }
      const divergent = current.divergente || current.saldo !== row.saldo || current.limite !== row.limite;
      const preferred = row.tipoUnidade === 'GERENCIADORA' && current.tipoUnidade !== 'GERENCIADORA' ? row : current;
      suppliers.set(key, {...preferred, unidades:current.unidades + 1, divergente:divergent});
    });
    return [...suppliers.values()];
  }

  return {context, identity, normalizeItem, percentage, withDeadline, listItems, getBalance, proxyFetch};
});
