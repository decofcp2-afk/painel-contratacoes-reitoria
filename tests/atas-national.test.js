const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mapPNCPRecord, nationalSearchUrl, situation, filterAtas} = require('../atas-logic');

test('consulta nacional envia objeto, situação e página ao PNCP', () => {
  const url = new URL(nationalSearchUrl({objeto:'computador', status:'nao-vigente'}, 2, 20));
  assert.equal(url.origin, 'https://pncp.gov.br');
  assert.equal(url.pathname, '/api/search/');
  assert.equal(url.searchParams.get('q'), 'computador');
  assert.equal(url.searchParams.get('status'), 'nao_vigente');
  assert.equal(url.searchParams.get('pagina'), '2');
  assert.equal(url.searchParams.get('tam_pagina'), '20');
  assert.equal(url.searchParams.get('tipos_documento'), 'ata');
});

test('resultado nacional preserva objeto, órgão, vigência, compra e endereço da ata', () => {
  const item = mapPNCPRecord({
    title:'Ata nº 90053-001/2025', description:'Aquisição de computador',
    unidade_codigo:'102108', unidade_nome:'Campus X', orgao_nome:'Universidade X',
    data_inicio_vigencia:'2025-10-13', data_fim_vigencia:'2026-10-13',
    data_assinatura:'2025-10-12', numero_sequencial_compra_ata:'190',
    ano:'2025', numero_controle_pncp:'id', cancelado:false,
    item_url:'/atas/12200168000120/2025/190/2'
  });
  assert.equal(item.numeroAtaRegistroPreco, '90053-001/2025');
  assert.equal(item.nomeOrgao, 'Universidade X');
  assert.equal(item.numeroCompra, '190');
  assert.equal(item.linkAtaPNCP, 'https://pncp.gov.br/app/atas/12200168000120/2025/190/2');
  assert.equal(situation(item, '2026-09-24'), 'vigente');
  assert.equal(filterAtas([item], {objeto:'computador', status:'vigente', numero:'90053', ano:'2025', compra:'190/2025'}, '2026-09-24').length, 1);
  assert.equal(mapPNCPRecord({...item, item_url:'https://example.com/malicious'}).linkAtaPNCP, '');
});
