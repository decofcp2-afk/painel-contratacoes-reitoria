const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');

test('consulta de ARP usa seu serviço próprio sem alterar a API do painel', async () => {
  const requests = [];
  const root = {
    PAINEL_CONFIG:{apiUrl:'https://example.org/painel',arpApiUrl:'https://example.org/arp'},
    fetch:async url => {
      requests.push(new URL(url));
      return {ok:true,text:async () => '{"ok":true}'};
    }
  };
  const document = {
    createElement:() => ({parentNode:{removeChild(){}}}),
    head:{appendChild(script) {
      const url = new URL(script.src);
      requests.push(url);
      queueMicrotask(() => root[url.searchParams.get('callback')]({ok:true}));
    }}
  };
  const context = vm.createContext({window:root, document, setTimeout, clearTimeout});
  vm.runInContext(readFileSync(join(__dirname, '..', 'data-gateway.js'), 'utf8'), context);
  await root.PainelGateway.chamarApi('arp.proxy', {endpoint:'itens'});
  await root.PainelGateway.chamarApi('painel.dados', {});
  assert.equal(requests[0].pathname, '/arp');
  assert.equal(requests[0].searchParams.get('route'), 'arp.proxy');
  assert.ok(requests[0].searchParams.get('callback'));
  assert.equal(requests[1].pathname, '/painel');
});
