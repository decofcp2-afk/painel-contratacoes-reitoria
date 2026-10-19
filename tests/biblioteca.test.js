const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../biblioteca.js'), 'utf8');

function element() {
  return { value: '', textContent: '', children: [], addEventListener() {},
    append(...items) { this.children.push(...items); }, replaceChildren() { this.children = []; } };
}
const doc = id => ({ id, titulo: id, categoria: 'nota', url: 'https://example.org/' + id });
async function run(remote) {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const calls = [];
  vm.runInNewContext(source, {
    document: { getElementById: get, createElement: element },
    window: { PAINEL_CONFIG: { ntApiUrl: 'https://script.google.com/test' } },
    AbortController, setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, options) => {
      if (url === 'documentos.json') return { ok: true, json: async () => [doc('portaria')] };
      if (url === 'biblioteca-publica.json') return { ok: true, json: async () => ({ documentos: [doc('nota-antiga')] }) };
      calls.push(options);
      return { ok: true, json: async () => remote(calls.length) };
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  return { status: get('library-status').textContent, rows: get('document-list').children, calls };
}
test('biblioteca mantém documentos públicos quando o Google falha nas duas tentativas', async () => {
  const result = await run(() => { throw new Error('Falha de conexão'); });
  assert.equal(result.rows.length, 2);
  assert.match(result.status, /última cópia pública/);
  assert.equal(result.calls.length, 2);
  assert(result.calls.every(c => c.credentials === 'omit'));
});
test('biblioteca recupera a consulta e substitui documentos antigos da cópia pública', async () => {
  const result = await run(attempt => {
    if (attempt === 1) throw new Error('Falha temporária');
    return { ok: true, documentos: [doc('nota-nova'), doc('outra-nota')] };
  });
  assert.equal(result.rows.length, 3);
  assert.equal(result.status, '3 documento(s) encontrado(s).');
  assert.equal(result.calls.length, 2);
});
test('uma resposta inválida não apaga a cópia pública', async () => {
  const result = await run(() => ({ ok: false }));
  assert.equal(result.rows.length, 2);
  assert.match(result.status, /última cópia pública/);
});
