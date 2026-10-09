'use strict';
// Mantém a unidade selecionada ao transitar entre as páginas públicas.
document.querySelectorAll('a[data-unidade]').forEach(function(a){var atual=new URL(location.href),u=atual.searchParams.get('u');if(u&&/^[a-z0-9-]+$/.test(u)){var dest=new URL(a.href);dest.searchParams.set('u',u);a.href=dest.href;}});
if(document.getElementById('request-frame')){
  var url=window.PAINEL_CONFIG&&window.PAINEL_CONFIG.ntApiUrl;
  if(url&&/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)){
    document.getElementById('request-frame').src=url+'?route=nt.form';
    document.getElementById('request-direct').href=url+'?route=nt.form';
  }else{document.getElementById('request-frame').hidden=true;document.getElementById('request-help').textContent='O recebimento de solicitações está em configuração.';}
}

window.addEventListener("message",function(e){if(!/^https:\/\/(?:script\.google\.com|[a-z0-9-]+\.googleusercontent\.com)$/.test(e.origin)||!e.data||e.data.type!=="cp2-nt-height")return;var frame=document.getElementById("request-frame"),height=Number(e.data.height);if(frame&&Number.isFinite(height)&&height>0)frame.style.height=Math.min(1800,Math.max(180,height))+"px";});
