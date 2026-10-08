const {test} = require('node:test');
const assert = require('node:assert/strict');
const {supplement, resolvePurchases} = require('../atas-pncp');
const {filterAtas, mapPNCPRecord} = require('../atas-logic');

const purchaseID = '42414284000102-1-000168/2026';
const rows = ['01312','02312','03312'].map((n, i) => ({
  numeroAtaRegistroPreco:n, anoAta:2026, cnpjOrgao:'42414284000102', codigoUnidadeOrgao:'153167',
  numeroControlePNCPCompra:purchaseID, numeroControlePNCPAta:purchaseID + '-00000' + (i + 1),
  vigenciaInicio:'2026-10-08', vigenciaFim:'2027-10-08', objetoContratacao:'Vigilância armada e desarmada',possibilidadeAdesao:false
}));
const options = {cnpj:'42414284000102',uasg:'153167',now:new Date('2026-10-08T18:00:00Z')};

test('PNCP direto recupera atas recentes e resolve o número da compra sem usar o sequencial', async () => {
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    const data = url.includes('/atas?') ? {data:rows,totalPaginas:1} :
      {numeroControlePNCP:purchaseID,numeroCompra:'312',anoCompra:2026,unidadeOrgao:{codigoUnidade:'153167'}};
    return {ok:true,status:200,json:async () => data};
  };
  const result = await supplement({items:[]}, {...options,fetcher});
  assert.equal(result.items.length,3);
  assert.equal(calls.length,2,'uma consulta de compra atende às três atas');
  assert.match(calls[1], /\/compras\/2026\/168$/);
  assert.equal(result.items[0].numeroCompra,'312');
  assert.equal(result.items[0].numeroAtaRegistroPreco,'01312/2026');
  assert.equal(filterAtas(result.items,{status:'vigente',objeto:'vigilancia',compra:'00312/2026'},'2026-10-08').length,3);
});

test('PNCP prevalece para cancelamento sem duplicar registros ARP', async () => {
  const previous = {numeroControlePncpAta:rows[0].numeroControlePNCPAta,numeroCompra:'312',anoCompra:'2026',ataExcluido:false};
  const result = await supplement({items:[previous]}, {...options,fetcher:async () => ({ok:true,status:200,json:async () => ({data:[{...rows[0],cancelado:true}],totalPaginas:1})})});
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].ataExcluido,true);
  assert.equal(filterAtas(result.items,{status:'vigente'},'2026-10-08').length,0);
});

test('HTTP 204 preserva base anterior; erro ou UASG alheia não vira resultado vazio', async () => {
  const payload = {items:[{numeroAtaRegistroPreco:'legada'}]};
  const result = await supplement(payload,{...options,fetcher:async () => ({ok:true,status:204})});
  assert.deepEqual(result.items,payload.items);
  await assert.rejects(supplement(payload,{...options,fetcher:async () => ({ok:false,status:502})}),/PNCP indisponível/);
  await assert.rejects(supplement(payload,{...options,fetcher:async () => ({ok:true,status:200,json:async () => ({data:[{...rows[0],codigoUnidadeOrgao:'155625'}],totalPaginas:1})})}),/outro órgão ou unidade/);
});

const nationalRows = rows.map((row, i) => mapPNCPRecord({
  title:'Ata nº ' + row.numeroAtaRegistroPreco + '/2026', description:row.objetoContratacao,
  unidade_codigo:row.codigoUnidadeOrgao, ano:'2026',
  numero_sequencial_compra_ata:'168', numero_controle_pncp:row.numeroControlePNCPAta,
  item_url:'/atas/42414284000102/2026/168/' + (i + 1)
}));

test('busca nacional resolve o número oficial da compra uma vez para várias atas', async () => {
  const calls = [];
  const result = await resolvePurchases(nationalRows, {fetcher:async url => {
    calls.push(url);
    return {ok:true,json:async () => ({numeroControlePNCP:purchaseID,numeroCompra:'312',anoCompra:2026,
      unidadeOrgao:{codigoUnidade:'153167'}})};
  }});
  assert.equal(calls.length,1);
  assert.match(calls[0], /\/compras\/2026\/168$/);
  assert.deepEqual(result.map(r => r.numeroCompra), ['312','312','312']);
  assert.equal(filterAtas(result,{status:'todos',objeto:'00312/2026'},'2026-10-08').length,3);
  assert.equal(filterAtas(result,{status:'todos',objeto:'168/2026'},'2026-10-08').length,0);
});

test('falha ou compra de outra unidade não inventa número nem remove a ata nacional', async () => {
  const unavailable = await resolvePurchases(nationalRows,{fetcher:async () => ({ok:false,status:502})});
  assert.deepEqual(unavailable,nationalRows);
  assert.equal(unavailable[0].numeroCompra,'');
  assert.equal(unavailable[0].anoCompra,'');
  for (const purchase of [
    {numeroControlePNCP:purchaseID,numeroCompra:'312',anoCompra:2026,unidadeOrgao:{codigoUnidade:'155625'}},
    {numeroControlePNCP:'outro-id',numeroCompra:'312',anoCompra:2026,unidadeOrgao:{codigoUnidade:'153167'}}
  ]) {
    assert.deepEqual(await resolvePurchases(nationalRows,{fetcher:async () => ({ok:true,json:async () => purchase})}),nationalRows);
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(resolvePurchases(nationalRows,{signal:controller.signal}));
});
