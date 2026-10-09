'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../nt-form-api');
const url='https://script.google.com/macros/s/ABC123/exec';
test('preparação e envio omitem cookies de todas as contas Google e seguem redirecionamentos',async()=>{
  const calls=[];const api=create(url,async(u,o)=>{calls.push([u,o]);return {ok:true,json:async()=>({ok:true,nonce:'n'})};});
  await api.prepare();await api.submit({nonce:'n',arquivos:[{base64:'JVBERg=='}]});
  for(const [u,o] of calls){assert.equal(o.credentials,'omit');assert.equal(o.redirect,'follow');assert.ok(o.signal);}
  assert.match(calls[0][0],/route=nt.preparar$/);assert.equal(calls[0][1].method,undefined);
  assert.equal(calls[1][1].method,'POST');assert.equal(calls[1][1].headers['Content-Type'],'text/plain;charset=UTF-8');
  assert.equal(JSON.parse(calls[1][1].body).arquivos[0].base64,'JVBERg==');assert.ok(!calls[1][0].includes('JVBERg'));
});
test('erro HTTP, resposta HTML do Google e resposta inesperada não confirmam envio',async()=>{
  for(const response of [{ok:false},{ok:true,json:async()=>{throw new Error('HTML');}},{ok:true,json:async()=>({})}]){
    await assert.rejects(create(url,async()=>response).submit({nonce:'mesmo-nonce'}));
  }
});
test('falha de conexão não modifica o nonce usado para recuperar o protocolo no reenvio',async()=>{
  const calls=[];const dados={nonce:'mesmo-nonce'};
  const api=create(url,async(u,o)=>{calls.push(o.body);if(calls.length===1)throw new Error('offline');return {ok:true,json:async()=>({ok:true,protocolo:'NT-1'})};});
  await assert.rejects(api.submit(dados));assert.equal((await api.submit(dados)).protocolo,'NT-1');
  assert.equal(calls[0],calls[1]);assert.equal(dados.nonce,'mesmo-nonce');
  assert.throws(()=>create('https://example.org/exec',()=>{}),/configuração/);
});
