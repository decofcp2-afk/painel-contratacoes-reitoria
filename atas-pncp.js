/* Consulta direta: o índice de busca e a API ARP podem demorar a receber atas novas. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AtasPNCP = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const BASE = 'https://pncp.gov.br/api/consulta/v1/';

  function purchasePath(id) {
    const match = /^(\d{14})-1-(\d+)\/(\d{4})$/.exec(String(id || ''));
    if (!match) throw new Error('Identificador de compra PNCP inválido');
    return `orgaos/${match[1]}/compras/${match[3]}/${Number(match[2])}`;
  }

  function mapRecord(row, purchase, previous = {}) {
    const path = purchasePath(row.numeroControlePNCPCompra);
    const number = String(row.numeroAtaRegistroPreco || '');
    return {...previous,
      numeroAtaRegistroPreco:number.includes('/') ? number : number + '/' + row.anoAta,
      codigoUnidadeGerenciadora:String(row.codigoUnidadeOrgao),
      nomeUnidadeGerenciadora:row.nomeUnidadeOrgao, nomeOrgao:row.nomeOrgao,
      objeto:row.objetoContratacao, dataAssinatura:row.dataAssinatura,
      dataVigenciaInicial:row.vigenciaInicio, dataVigenciaFinal:row.vigenciaFim,
      ataExcluido:row.cancelado === true, statusAta:row.cancelado ? 'Cancelada' : 'Ata de Registro de Preços',
      numeroControlePncpAta:row.numeroControlePNCPAta, possibilidadeAdesao:row.possibilidadeAdesao,
      numeroCompra:String(purchase.numeroCompra), anoCompra:String(purchase.anoCompra),
      numeroProcesso:purchase.processo || purchase.numeroProcesso || '',
      linkCompraPNCP:'https://pncp.gov.br/app/editais/' + path.replace('orgaos/', '').replace('/compras', ''),
      linkAtaPNCP:'https://pncp.gov.br/app/atas/' + path.replace('orgaos/', '').replace('/compras', '') + '/' + Number(row.numeroControlePNCPAta.split('-').pop()),
      fonteOficial:'pncp', dataAtualizacaoPncp:row.dataAtualizacaoGlobal
    };
  }

  async function supplement(payload, {cnpj, uasg, signal, fetcher = globalThis.fetch, now = new Date()}) {
    if (!/^\d{14}$/.test(cnpj) || !/^\d{6}$/.test(uasg)) throw new Error('Órgão ou UASG inválidos');
    const get = async path => {
      const response = await fetcher(BASE + path, {signal, cache:'no-cache'});
      if (response.status === 204) return null;
      if (!response.ok) throw new Error(`PNCP indisponível (${response.status})`);
      return response.json();
    };
    const records = new Map(payload.items.filter(r => r.numeroControlePncpAta).map(r => [r.numeroControlePncpAta, r]));
    const purchases = new Map();
    payload.items.forEach(r => {
      if (r.numeroControlePncpAta && r.numeroCompra)
        purchases.set(r.numeroControlePncpAta.replace(/-\d+$/, ''), r);
    });
    for (let page = 1; page <= 200; page++) {
      const query = new URLSearchParams({cnpj, codigoUnidadeAdministrativa:uasg,
        dataInicial:now.getFullYear() + '0101', dataFinal:now.getFullYear() + '1231',
        pagina:String(page), tamanhoPagina:'500'});
      const data = await get('atas?' + query);
      if (data === null) break;
      if (!Array.isArray(data.data) || !Number.isInteger(data.totalPaginas) || data.totalPaginas < 0 || data.totalPaginas > 200)
        throw new Error('Resposta inesperada do PNCP');
      for (const row of data.data) {
        if (row.cnpjOrgao !== cnpj || String(row.codigoUnidadeOrgao) !== uasg ||
            !String(row.numeroControlePNCPAta || '').startsWith(row.numeroControlePNCPCompra + '-'))
          throw new Error('Ata de outro órgão ou unidade no PNCP');
        const path = purchasePath(row.numeroControlePNCPCompra);
        if (!purchases.has(row.numeroControlePNCPCompra)) {
          const purchase = await get(path);
          if (!purchase || purchase.numeroControlePNCP !== row.numeroControlePNCPCompra ||
              String(purchase.unidadeOrgao?.codigoUnidade) !== uasg || !purchase.numeroCompra)
            throw new Error('Compra PNCP não corresponde à ata');
          purchases.set(row.numeroControlePNCPCompra, purchase);
        }
        records.set(row.numeroControlePNCPAta, mapRecord(row, purchases.get(row.numeroControlePNCPCompra), records.get(row.numeroControlePNCPAta)));
      }
      if (page >= data.totalPaginas) break;
      if (!data.data.length) throw new Error('Página PNCP vazia antes do fim da consulta');
    }
    return {...payload, items:[...records.values(), ...payload.items.filter(r => !r.numeroControlePncpAta)],
      generatedAt:now.toISOString(), cached:false};
  }
  return {purchasePath, mapRecord, supplement};
});
