const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ataYear, situation, filterAtas} = require('../atas-logic.js');

const ata = (overrides = {}) => ({
  numeroAtaRegistroPreco:'12/2025', numeroCompra:'90011', anoCompra:'2024',
  objeto:'Aquisição de Mobiliário Escolar',
  dataVigenciaInicial:'2025-09-23T00:00:00Z',
  dataVigenciaFinal:'2026-09-23T23:59:59Z', statusAta:'ativa',
  ...overrides,
});

test('vigência usa limites inclusivos e exclusões sempre prevalecem', () => {
  assert.equal(situation(ata(), '2025-09-23'), 'vigente');
  assert.equal(situation(ata(), '2026-09-23'), 'vigente');
  assert.equal(situation(ata(), '2026-09-24'), 'nao-vigente');
  assert.equal(situation(ata({ataExcluido:1}), '2026-09-23'), 'nao-vigente');
  assert.equal(situation(ata({statusAta:'Encerrada'}), '2026-09-23'), 'nao-vigente');
  assert.equal(situation(ata({dataVigenciaFinal:null}), '2026-09-23'), 'indefinida');
});

test('busca de objeto ignora acentos, caixa e ordem; ano da compra não vira ano da ata', () => {
  const f = {objeto:'escolar aquisicao', numero:'12/', ano:'2025', compra:'90011/2024', status:'vigente'};
  assert.deepEqual(filterAtas([ata(), ata({numeroAtaRegistroPreco:'13/2025'})], f, '2026-09-23').map(a => a.numeroAtaRegistroPreco), ['12/2025']);
  assert.equal(ataYear(ata()), '2025');
  assert.equal(ataYear(ata({numeroAtaRegistroPreco:'12', dataAssinatura:'2025-05-01'})), '2025');
});

test('Todos inclui situação não confirmada; status específicos excluem', () => {
  const records = [ata(), ata({numeroAtaRegistroPreco:'13/2025', dataVigenciaFinal:''})];
  const f = {objeto:'', numero:'', ano:'', compra:'', status:'todos'};
  assert.equal(filterAtas(records, f, '2026-09-23').length, 2);
  assert.equal(filterAtas(records, {...f, status:'vigente'}, '2026-09-23').length, 1);
  assert.equal(filterAtas(records, {...f, status:'nao-vigente'}, '2026-09-23').length, 0);
});
