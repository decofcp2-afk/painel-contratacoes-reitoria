/* ════════════════════════════════════════════════════════════════════════
 * data-gateway.js — Fase 1 do PLANO_SEGURANCA.md (Camada de Acesso a Dados)
 *
 * Único módulo autorizado a falar com o backend. Extraído do index.html sem
 * mudar comportamento: concentra o transporte ao Apps Script (fetch + fallback
 * JSONP, timeout, erro padronizado) e o despacho de LEITURA (Firestore-first,
 * com fallback ao Apps Script).
 *
 * O painel é SOMENTE LEITURA: não há escrita nem token de sessão, então não
 * existe `api.write` aqui (ver PLANO_SEGURANCA.md, Fase 1).
 *
 * Interface pública:
 *   PainelGateway.lerDados(forcarAtualizacao) -> Promise  (cronograma/Gantt)
 *   PainelGateway.lerCapacidade()             -> Promise  (capacidade do setor)
 * Aliases globais `obterDadosPainel_`/`obterCapacidade_` mantidos por compat.
 * ════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  // ── Transporte (privado) ────────────────────────────────────────────────
  function getApiConfig_() {
    var cfg = root.PAINEL_CONFIG || {};
    var apiUrl = String(cfg.apiUrl || '').trim();
    if (!apiUrl) {
      throw new Error('Configure a URL do Apps Script no arquivo config.js.');
    }
    return { apiUrl: apiUrl };
  }

  function montarUrlApiPainel_(apiUrl, route, params, callbackName) {
    var query = [
      'route=' + encodeURIComponent(route),
      '_=' + Date.now()
    ];

    if (callbackName) {
      query.splice(1, 0, 'callback=' + encodeURIComponent(callbackName));
    }

    Object.keys(params || {}).forEach(function(key) {
      var val = params[key];
      if (val !== undefined && val !== null && val !== '') {
        query.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(val)));
      }
    });

    var sep = apiUrl.indexOf('?') >= 0 ? '&' : '?';
    return apiUrl + sep + query.join('&');
  }

  function chamarApiPainelJsonp_(route, params) {
    return new Promise(function(resolve, reject) {
      var cfg;
      try {
        cfg = getApiConfig_();
      } catch(e) {
        reject(e);
        return;
      }

      var callbackName = '__painelCallback_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      var script = document.createElement('script');
      var timer;

      function cleanup() {
        clearTimeout(timer);
        try { delete root[callbackName]; } catch(e) { root[callbackName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      root[callbackName] = function(payload) {
        cleanup();
        resolve(payload || {});
      };

      script.onerror = function() {
        cleanup();
        reject(new Error('Nao foi possivel carregar os dados do Apps Script.'));
      };

      timer = setTimeout(function() {
        cleanup();
        reject(new Error('Tempo esgotado ao consultar o Apps Script.'));
      }, 30000);

      script.src = montarUrlApiPainel_(cfg.apiUrl, route, params, callbackName);
      document.head.appendChild(script);
    });
  }

  function chamarApiPainel_(route, params) {
    var cfg;
    try {
      cfg = getApiConfig_();
    } catch(e) {
      return Promise.reject(e);
    }

    if (!root.fetch) {
      return chamarApiPainelJsonp_(route, params);
    }

    return root.fetch(montarUrlApiPainel_(cfg.apiUrl, route, params), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow'
    })
      .then(function(resp) {
        if (!resp.ok) {
          throw new Error('Apps Script respondeu HTTP ' + resp.status + '.');
        }
        return resp.text();
      })
      .then(function(txt) {
        try {
          return JSON.parse(txt);
        } catch(e) {
          throw new Error('A resposta do Apps Script nao veio em JSON valido.');
        }
      })
      .catch(function(err) {
        if (root.console && console.warn) {
          console.warn('Fetch do Apps Script falhou; usando JSONP.', err);
        }
        return chamarApiPainelJsonp_(route, params);
      });
  }

  // ── Leitura (público): Firestore, SEM fallback ao Apps Script ───────────
  // Pós-corte da migração, a rota antiga do Apps Script lê a PLANILHA da
  // Reitoria, congelada na migração: cair para ela mostrava dados antigos (e,
  // para as demais unidades, dados da unidade errada) sem nenhum aviso. Em
  // falha do Firestore, o erro é propagado para a UI tratar. As rotas do Apps
  // Script permanecem apenas para o modo firestoreAtivo=false (legado).
  function obterDadosPainel_(forcarAtualizacao) {
    var temFirestore = root.PainelFirestore
      && root.PAINEL_CONFIG && root.PAINEL_CONFIG.firestoreAtivo
      && root.PAINEL_CONFIG.firebase
      && root.firebase;
    if (temFirestore) {
      return root.PainelFirestore.carregar();
    }
    return chamarApiPainel_('painel.dados', { refresh: forcarAtualizacao ? '1' : '' });
  }

  function obterCapacidade_() {
    // Cálculo POR UNIDADE direto do Firestore (a rota antiga do Apps Script
    // exibiria o valor da Reitoria para todas as unidades).
    var temFirestore = root.PainelFirestore
      && root.PainelFirestore.carregarCapacidade
      && root.PAINEL_CONFIG && root.PAINEL_CONFIG.firestoreAtivo
      && root.PAINEL_CONFIG.firebase
      && root.firebase;
    if (temFirestore) {
      return root.PainelFirestore.carregarCapacidade();
    }
    return chamarApiPainel_('painel.capacidade');
  }

  // ── Exposição ────────────────────────────────────────────────────────────
  root.PainelGateway = {
    lerDados: obterDadosPainel_,
    lerCapacidade: obterCapacidade_,
    chamarApi: chamarApiPainel_
  };
  // Compat: o index.html ainda chama estes nomes globais diretamente.
  root.obterDadosPainel_ = obterDadosPainel_;
  root.obterCapacidade_ = obterCapacidade_;
})(typeof window !== 'undefined' ? window : globalThis);
