'use strict';
/* ════════════════════════════════════════════════════════════════════════
   painel-logic.js — lógica pura do Painel de Contratações (sem DOM).

   Extraída do painel-core.js para ser testável em Node (npm test), no mesmo
   molde do appsel-firestore.js do app de gestão: o navegador consome via
   window.PainelLogic e a suíte de testes via require(). Qualquer mudança de
   regra de filtro/KPI/chip deve ser feita AQUI (e coberta em tests/).
   ════════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node (testes)
  else root.PainelLogic = api;                                               // navegador
})(typeof self !== 'undefined' ? self : this, function () {

  function escHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Modalidade / subtipo da Contratação Direta ──────────────────────────
  // Normaliza o subtipo da CD para um rótulo amigável, na mesma nomenclatura
  // do app de gestão (art. 74/75 da Lei 14.133/2021).
  function subtipoCDLabel(tipoCD) {
    var t = String(tipoCD || '').toLowerCase();
    if (!t) return '';
    if (t.indexOf('ades') >= 0)        return 'Adesão (carona)';
    if (t.indexOf('com disputa') >= 0) return 'Dispensa c/ disputa';
    if (t.indexOf('sem disputa') >= 0) return 'Dispensa s/ disputa';
    if (t.indexOf('inexig') >= 0)      return 'Inexigibilidade';
    if (t.indexOf('dispensa') >= 0)    return 'Dispensa';
    return String(tipoCD); // valor livre não previsto — mostra como veio
  }

  // Chip HTML de modalidade (mesma convenção de cor das barras do Gantt:
  // dourado = CD, azul = PE, verde = CC). Para CD, acrescenta o subtipo.
  // Modalidade desconhecida → '' (nada é renderizado).
  function modalidadeChip(mod, tipoCD) {
    var m = String(mod || '').toUpperCase();
    var info = m === 'CD' ? { txt: 'Contratação Direta', cor: '201,162,42' }
             : m === 'CC' ? { txt: 'Concorrência',        cor: '45,80,22'   }
             : m === 'PE' ? { txt: 'Pregão Eletrônico',   cor: '30,78,140'  }
             : null;
    if (!info) return '';
    var sub = m === 'CD' ? subtipoCDLabel(tipoCD) : '';
    var texto = info.txt + (sub ? ' · ' + sub : '');
    return '<span class="tt-mod" style="background:rgba(' + info.cor + ',.15);' +
           'border:1px solid rgba(' + info.cor + ',.55);color:var(--text);' +
           'font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;' +
           'display:inline-block;letter-spacing:.2px">' + escHtml(texto) + '</span>';
  }

  // ── Filtro de processos (busca + status + ano + modalidade) ─────────────
  // opts: { q, status, ano, anoBase, modal, mobile }
  //   q      → texto da busca (case-insensitive, casa em num+nome)
  //   status → '' (Todos) | 'andamento' | 'atrasado' | 'planejamento' | outro
  //   ano    → '' ou 'YYYY' (casa por sobreposição com os índices de mês)
  //   modal  → '' | 'PE' | 'CD' | 'CC' (legenda; desktop-only)
  //   mobile → true ignora `modal`: a legenda fica oculta no mobile, que tem
  //            filtro próprio — sem isso o filtro persistido vazaria invisível.
  function filtrarProcessos(data, opts) {
    opts = opts || {};
    var q = String(opts.q || '').toLowerCase();
    var status = opts.status || '';
    var anoBase = opts.anoBase || 2026;
    var modal = opts.mobile ? '' : String(opts.modal || '').toUpperCase();
    return (data || []).filter(function (p) {
      var matchQ = !q || ((p.num || '') + ' ' + (p.nome || '')).toLowerCase().indexOf(q) >= 0;
      var matchS;
      if (!status) {
        // "Todos" = andamento + atrasados + concluídos; exclui a fila
        matchS = p.status !== 'planejamento' && p.status !== 'fila';
      } else if (status === 'andamento') {
        matchS = p.status === 'andamento' || p.status === 'aguardando' || p.status === 'paralisado'
              || (p.status === 'atrasado' && p.execucao < 100);
      } else if (status === 'atrasado') {
        matchS = p.status === 'atrasado' && p.execucao < 100;
      } else if (status === 'planejamento') {
        matchS = p.status === 'planejamento' || p.status === 'fila';
      } else {
        matchS = p.status === status;
      }
      var matchA = true;
      if (opts.ano) {
        var anoInt = parseInt(opts.ano, 10);
        var anoStart = (anoInt - anoBase) * 12;
        var anoEnd = anoStart + 11;
        matchA = (p.inicio <= anoEnd && p.fim >= anoStart);
      }
      var matchMod = !modal || String(p.modalidade || '').toUpperCase() === modal;
      return matchQ && matchS && matchA && matchMod;
    });
  }

  // Ordenação da lista: atrasados em curso no topo; concluídos sempre no fim.
  function ordemStatus(p) {
    if (p.execucao === 100 || p.status === 'ok') return 6;
    if (p.status === 'atrasado')     return 0;
    if (p.status === 'aguardando')   return 1;
    if (p.status === 'paralisado')   return 2;
    if (p.status === 'andamento')    return 3;
    if (p.status === 'planejamento') return 4;
    return 5;
  }
  function ordenarProcessos(lista) {
    return (lista || []).slice().sort(function (a, b) { return ordemStatus(a) - ordemStatus(b); });
  }

  // ── KPIs ────────────────────────────────────────────────────────────────
  // Conta por status no array filtrado. "Em fila" tem base própria: quando não
  // há filtro de status, `filtered` não inclui a fila, então a base é `data`
  // — mas ainda respeitando o filtro de modalidade da legenda (desktop-only).
  // Retorna números crus; a formatação ('——') fica na camada de UI.
  function calcularKPIs(filtered, data, opts) {
    opts = opts || {};
    var modal = opts.mobile ? '' : String(opts.modal || '').toUpperCase();
    var concluidos = filtered.filter(function (p) { return p.status === 'ok' || p.execucao === 100; });
    var atrasadosAtivos = filtered.filter(function (p) { return p.status === 'atrasado' && p.execucao < 100; });
    var emAndamento = filtered.filter(function (p) {
      return p.status === 'andamento' || p.status === 'aguardando' || p.status === 'paralisado'
          || (p.status === 'atrasado' && p.execucao < 100);
    });
    var tot = concluidos.length + atrasadosAtivos.length +
      filtered.filter(function (p) { return p.status === 'andamento' || p.status === 'aguardando' || p.status === 'paralisado'; }).length;
    var basePlan = opts.status
      ? filtered
      : (data || []).filter(function (p) { return !modal || String(p.modalidade || '').toUpperCase() === modal; });
    var fila = basePlan.filter(function (p) { return p.status === 'planejamento' || p.status === 'fila'; }).length;
    return { tot: tot, andamento: emAndamento.length, atrasados: atrasadosAtivos.length, fila: fila, concluidos: concluidos.length };
  }

  return {
    escHtml: escHtml,
    subtipoCDLabel: subtipoCDLabel,
    modalidadeChip: modalidadeChip,
    filtrarProcessos: filtrarProcessos,
    ordemStatus: ordemStatus,
    ordenarProcessos: ordenarProcessos,
    calcularKPIs: calcularKPIs
  };
});
