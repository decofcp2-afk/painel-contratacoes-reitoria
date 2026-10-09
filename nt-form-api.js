(function(root) {
  'use strict';
  function create(apiUrl, fetcher) {
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(apiUrl || '')) {
      throw new Error('O recebimento de solicitações está em configuração.');
    }
    async function request(route, data) {
      var controller = new AbortController();
      var timeout = setTimeout(function(){controller.abort();}, 120000);
      try {
        var options = {credentials:'omit',redirect:'follow',signal:controller.signal};
        if (data !== undefined) {
          options.method = 'POST';
          // Um POST simples não exige preflight, que o Apps Script não atende.
          options.headers = {'Content-Type':'text/plain;charset=UTF-8'};
          options.body = JSON.stringify(data);
        }
        var response = await fetcher(apiUrl + '?route=' + route, options);
        if (!response.ok) throw new Error('Serviço indisponível. Tente novamente em alguns instantes.');
        var result;
        try { result = await response.json(); }
        catch (err) { throw new Error('Não foi possível confirmar a resposta do serviço. Tente novamente.'); }
        if (!result || typeof result.ok !== 'boolean') throw new Error('Resposta inválida do serviço. Tente novamente.');
        return result;
      } finally { clearTimeout(timeout); }
    }
    return {
      prepare:function(){return request('nt.preparar');},
      submit:function(data){return request('nt.enviar',data);}
    };
  }
  if (typeof module === 'object' && module.exports) module.exports = {create:create};
  else root.NTFormAPI = {create:create};
})(typeof window !== 'undefined' ? window : this);
