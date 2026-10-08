const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ataYear, situation, adhesionPermission, filterAtas} = require('../atas-logic.js');

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

test('campo principal encontra número da ata ou da compra, com e sem zeros à esquerda', () => {
  const records = [
    ata({numeroAtaRegistroPreco:'01312/2026', numeroCompra:312, anoCompra:2026, objeto:'Serviços de Vigilância'}),
    ata({numeroAtaRegistroPreco:'02312/2026', numeroCompra:312, anoCompra:2026, objeto:'Serviços de Vigilância'}),
    ata({numeroAtaRegistroPreco:'01123/2026', numeroCompra:90011, anoCompra:2026, objeto:'Material esportivo'}),
    ata({numeroAtaRegistroPreco:'01312/2025', numeroCompra:312, anoCompra:2025, objeto:'Serviços de Vigilância'})
  ];
  const search = objeto => filterAtas(records, {objeto, status:'todos'}, '2026-09-23').map(a => a.numeroAtaRegistroPreco);
  for (const query of ['01312/2026', '1312/2026', '01312 / 2026'])
    assert.deepEqual(search(query), ['01312/2026']);
  for (const query of ['00312/2026', '312/2026', '00312 / 2026'])
    assert.deepEqual(search(query), ['01312/2026', '02312/2026']);
  for (const query of ['90011', '90011/2026', '01123/2026', '1123/2026'])
    assert.deepEqual(search(query), ['01123/2026']);
  assert.deepEqual(search('00312/2024'), []);
});

test('campo principal combina palavras e números e mantém os demais filtros', () => {
  const records = [ata({numeroAtaRegistroPreco:'00012/2025'}), ata({numeroAtaRegistroPreco:'13/2025', possibilidadeAdesao:true})];
  const filters = {objeto:'ESCOLAR 090011/2024 aquisicao', status:'vigente'};
  assert.equal(filterAtas(records, filters, '2026-09-23').length, 2);
  assert.deepEqual(filterAtas(records, {...filters, numero:'12/2025'}, '2026-09-23').map(a => a.numeroAtaRegistroPreco), ['00012/2025']);
  assert.equal(filterAtas(records, {...filters, compra:'90011/2023'}, '2026-09-23').length, 0);
  assert.equal(filterAtas(records, {...filters, ano:'2024'}, '2026-09-23').length, 0);
  assert.equal(filterAtas(records, {...filters, status:'nao-vigente'}, '2026-09-23').length, 0);
  assert.equal(filterAtas(records, {...filters, adesao:'sim'}, '2026-09-23').length, 1);
  assert.equal(filterAtas(records, {...filters, objeto:'escolar 99/2025'}, '2026-09-23').length, 0);
});

test('campo principal continua encontrando números escritos no objeto', () => {
  assert.equal(filterAtas([ata({objeto:'Aquisição de 100 cadeiras'})], {objeto:'100 cadeiras', status:'todos'}, '2026-09-23').length, 1);
  assert.equal(filterAtas([ata({objeto:'Material de limpeza / manutenção'})], {objeto:'limpeza / manutenção', status:'todos'}, '2026-09-23').length, 1);
});

test('Todos inclui situação não confirmada; status específicos excluem', () => {
  const records = [ata(), ata({numeroAtaRegistroPreco:'13/2025', dataVigenciaFinal:''})];
  const f = {objeto:'', numero:'', ano:'', compra:'', status:'todos'};
  assert.equal(filterAtas(records, f, '2026-09-23').length, 2);
  assert.equal(filterAtas(records, {...f, status:'vigente'}, '2026-09-23').length, 1);
  assert.equal(filterAtas(records, {...f, status:'nao-vigente'}, '2026-09-23').length, 0);
});

test('objetos com diferença de espaços e acentos ficam próximos na ordenação', () => {
  const records = [ata({objeto:'Zeladoria'}), ata({objeto:'Aquisição   de\nMobiliário'}), ata({objeto:'aquisicao de mobiliario'})];
  const f = {objeto:'', numero:'', ano:'', compra:'', status:'todos'};
  assert.deepEqual(filterAtas(records, f, '2026-09-23').map(a => a.objeto),
    ['Aquisição   de\nMobiliário', 'aquisicao de mobiliario', 'Zeladoria']);
});

test('filtro de adesão diferencia sim, não e dado ausente sem presumir permissão', () => {
  const records = [
    ata({numeroAtaRegistroPreco:'1/2025', possibilidadeAdesao:true}),
    ata({numeroAtaRegistroPreco:'2/2025', possibilidadeAdesao:false}),
    ata({numeroAtaRegistroPreco:'3/2025'})
  ];
  const f = {objeto:'', numero:'', ano:'', compra:'', status:'todos'};
  assert.equal(adhesionPermission(records[0]), true);
  assert.equal(adhesionPermission(records[1]), false);
  assert.equal(adhesionPermission(records[2]), null);
  assert.deepEqual(filterAtas(records, {...f, adesao:'sim'}, '2026-09-23').map(r => r.numeroAtaRegistroPreco), ['1/2025']);
  assert.deepEqual(filterAtas(records, {...f, adesao:'nao'}, '2026-09-23').map(r => r.numeroAtaRegistroPreco), ['2/2025']);
  assert.equal(filterAtas(records, {...f, adesao:'todos'}, '2026-09-23').length, 3);
});
