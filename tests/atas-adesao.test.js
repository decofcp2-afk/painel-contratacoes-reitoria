const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {context, normalizeItem, percentage, availability, withDeadline, listItems, getBalance, getApprovals, proxyFetch} = require('../atas-adesao');

const ata = {
  numeroAtaRegistroPreco:'00107/2026', codigoUnidadeGerenciadora:'153167',
  numeroCompra:'90007', dataVigenciaInicial:'2026-05-19',
  numeroControlePncpAta:'pncp-1'
};

test('saldo de adesão é calculado por item, inclusive saldo zero', () => {
  assert.equal(percentage({saldoAdesao:75, qtdLimiteAdesao:150}), 50);
  assert.equal(percentage({saldoAdesao:0, qtdLimiteAdesao:100}), 0);
  assert.equal(percentage({saldoAdesao:null, qtdLimiteAdesao:100}), null);
  assert.equal(percentage({saldoAdesao:2, qtdLimiteAdesao:0}), null);
  assert.equal(context({...ata, codigoUnidadeGerenciadora:'12345678901234'}), null);
});

test('número digitado conserva os zeros do identificador oficial do item', () => {
  assert.equal(normalizeItem('4', ['00004']), '00004');
  assert.equal(normalizeItem('4'), '00004');
  assert.equal(normalizeItem('004', ['004']), '004');
  assert.equal(normalizeItem('x'), 'x');
});

test('consulta que não responde termina com prazo e cancela a requisição', async () => {
  let cancelled = false;
  await assert.rejects(
    withDeadline(signal => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { cancelled = true; reject(new Error('cancelled')); });
    }), 15),
    /cancelled|Tempo limite/
  );
  assert.equal(cancelled, true);
});

test('descoberta dos itens filtra outra ata, UASG e registros excluídos', async () => {
  let request;
  const fetcher = async url => {
    request = new URL(url);
    return {ok:true, json:async () => ({resultado:[
      {numeroAtaRegistroPreco:'00107/2026', codigoUnidadeGerenciadora:153167,
        numeroControlePncpAta:'pncp-1', numeroItem:'1', descricaoItem:'Livro'},
      {numeroAtaRegistroPreco:'00107/2026', codigoUnidadeGerenciadora:153167,
        numeroControlePncpAta:'pncp-1', numeroItem:'1', descricaoItem:'Livro'},
      {numeroAtaRegistroPreco:'00108/2026', codigoUnidadeGerenciadora:153167, numeroItem:'2'},
      {numeroAtaRegistroPreco:'00107/2026', codigoUnidadeGerenciadora:153167, numeroItem:'3', itemExcluido:true}
    ], totalPaginas:1})};
  };
  const items = await listItems(ata, fetcher);
  assert.deepEqual(items, [{numeroItem:'1', descricao:'Livro', codigoItem:'',
    valorUnitario:null, quantidadeHomologadaVencedor:null, maximoAdesao:null}]);
  assert.equal(request.pathname, '/modulo-arp/2_consultarARPItem');
  assert.equal(request.searchParams.get('numeroCompra'), '90007');
  assert.equal(request.searchParams.get('dataVigenciaInicialMin'), '2026-05-19');
  await listItems({...ata, origemConsulta:'pncp'}, fetcher);
  assert.equal(request.searchParams.has('numeroCompra'), false, 'sequencial do PNCP não é número da compra');
});

test('saldo é retornado sem agregar fornecedores e só da ata e item pedidos', async () => {
  const fetcher = async url => {
    const q = new URL(url);
    assert.equal(q.pathname, '/modulo-arp/3_consultarUnidadesItem');
    assert.equal(q.searchParams.get('numeroItem'), '1');
    return {ok:true, json:async () => ({resultado:[
      {numeroAta:'00107/2026', unidadeGerenciadora:'153167', numeroItem:'1',
        descricaoItem:'Livro', fornecedor:'Editora A', saldoAdesao:30, qtdLimiteAdesao:60, unidade:'153167'},
      {numeroAta:'00107/2026', unidadeGerenciadora:'153167', numeroItem:'1',
        descricaoItem:'Livro', fornecedor:'Editora B', saldoAdesao:0, qtdLimiteAdesao:100, unidade:'153167'},
      {numeroAta:'00107/2026', unidadeGerenciadora:'153167', numeroItem:'2',
        saldoAdesao:10, qtdLimiteAdesao:100}
    ], totalPaginas:1})};
  };
  const rows = await getBalance(ata, '1', fetcher);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.percentual), [50,0]);
  assert.deepEqual(rows.map(row => row.fornecedor), ['Editora A','Editora B']);
});

test('API atual usa saldoAdesoes e repete o saldo nas unidades sem somá-lo', async () => {
  const fetcher = async () => ({ok:true, json:async () => ({resultado:[
    {numeroAta:'00107/2026', unidadeGerenciadora:'153167', numeroItem:'00001',
      fornecedor:'12345678000190 - Fornecedor A', saldoAdesoes:40, qtdLimiteAdesao:100,
      qtdLimiteInformadoCompra:120, codigoPdm:'10361', quantidadeRegistrada:25,
      codigoUnidade:'153167', tipoUnidade:'GERENCIADORA', aceitaAdesao:true},
    {numeroAta:'00107/2026', unidadeGerenciadora:'153167', numeroItem:'00001',
      fornecedor:'12345678000190 - Fornecedor A', saldoAdesoes:40, qtdLimiteAdesao:100,
      codigoUnidade:'155636', tipoUnidade:'PARTICIPANTE', aceitaAdesao:true}
  ], totalPaginas:1})});
  const rows = await getBalance(ata, '00001', fetcher);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].saldo, 40);
  assert.equal(rows[0].percentual, 40);
  assert.equal(rows[0].unidades, 2);
  assert.equal(rows[0].tipoUnidade, 'GERENCIADORA');
  assert.equal(rows[0].registrado, 25);
  assert.equal(rows[0].limiteCompra, 120);
  assert.equal(rows[0].codigoItem, '10361');
});

test('adesões aprovadas são somadas por item sem misturar outra ata', async () => {
  const fetcher = async url => {
    const q = new URL(url);
    assert.equal(q.pathname, '/modulo-arp/5_consultarAdesoesItem');
    assert.equal(q.searchParams.get('numeroItem'), '00001');
    return {ok:true, json:async () => ({resultado:[
      {numeroAta:'00107/2026',unidadeGerenciadora:'153167',unidadeNaoParticipante:'123456',quantidadeAprovadaAdesao:4},
      {numeroAta:'00107/2026',unidadeGerenciadora:'153167',unidadeNaoParticipante:'123456',quantidadeAprovadaAdesao:6},
      {numeroAta:'00108/2026',unidadeGerenciadora:'153167',unidadeNaoParticipante:'999999',quantidadeAprovadaAdesao:100}
    ], totalPaginas:1})};
  };
  const approvals = await getApprovals(ata, '00001', fetcher);
  assert.equal(approvals.total, 10);
  assert.equal(approvals.byUnit.get('123456'), 10);
});

test('tag da ata só informa ausência de saldo após conferir todos os itens', () => {
  assert.equal(availability({balances:[], checked:0, total:2}), 'pending');
  assert.equal(availability({balances:[{saldo:0, aceitaAdesao:true}], checked:1, total:2}), 'pending');
  assert.equal(availability({balances:[{saldo:0, aceitaAdesao:true}], checked:2, total:2}), 'unavailable');
  assert.equal(availability({balances:[{saldo:10, aceitaAdesao:false}], checked:1, total:1}), 'unavailable');
  assert.equal(availability({balances:[{saldo:10, aceitaAdesao:true}], checked:1, total:2}), 'available');
  assert.equal(availability({balances:[], checked:2, total:2, failed:1}), 'unknown');
  assert.equal(availability({balances:[{saldo:0, aceitaAdesao:true}], checked:2, total:2, missing:1}), 'unknown');
});

test('consulta no proxy aceita apenas endpoints oficiais de ARP', async () => {
  const calls = [];
  const gateway = {chamarApi:async (...args) => {
    calls.push(args);
    return {ok:true, resultado:[], totalPaginas:0};
  }};
  const response = await proxyFetch('https://dadosabertos.compras.gov.br/modulo-arp/3_consultarUnidadesItem?numeroAta=00107%2F2026&unidadeGerenciadora=153167&numeroItem=00001', {}, gateway);
  assert.equal((await response.json()).totalPaginas, 0);
  assert.equal(calls[0][1].endpoint, 'saldo');
  await proxyFetch('https://dadosabertos.compras.gov.br/modulo-arp/5_consultarAdesoesItem?numeroAta=00107%2F2026&unidadeGerenciadora=153167&numeroItem=00001', {}, gateway);
  assert.equal(calls[1][1].endpoint, 'adesoes');
  await assert.rejects(proxyFetch('https://example.com/modulo-arp/3_consultarUnidadesItem', {}, gateway), /Fonte/);
});

test('página oferece saldo por ata sem o filtro separado por fornecedor', () => {
  const html = readFileSync(join(__dirname, '..', 'atas.html'), 'utf8');
  assert.match(html, /script src="atas-adesao.js(?:\?[^\"]+)?"/);
  assert.match(html, /connect-src[^"]*https:\/\/dadosabertos\.compras\.gov\.br/);
  assert.doesNotMatch(html, /id="arp-form"|id="arp-cnpj"/);
});
