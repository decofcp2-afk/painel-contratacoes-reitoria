'use strict';
(function(){
  var documentos=[],query=document.getElementById('document-search'),categoria=document.getElementById('document-category'),list=document.getElementById('document-list'),status=document.getElementById('library-status');
  function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
  function el(tag,text,cls){var e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;}
  function render(){list.replaceChildren();var q=norm(query.value),cat=categoria.value;var filtrados=documentos.filter(function(d){return (!cat||cat===d.categoria)&&norm([d.titulo,d.numero,d.assunto].join(' ')).includes(q);});filtrados.forEach(function(d){if(!/^https:\/\//.test(d.url))return;var row=el('article',null,'library-row'),body=el('div'),meta=el('div',(d.categoria==='nota'?'Nota técnica':'Portaria')+(d.numero?' · '+d.numero:'')+(d.data?' · '+d.data.split('-').reverse().join('/') :''),'library-meta');body.append(meta,el('h2',d.titulo),el('p',d.assunto));var link=el('a','Abrir documento ↗','portal-button secondary');link.href=d.url;link.target='_blank';link.rel='noopener noreferrer';row.append(body,link);list.append(row);});status.textContent=filtrados.length?filtrados.length+' documento(s) encontrado(s).':(cat==='nota'&&!q?'As notas técnicas publicadas pela administração aparecerão aqui. Você também pode solicitar uma análise pelo botão acima.':'Nenhum documento encontrado. Ajuste a pesquisa ou a categoria.');}
  query.addEventListener('input',render);categoria.addEventListener('change',render);
  function integrar(novos){var ids=new Map(documentos.map(function(d){return [d.id,d];}));(novos||[]).forEach(function(d){ids.set(d.id,d);});documentos=Array.from(ids.values());render();}
  fetch('documentos.json',{cache:'no-cache'}).then(function(r){if(!r.ok)throw new Error();return r.json();}).then(function(d){integrar(d);}).catch(function(){status.textContent='Não foi possível carregar os documentos locais. Atualize a página para tentar novamente.';});
  var api=window.PAINEL_CONFIG&&window.PAINEL_CONFIG.ntApiUrl;if(!api)return;
  var cb='__bibliotecaNT',script=document.createElement('script'),timeout=setTimeout(function(){cleanup();status.textContent+=' A consulta de novos documentos está indisponível no momento.';},15000);
  function cleanup(){clearTimeout(timeout);script.remove();delete window[cb];}
  window[cb]=function(r){cleanup();if(r&&r.ok)integrar(r.documentos);else status.textContent+=' Não foi possível consultar novos documentos.';};
  script.src=api+'?route=nt.biblioteca&callback='+cb;script.referrerPolicy='no-referrer';script.onerror=function(){cleanup();status.textContent+=' A consulta de novos documentos está indisponível no momento.';};document.head.append(script);
})();
