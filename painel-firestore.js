/* ════════════════════════════════════════════════════════════════════════
 * painel-firestore.js — Fase 3 (leitura direta do Firestore)
 *
 * Reproduz no navegador a transformação que o Apps Script fazia em getDados()
 * (route=painel.dados), lendo as coleções `processos` e `etapas` do Firestore
 * em vez de chamar o Apps Script. A SAÍDA é idêntica em forma à de painel.dados,
 * então o render() do index.html não muda.
 *
 * MODO_CONTAGEM_PRAZOS = 'corridos' (igual ao Code.gs): a contagem de dias é de
 * calendário, sem feriados — por isso a coleção `calendario` não é necessária aqui.
 *
 * A capacidade (KPI) continua vindo do Apps Script por enquanto.
 * ════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var ANO_BASE = 2026;
  var MOS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  // ── Datas ──────────────────────────────────────────────────────────────
  // Aceita: Date, Firestore Timestamp (.toDate()) ou string ISO.
  // Normaliza para uma data local à meia-noite usando os componentes UTC,
  // evitando o shift de fuso (mesma correção do parseDateValue do Code.gs).
  function parseTs(v) {
    if (!v) return null;
    var d = null;
    if (v instanceof Date) d = v;
    else if (typeof v.toDate === 'function') d = v.toDate();  // Firestore Timestamp
    else { d = new Date(String(v)); }
    if (!d || isNaN(d.getTime())) return null;
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  function dateToMonthIdx(d) {
    if (!d || isNaN(d.getTime())) return null;
    return (d.getFullYear() - ANO_BASE) * 12 + d.getMonth();
  }

  function absToLabel(idx) {
    if (idx === null || idx === undefined) return '—';
    var y = ANO_BASE + Math.floor(idx / 12);
    return MOS[((idx % 12) + 12) % 12] + '/' + y;
  }

  function isoLocal(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // corridos: soma dias de calendário
  function adicionarDias(dataBase, qtdDias) {
    var dc = new Date(dataBase.getTime());
    if (qtdDias > 0) dc.setDate(dc.getDate() + qtdDias);
    return dc;
  }

  // corridos: diferença em dias de calendário (b - a)
  function contarDias(dataA, dataB) {
    var a = new Date(dataA.getTime()); a.setHours(0, 0, 0, 0);
    var b = new Date(dataB.getTime()); b.setHours(0, 0, 0, 0);
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }

  function normalizeStatus(s) {
    if (!s) return 'planejamento';
    var lower = String(s).toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
    var map = {
      'em andamento': 'andamento',
      'concluida': 'ok',
      'nao iniciada': 'planejamento',
      'nao se aplica': 'naoaplica',
      'planejamento': 'planejamento',
      'em planejamento': 'planejamento',
      'pendente': 'pendente',
      'aguardando requisitante': 'aguardando',
      'paralisado': 'paralisado',
      'suspenso': 'paralisado',
      'atrasado': 'atrasado'
    };
    if (lower.indexOf('conclu') >= 0) return 'ok';
    if (lower.indexOf('andament') >= 0) return 'andamento';
    if (lower.indexOf('aguard') >= 0) return 'aguardando';
    if (lower.indexOf('paralis') >= 0 || lower.indexOf('suspens') >= 0) return 'paralisado';
    if (lower.indexOf('atras') >= 0) return 'atrasado';
    return map[lower] || 'planejamento';
  }

  function modalAbrev(m) {
    var n = String(m || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (/prego|pregao/.test(n)) return 'PE';
    if (/direta|dispensa|inexig/.test(n)) return 'CD';
    if (/concorr/.test(n)) return 'CC';
    return 'PE';
  }

  // ── Transformação principal (espelha getDados do Code.gs) ───────────────
  // processosRaw / etapasRaw: documentos crus do Firestore (campos da migração).
  function construirProcessos(processosRaw, etapasRaw) {
    var etapasPorProc = {};
    (etapasRaw || []).forEach(function (e) {
      var pid = String(e.processoId || '').trim();
      if (!pid) return;
      (etapasPorProc[pid] = etapasPorProc[pid] || []).push(e);
    });
    Object.keys(etapasPorProc).forEach(function (pid) {
      etapasPorProc[pid].sort(function (a, b) {
        return Number(a.ordem || 0) - Number(b.ordem || 0);
      });
    });

    var filaCursor = new Date();
    filaCursor.setHours(0, 0, 0, 0);
    filaCursor = new Date(filaCursor.getFullYear(), filaCursor.getMonth() + 1, 1);

    var resultado = (processosRaw || []).map(function (p) {
      var pid = String(p.id || p._id || '').trim();
      var suapNum = String(p.suap || '').trim();
      var modal = String(p.modalidade || '').trim();
      var linkSuap = String(p.linkSuap || '#').trim();
      var temIRP = (p.temIrp === true || String(p.temIrp).trim() === 'Sim');

      var d0 = parseTs(p.d0);
      var d0Simulado = false;
      if (!d0) { d0 = new Date(filaCursor.getTime()); d0Simulado = true; }

      var etps = etapasPorProc[pid] || [];
      if (!etps.length) return null;

      var etpsFiltradas = etps.filter(function (e) {
        var nomeEtapa = String(e.etapa || '').toLowerCase().trim();
        if (nomeEtapa.indexOf('assinatura') >= 0 || nomeEtapa.indexOf('arp') >= 0) return false;
        if (normalizeStatus(String(e.status || '').trim()) === 'naoaplica') return false;
        return true;
      });

      var cursor = new Date(d0.getTime());

      var etapasCalc = etpsFiltradas.map(function (e) {
        var nome = String(e.etapa || '').trim();
        var base = parseInt(e.prazoDias, 10) || 0;
        var motivo = String(e.motivoAtraso || '').trim();
        var status = normalizeStatus(String(e.status || '').trim());
        var agente = String(e.agente || '').trim();
        var fase = String(e.fase || '').trim();
        var dataRealizacao = (status === 'ok' && e.dataRealizacao) ? parseTs(e.dataRealizacao) : null;

        var ini = new Date(cursor.getTime());
        var naoAplica = status === 'naoaplica';
        var fimSemAtraso = adicionarDias(new Date(ini.getTime()), naoAplica ? 0 : base);

        var atraso = 0;
        if (dataRealizacao && base > 0) {
          atraso = contarDias(fimSemAtraso, dataRealizacao);
          if (atraso < 0) atraso = 0;
        }

        if (dataRealizacao && base > 0) {
          cursor = new Date(dataRealizacao.getTime());
        } else if (!naoAplica) {
          cursor = adicionarDias(new Date(cursor.getTime()), base + atraso);
        }
        var fim = new Date(cursor.getTime());

        var prazoIni = dateToMonthIdx(ini);
        var prazoFimBase = dateToMonthIdx(fimSemAtraso);
        var prazoFim = dateToMonthIdx(fim);
        var realFim = atraso > 0 ? prazoFim : prazoFimBase;

        return {
          nome: nome, agente: agente, fase: fase, status: status,
          prazo_ini: prazoIni, prazo_fim: prazoFimBase,
          real_ini: prazoIni, real_fim: realFim,
          dias: atraso, motivo: motivo,
          realizacao_iso: dataRealizacao ? isoLocal(dataRealizacao) : null,
          ini_iso: isoLocal(ini),
          fim_iso: isoLocal(fimSemAtraso),
          fim_real_iso: isoLocal(fim)
        };
      });

      var todosIni = etapasCalc.map(function (e) { return e.prazo_ini; }).filter(function (x) { return x !== null; });
      var todosFim = etapasCalc.map(function (e) { return e.real_fim !== null ? e.real_fim : e.prazo_fim; }).filter(function (x) { return x !== null; });
      var inicio = todosIni.length ? Math.min.apply(null, todosIni) : 0;
      var fim2 = todosFim.length ? Math.max.apply(null, todosFim) : 0;

      var concluidas = etapasCalc.filter(function (e) { return e.status === 'ok'; }).length;
      var execucao = etapasCalc.length ? Math.round((concluidas / etapasCalc.length) * 100) : 0;

      var temAtrasada = etapasCalc.some(function (e) { return e.dias > 0; });
      var temAndamento = etapasCalc.some(function (e) { return e.status === 'andamento'; });
      var temAguardando = etapasCalc.some(function (e) { return e.status === 'aguardando'; });
      var temParalisado = etapasCalc.some(function (e) { return e.status === 'paralisado'; });
      var statusBase = normalizeStatus(String(p.status || '').trim());
      // Devolvido à fila: etapa com status 'retornado' OU motivo "retorno para fila:".
      // O status da etapa é preservado (ex.: "Em andamento"), então o sinal confiável
      // é o motivo. Retornados não contam como andamento — viram status 'fila'.
      var temRetorno = etps.some(function (e) {
        var st = String(e.status || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        var mt = String(e.motivoAtraso || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
        return (st.indexOf('retorn') >= 0 && st.indexOf('fila') >= 0) || mt.indexOf('retorno para fila:') === 0;
      });
      var statusGeral;
      if (temRetorno) statusGeral = 'fila';
      else if (d0Simulado) statusGeral = 'planejamento';
      else if (temAtrasada) statusGeral = 'atrasado';
      else if (temAguardando) statusGeral = 'aguardando';
      else if (temParalisado) statusGeral = 'paralisado';
      else if (temAndamento) statusGeral = 'andamento';
      else if (execucao === 100) statusGeral = 'ok';
      else if (statusBase === 'planejamento') statusGeral = 'planejamento';
      else statusGeral = statusBase || 'planejamento';

      var motivos = etapasCalc
        .filter(function (e) { return e.status === 'ok' && e.dias > 0 && e.motivo; })
        .map(function (e) { return e.motivo; });
      var motivoProc = motivos.length ? motivos[motivos.length - 1] : '';

      var procIniIso = etapasCalc.length ? etapasCalc[0].ini_iso : null;
      var procFimIso = etapasCalc.length ? etapasCalc[etapasCalc.length - 1].fim_real_iso : null;

      return {
        id: pid, num: suapNum || pid, pid: pid,
        nome: String(p.objeto || pid).trim(),
        status: statusGeral,
        inicio: inicio, fim: fim2,
        ini_iso: procIniIso, fim_iso: procFimIso,
        d0_simulado: d0Simulado,
        execucao: execucao,
        previsao: absToLabel(fim2),
        suap: linkSuap || '#',
        motivo: motivoProc,
        modalidade: modalAbrev(modal),
        temIRP: temIRP,
        etapas: etapasCalc
      };
    }).filter(function (p) { return p !== null && p.etapas.length > 0; });

    return { processos: resultado, geradoEm: new Date().toISOString() };
  }

  // Unidade alvo: ?u= na URL (índice público) ou config; default reitoria-sel.
  function _unidadeId() {
    try {
      var u = new URLSearchParams(root.location.search).get('u');
      if (u) return u.trim();
    } catch (e) {}
    return (root.PAINEL_CONFIG && root.PAINEL_CONFIG.unidadeId) || 'reitoria-sel';
  }

  // ── Leitura do Firestore (navegador, SDK compat) ────────────────────────
  function carregar() {
    var cfg = (root.PAINEL_CONFIG && root.PAINEL_CONFIG.firebase) || null;
    if (!cfg || !root.firebase) {
      return Promise.reject(new Error('Firebase nao configurado.'));
    }
    if (!root.firebase.apps || !root.firebase.apps.length) {
      root.firebase.initializeApp(cfg);
    }
    var db = root.firebase.firestore();
    var base = db.collection('unidades').doc(_unidadeId());
    return Promise.all([
      base.collection('processos').get(),
      base.collection('etapas').get()
    ]).then(function (snaps) {
      var procs = snaps[0].docs.map(function (d) { var o = d.data(); o._id = d.id; return o; });
      var etps = snaps[1].docs.map(function (d) { var o = d.data(); o._id = d.id; return o; });
      return construirProcessos(procs, etps);
    });
  }

  // ── Visão Geral do Diretor: KPIs consolidados de TODAS as unidades ───────
  // Lê a coleção `unidades` e, para cada uma, computa os KPIs no cliente
  // reaproveitando construirProcessos (mesma lógica do painel, inclui 'fila').
  // (Futuro: ler de unidades/{u}/resumo/atual via collectionGroup p/ custo fixo.)
  function carregarVisaoGeral() {
    var cfg = (root.PAINEL_CONFIG && root.PAINEL_CONFIG.firebase) || null;
    if (!cfg || !root.firebase) return Promise.reject(new Error('Firebase nao configurado.'));
    if (!root.firebase.apps || !root.firebase.apps.length) root.firebase.initializeApp(cfg);
    var db = root.firebase.firestore();
    return db.collection('unidades').get().then(function (unids) {
      var tarefas = unids.docs.map(function (ud) {
        var u = ud.data(); u._id = ud.id;
        var base = db.collection('unidades').doc(ud.id);
        return Promise.all([
          base.collection('processos').get(),
          base.collection('etapas').get()
        ]).then(function (s) {
          var procs = s[0].docs.map(function (d) { var o = d.data(); o._id = d.id; return o; });
          var etps = s[1].docs.map(function (d) { var o = d.data(); o._id = d.id; return o; });
          var ps = construirProcessos(procs, etps).processos;
          function conta(fn) { return ps.filter(fn).length; }
          var concl = conta(function (p) { return p.status === 'ok' || p.execucao === 100; });
          var atras = conta(function (p) { return p.status === 'atrasado' && p.execucao < 100; });
          var fila = conta(function (p) { return p.status === 'fila' || p.status === 'planejamento'; });
          var andam = conta(function (p) { return (p.status === 'andamento' || p.status === 'aguardando' || p.status === 'paralisado' || (p.status === 'atrasado' && p.execucao < 100)); });
          var execM = ps.length ? Math.round(ps.reduce(function (a, p) { return a + (p.execucao || 0); }, 0) / ps.length) : 0;
          return {
            id: ud.id, nome: u.nome || ud.id, sigla: u.sigla || '', ativo: u.ativo !== false,
            totalProcessos: ps.length, andamento: andam, atrasados: atras,
            fila: fila, concluidos: concl, execucaoMedia: execM
          };
        }).catch(function () {
          return { id: ud.id, nome: u.nome || ud.id, sigla: u.sigla || '', ativo: u.ativo !== false,
            totalProcessos: 0, andamento: 0, atrasados: 0, fila: 0, concluidos: 0, execucaoMedia: 0, erro: true };
        });
      });
      return Promise.all(tarefas);
    });
  }

  root.PainelFirestore = {
    construirProcessos: construirProcessos,
    carregarVisaoGeral: carregarVisaoGeral,
    carregar: carregar
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.PainelFirestore;
  }
})(typeof window !== 'undefined' ? window : globalThis);
