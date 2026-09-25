const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {mapPNCPRecord, nationalSearchUrl, situation, filterAtas} = require('../atas-logic');

test('política da página autoriza conexão com a busca do PNCP', () => {
  const page = readFileSync(join(__dirname, '..', 'atas.html'), 'utf8');
  assert.match(page, /connect-src[^"]*https:\/\/pncp\.gov\.br/);
});

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

test('filtros nacionais são enviados para a API, sem substituir o objeto', () => {
  const url = new URL(nationalSearchUrl({
    objeto:'mobiliário', status:'vigente', uf:'RJ', esfera:'F', poder:'E', orgao:'38114', adesao:'sim'
  }, 3, 20));
  assert.equal(url.searchParams.get('q'), 'mobiliário');
  assert.equal(url.searchParams.get('ufs'), 'RJ');
  assert.equal(url.searchParams.get('esferas'), 'F');
  assert.equal(url.searchParams.get('poderes'), 'E');
  assert.equal(url.searchParams.get('orgaos'), '38114');
  assert.equal(url.searchParams.get('permite_adesao'), 'true');
  assert.equal(url.searchParams.get('pagina'), '3');
  assert.equal(new URL(nationalSearchUrl({...Object.fromEntries(url.searchParams), adesao:'nao'}, 1, 20)).searchParams.get('permite_adesao'), 'false');
});

test('resultado nacional preserva objeto, órgão, vigência, compra e endereço da ata', () => {
  const item = mapPNCPRecord({
    title:'Ata nº 90053-001/2025', description:'Aquisição de computador',
    unidade_codigo:'102108', unidade_nome:'Campus X', orgao_nome:'Universidade X',
    data_inicio_vigencia:'2025-10-13', data_fim_vigencia:'2026-10-13',
    data_assinatura:'2025-10-12', numero_sequencial_compra_ata:'190',
    ano:'2025', numero_controle_pncp:'id', cancelado:false, permite_adesao:true,
    item_url:'/atas/12200168000120/2025/190/2'
  });
  assert.equal(item.numeroAtaRegistroPreco, '90053-001/2025');
  assert.equal(item.nomeOrgao, 'Universidade X');
  assert.equal(item.numeroCompra, '190');
  assert.equal(item.possibilidadeAdesao, true);
  assert.equal(item.linkAtaPNCP, 'https://pncp.gov.br/app/atas/12200168000120/2025/190/2');
  assert.equal(situation(item, '2026-09-24'), 'vigente');
  assert.equal(filterAtas([item], {objeto:'computador', status:'vigente', numero:'90053', ano:'2025', compra:'190/2025'}, '2026-09-24').length, 1);
  assert.equal(mapPNCPRecord({...item, item_url:'https://example.com/malicious'}).linkAtaPNCP, '');
});
