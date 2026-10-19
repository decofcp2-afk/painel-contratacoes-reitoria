'use strict';
(function(){
  var documentos=[],base=[],atualizando=true,aviso='',query=document.getElementById('document-search'),categoria=document.getElementById('document-category'),list=document.getElementById('document-list'),status=document.getElementById('library-status');
  function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
  function el(tag,text,cls){var e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;}
  function render(){list.replaceChildren();var q=norm(query.value),cat=categoria.value;var filtrados=documentos.filter(function(d){return (!cat||cat===d.categoria)&&norm([d.titulo,d.numero,d.assunto].join(' ')).includes(q);});filtrados.forEach(function(d){if(!/^https:\/\//.test(d.url))return;var row=el('article',null,'library-row'),body=el('div'),meta=el('div',(d.categoria==='nota'?'Nota técnica':'Portaria')+(d.numero?' · '+d.numero:'')+(d.data?' · '+d.data.split('-').reverse().join('/') :''),'library-meta');body.append(meta,el('h2',d.titulo),el('p',d.assunto));var link=el('a','Abrir documento ↗','portal-button secondary');link.href=d.url;link.target='_blank';link.rel='noopener noreferrer';row.append(body,link);list.append(row);});status.textContent=filtrados.length?filtrados.length+' documento(s) encontrado(s).':(cat==='nota'&&!q?'As notas técnicas publicadas pela administração aparecerão aqui. Você também pode solicitar uma análise pelo botão acima.':'Nenhum documento encontrado. Ajuste a pesquisa ou a categoria.');status.textContent+=atualizando?' Consultando atualizações…':aviso;}
  query.addEventListener('input',render);categoria.addEventListener('change',render);
  function integrar(novos){var ids=new Map(documentos.map(function(d){return [d.id,d];}));(novos||[]).forEach(function(d){ids.set(d.id,d);});documentos=Array.from(ids.values());render();}
  function ler(url,options){return fetch(url,options).then(function(r){if(!r.ok)throw new Error('Consulta indisponível');return r.json();});}
  function locais(){return Promise.all([
    ler('documentos.json',{cache:'no-cache'}).catch(function(){return [];}),
    ler('biblioteca-publica.json',{cache:'no-cache'}).catch(function(){return null;})
  ]).then(function(resultados){
    base=resultados[0];var copia=resultados[1];
    integrar(base.concat(copia&&Array.isArray(copia.documentos)?copia.documentos:[]));
    return copia;
  });}
  async function consultar(){
    var copia=await locais(),api=window.PAINEL_CONFIG&&window.PAINEL_CONFIG.ntApiUrl;
    if(api)for(var tentativa=0;tentativa<2;tentativa++){
      var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},30000);
      try{
        var resposta=await ler(api+'?route=nt.biblioteca',{credentials:'omit',redirect:'follow',cache:'no-store',signal:controller.signal});
        if(!resposta||resposta.ok!==true||!Array.isArray(resposta.documentos))throw new Error('Resposta inválida');
        documentos=[];atualizando=false;aviso='';integrar(base.concat(resposta.documentos));return;
      }catch(e){/* A cópia pública permanece visível durante uma nova tentativa. */}
      finally{clearTimeout(timer);}
    }
    atualizando=false;
    aviso=copia?' Exibindo a última cópia pública disponível. Não foi possível conferir atualizações agora.':' Não foi possível consultar a biblioteca completa agora. Tente novamente em alguns instantes.';
    render();
  }
  consultar();
})();
