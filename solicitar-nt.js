(function(){
  'use strict';
  var nonce='',files=[],enviando=false,api;
  var $=function(id){return document.getElementById(id);};
  function mensagem(texto,tipo){$('status').textContent=texto;$('status').className='status '+(tipo||'');$('status').hidden=false;}
  async function preparar(preservarMensagem){
    $('tentar').hidden=true;$('enviar').disabled=true;
    try {
      api=api||NTFormAPI.create(window.PAINEL_CONFIG&&window.PAINEL_CONFIG.ntApiUrl,window.fetch.bind(window));
      var r=await api.prepare();
      if(!r.ok)throw new Error(r.erro||'Não foi possível preparar o formulário.');
      nonce=r.nonce;$('pedido').hidden=false;$('enviar').disabled=false;
      if(!preservarMensagem)$('status').hidden=true;
    }catch(e){mensagem(e.message||'Não foi possível carregar o formulário. Tente novamente.','error');$('tentar').hidden=false;}
  }
  function validarFiles(lista){if(lista.length>5)throw new Error('Selecione no máximo 5 arquivos.');var total=0;lista.forEach(function(f){if(['application/pdf','image/jpeg','image/png'].indexOf(f.type)<0)throw new Error('Use arquivos PDF, JPG ou PNG.');if(!f.size||f.size>5*1024*1024)throw new Error('Cada arquivo deve ter até 5 MB e não pode estar vazio.');total+=f.size;});if(total>10*1024*1024)throw new Error('Os arquivos juntos devem ter até 10 MB.');return total;}
  function renderFiles(){var ul=$('lista-arquivos');ul.replaceChildren();files.forEach(function(f,i){var li=document.createElement('li'),span=document.createElement('span'),b=document.createElement('button');span.textContent=f.name+' · '+(f.size/1024/1024).toFixed(2)+' MB';b.type='button';b.textContent='Remover';b.setAttribute('aria-label','Remover '+f.name);b.disabled=enviando;b.onclick=function(){files.splice(i,1);renderFiles();};li.append(span,b);ul.append(li);});$('total').textContent=files.length?files.length+' arquivo(s) · '+(files.reduce(function(n,f){return n+f.size;},0)/1024/1024).toFixed(2)+' de 10 MB':'Nenhum arquivo selecionado.';}
  $('arquivos').addEventListener('change',function(){try{var novos=files.concat(Array.from(this.files));validarFiles(novos);files=novos;renderFiles();$('status').hidden=true;}catch(e){mensagem(e.message,'error');}this.value='';});
  function ler(f){return new Promise(function(resolve,reject){var reader=new FileReader();reader.onload=function(){resolve({nome:f.name,tipo:f.type,base64:String(reader.result).split(',')[1]});};reader.onerror=function(){reject(new Error('Não foi possível ler '+f.name+'.'));};reader.readAsDataURL(f);});}
  function desbloquear(){enviando=false;Array.from($('pedido').elements).forEach(function(e){e.disabled=false;});$('enviar').textContent='Enviar solicitação';renderFiles();}
  $('pedido').addEventListener('submit',async function(event){
    event.preventDefault();if(enviando||!nonce||!this.reportValidity())return;
    try {
      validarFiles(files);
      var dados={nonce:nonce,nome:$('nome').value,email:$('email').value,unidade:$('unidade').value,assunto:$('assunto').value,descricao:$('descricao').value,site:$('site').value};
      enviando=true;Array.from(this.elements).forEach(function(e){e.disabled=true;});$('enviar').textContent='Enviando…';
      mensagem('Enviando sua solicitação. Aguarde a confirmação antes de fechar a página.');
      dados.arquivos=await Promise.all(files.map(ler));
      var r=await api.submit(dados);
      if(!r.ok){desbloquear();mensagem(r.erro||'Não foi possível enviar a solicitação.','error');await preparar(true);return;}
      $('pedido').hidden=true;files=[];
      mensagem('Solicitação recebida. Seu protocolo é '+r.protocolo+'. Guarde esse número para consultar o atendimento junto à DECOF.','success');
    }catch(e){
      desbloquear();
      // Conserva o nonce em falhas de conexão: o servidor recupera o mesmo
      // protocolo caso já tenha recebido o pedido, sem duplicar anexos/avisos.
      mensagem('Não foi possível confirmar o envio. '+(e.message||'Verifique a conexão.')+' Tente enviar novamente; o mesmo protocolo será recuperado se o pedido já foi recebido.','error');
    }
  });
  $('tentar').addEventListener('click',function(){mensagem('Preparando o formulário…');preparar();});
  preparar();
})();
