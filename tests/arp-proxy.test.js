const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');

function proxy() {
  const calls = [];
  const context = {
    UrlFetchApp:{fetch(url) {
      calls.push(new URL(url));
      return {getResponseCode:() => 200, getContentText:() => JSON.stringify({resultado:[],totalPaginas:0,totalRegistros:0})};
    }},
    ContentService:{MimeType:{JAVASCRIPT:'js',JSON:'json'},createTextOutput(body) {
      return {body,setMimeType(type) {this.type = type; return this;}};
    }}
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(join(__dirname, '..', 'arp-api', 'Code.gs'), 'utf8'), context);
  return {context,calls};
}

test('proxy consulta itens por CNPJ e período restrito na API oficial', () => {
  const {context,calls} = proxy();
  const response = context.doGet({parameter:{route:'arp.proxy',endpoint:'itens',niFornecedor:'12345678000190',
    dataVigenciaInicialMin:'2026-01-01',dataVigenciaInicialMax:'2026-12-31',callback:'cb'}});
  assert.match(response.body, /^cb\(\{"ok":true/);
  assert.equal(calls[0].hostname, 'dadosabertos.compras.gov.br');
  assert.equal(calls[0].pathname, '/modulo-arp/2_consultarARPItem');
  assert.equal(calls[0].searchParams.get('niFornecedor'), '12345678000190');
});

test('proxy bloqueia rota, CNPJ e paginação inválidos antes de consultar', () => {
  const {context,calls} = proxy();
  for (const params of [
    {route:'other'},
    {route:'arp.proxy',endpoint:'itens',niFornecedor:'abc',dataVigenciaInicialMin:'2026-01-01',dataVigenciaInicialMax:'2026-12-31'},
    {route:'arp.proxy',endpoint:'saldo',numeroAta:'00001/2026',unidadeGerenciadora:'153167',numeroItem:'1',pagina:'999'}
  ]) assert.match(context.doGet({parameter:params}).body, /"ok":false/);
  assert.equal(calls.length, 0);
});

test('proxy consulta saldo apenas para ata, UASG e item válidos', () => {
  const {context,calls} = proxy();
  const response = context.doGet({parameter:{route:'arp.proxy',endpoint:'saldo',numeroAta:'00024/2025',
    unidadeGerenciadora:'153167',numeroItem:'00051'}});
  assert.match(response.body, /"ok":true/);
  assert.equal(calls[0].pathname, '/modulo-arp/3_consultarUnidadesItem');
  assert.equal(calls[0].searchParams.get('numeroAta'), '00024/2025');
});
