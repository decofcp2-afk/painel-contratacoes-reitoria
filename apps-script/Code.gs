// ════════════════════════════════════════════════════════════════════════
// PAINEL GANTT DE CONTRATAÇÕES — Colégio Pedro II
// Arquivo: Codigo.gs  (servidor do Google Apps Script)
// Versão:  23/04/2026
//
// ── O QUE ESTE ARQUIVO FAZ ──────────────────────────────────────────────
// Este é o "back-end" do painel. Ele roda nos servidores do Google e tem
// duas responsabilidades:
//   1. Servir a página HTML do painel quando alguém acessa a URL pública
//   2. Ler os dados da planilha Google Sheets e devolvê-los ao painel
//      já processados (datas calculadas, status, % de execução etc.)
//
// ── COMO ADAPTAR PARA OUTRA UNIDADE ────────────────────────────────────
//   1. Crie uma cópia da planilha CronogramaContratacoes_CPII_v2.xlsx
//      e importe-a para o Google Sheets da nova unidade
//   2. Cole este Codigo.gs e o index.html em um novo projeto Apps Script
//      vinculado à planilha da nova unidade
//   3. Ajuste apenas os textos institucionais no index.html (nome da
//      unidade, endereço, ramais)
//   4. Publique como Web App (Implantar → Novo Web App)
//
// ── ESTRUTURA ESPERADA DA PLANILHA ─────────────────────────────────────
//   Aba "🏛 Processos":
//     Linha 1 → título decorativo (ignorada)
//     Linha 2 → aviso "somente leitura" (ignorada)
//     Linha 3 → cabeçalho real (deve conter "ProcessoID")
//     Linha 4+ → dados dos processos
//
//   Aba "🗓 Etapas":
//     Linha 1 → título decorativo (ignorada)
//     Linha 2 → cabeçalho real (deve conter "ProcessoID")
//     Linha 3+ → dados das etapas
//     Entre blocos de etapas há linhas separadoras (coluna B vazia)
// ════════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════════
// CONSTANTES GLOBAIS
// ════════════════════════════════════════════════════════════════════════
// ANO_BASE: ano de referência do índice de meses usado pelo Gantt.
// Jan/ANO_BASE = índice 0, Fev/ANO_BASE = 1, Jan/(ANO_BASE+1) = 12, ...
// Esta constante TAMBÉM existe no index.html (precisa ser atualizada nos
// dois lugares se um dia precisar mudar — ex: 2028 em diante).
var ANO_BASE = 2026;

// Painel público: este projeto deve servir apenas consulta.
// Toda alteração operacional deve acontecer pelo AppSEL.
var PAINEL_SOMENTE_LEITURA = true;
var PAINEL_WEBAPP_URL_FALLBACK = '';
var PAINEL_MUNICIPIO_CALENDARIO_FALLBACK = 'Rio de Janeiro';

function painelConfig_(chave, fallback) {
  try {
    var val = PropertiesService.getScriptProperties().getProperty(chave);
    return val !== null && val !== undefined && String(val).trim() !== '' ? val : fallback;
  } catch(e) {
    return fallback;
  }
}

function painelWebAppUrl_() {
  return painelConfig_('PAINEL_WEBAPP_URL', PAINEL_WEBAPP_URL_FALLBACK);
}

function painelBloquearEscrita_(acao) {
  var msg = 'Painel público somente para consulta. Ação bloqueada: ' + acao + '. Use o AppSEL para qualquer alteração.';
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) {}
  Logger.log('[READ_ONLY] ' + msg);
  return { ok: false, erro: msg };
}

// Servidores ativos usados na automacao de capacidade. IGOR fica fora por
// ter saido do setor; processos antigos que dependerem dele ficam para revisao.
var CAP_SERVIDORES_ATIVOS = ['AMANDA', 'BEATRIZ', 'BRUNO', 'SAMUEL'];
// Linha do cabecalho do REGISTRO de processos (nao do resumo por servidor).
// Na nova estrutura: linha 14 = cabecalho, linha 15 = aviso, linha 16+ = dados.
var CAP_HEADER_ROW_FALLBACK = 14;
var CAP_DATA_START_ROW_FALLBACK = 16;


// ════════════════════════════════════════════════════════════════════════
// PRAZOS DA PORTARIA 638/2026 — fonte única de verdade
//
// Centraliza todos os prazos legais em um só lugar. Se a portaria for
// revista, basta alterar os números aqui. ETAPAS_INTERNAS documenta os
// prazos dos blocos pré-formatados da aba Etapas (referência/validação);
// FASE_EXTERNA é usada diretamente por faseExternaDias().
// ════════════════════════════════════════════════════════════════════════
// ── Contagem de prazos ────────────────────────────────────────────────────
// 'corridos' = dias corridos puros: conta TODOS os dias (fins de semana e
//              feriados incluídos). Modo atual, definido pela gestão.
// 'uteis'    = dias úteis: pula sábados, domingos e feriados (fixos + aba
//              Calendario). Os feriados continuam definidos no código e
//              voltam a valer automaticamente se este modo for reativado.
var MODO_CONTAGEM_PRAZOS = 'corridos';

var PORTARIA_638 = {
  // Fase interna (dias — contagem conforme MODO_CONTAGEM_PRAZOS) — ordem das etapas
  ETAPAS_INTERNAS: {
    'Designação da equipe':                 5,
    'ETP + Mapa de Riscos + Pesquisa de Preços': 45,
    'Minuta do Termo de Referência':        10,
    'IRP — Intenção de Registro de Preços': 15,   // só quando Tem IRP? = Sim
    'Adequações finais dos documentos':     10,
    'Versão final do TR e demais documentos': 10,
    'Envio ao SEL/SEPMA':                    3
  },
  // Fase externa (dias — contagem conforme MODO_CONTAGEM_PRAZOS) por modalidade
  FASE_EXTERNA: {
    DIRETA:       30,   // Contratação Direta / Dispensa / Inexigibilidade
    PREGAO:       90,   // Pregão Eletrônico
    CONCORRENCIA: 100   // Concorrência
  }
};

// ════════════════════════════════════════════════════════════════════════
// MENU CUSTOMIZADO — aparece na barra da planilha ao abrir
//
// A função onOpen() é executada automaticamente toda vez que alguém abre
// a planilha. Ela cria o menu "📊 Painel SEL" com atalhos para as
// principais ações, evitando que a equipe precise abrir o editor de código.
// ════════════════════════════════════════════════════════════════════════

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('📊 Painel SEL')
    .addItem('🌐 Abrir Painel (consulta)', 'abrirPainel')
    .addItem('🔄 Atualizar cache do painel', 'atualizarDadosPainel')
    .addSeparator()
    .addItem('🔎 Validar integridade da planilha', 'validarPlanilha')
    .addToUi();
}


// ════════════════════════════════════════════════════════════════════════
// VALIDAR INTEGRIDADE — validarPlanilha()
//
// Varre as abas Processos / Etapas / Capacidade e lista, num único relatório,
// os problemas de dados que o sistema não exibe bem:
//   1. Etapas duplicadas (mesmo ProcessoID + mesma Ord.)
//   2. DataRealizacao anterior à abertura (D0) do processo → atraso negativo
//   3. Etapa "Concluída" sem DataRealizacao → painel não mostra "Realizado em"
//   4. Status fora de cascata (etapa concluída/em andamento após não-iniciada)
//   5. Coluna Ativo da Capacidade com "Nao"/"Sim" sem acento
// Apenas LÊ a planilha; não altera nada.
// ════════════════════════════════════════════════════════════════════════
function validarPlanilha() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var wsProc = null, wsEtap = null, wsCap = null;
    ss.getSheets().forEach(function(s) {
      var n = s.getName();
      if (/processo/i.test(n)) wsProc = s;
      if (/etapa/i.test(n))    wsEtap = s;
      if (/capacidade/i.test(n)) wsCap = s;
    });
    if (!wsProc || !wsEtap) { ui.alert('Abas "Processos" ou "Etapas" não encontradas.'); return; }

    // ── D0 por processo ──
    var dProc = wsProc.getDataRange().getValues();
    var hP = -1;
    for (var i = 0; i < dProc.length; i++) { if (dProc[i].join('|').indexOf('ProcessoID') >= 0) { hP = i; break; } }
    var colId = dProc[hP].indexOf('ProcessoID');
    var colD0 = dProc[hP].indexOf('D0 (Data Abertura)');
    var d0Map = {};
    for (var p = hP + 1; p < dProc.length; p++) {
      var pid = String(dProc[p][colId] || '').trim();
      if (pid) d0Map[pid] = parseDateValue(dProc[p][colD0]);
    }

    // ── Etapas ──
    var dEt = wsEtap.getDataRange().getValues();
    var hE = -1;
    for (var j = 0; j < dEt.length; j++) { if (dEt[j].join('|').indexOf('ProcessoID') >= 0) { hE = j; break; } }
    var cPid = dEt[hE].indexOf('ProcessoID');
    var cOrd = dEt[hE].indexOf('Ord.');
    var cEt  = dEt[hE].indexOf('Etapa');
    var cDR  = dEt[hE].indexOf('DataRealizacao◄ EDITAR');
    var cSt  = dEt[hE].indexOf('StatusEtapa ◄ EDITAR');

    var dups = [], drAntes = [], conclSemData = [], foraCascata = [];
    var vistos = {};       // pid+ord → primeira linha
    var porProc = {};      // pid → [{linha, ord, status}]
    for (var r = hE + 1; r < dEt.length; r++) {
      var row = dEt[r];
      var pid2 = String(row[cPid] || '').trim();
      if (!pid2 || pid2.indexOf('SEL') !== 0) continue;
      var ord = row[cOrd];
      if (ord === '' || ord === null) continue;
      var linha = r + 1;
      var st = normalizeStatus(String(row[cSt] || '').trim());
      var dr = cDR >= 0 ? parseDateValue(row[cDR]) : null;

      var chave = pid2 + '#' + ord;
      if (vistos[chave]) dups.push(pid2 + ' ord ' + ord + ' (linhas ' + vistos[chave] + ' e ' + linha + ')');
      else vistos[chave] = linha;

      var d0 = d0Map[pid2];
      if (dr && d0 && dr < d0) drAntes.push(pid2 + ' L' + linha + ' (' + _dmy_(dr) + ' < D0 ' + _dmy_(d0) + ')');
      if (st === 'ok' && !dr) conclSemData.push(pid2 + ' L' + linha + ' — ' + String(row[cEt] || '').substring(0, 28));

      if (!porProc[pid2]) porProc[pid2] = [];
      porProc[pid2].push({ linha: linha, ord: Number(ord) || 0, status: st });
    }

    // Status fora de cascata: etapa ok/andamento depois de uma não-iniciada
    Object.keys(porProc).forEach(function(pid3) {
      var es = porProc[pid3].sort(function(a, b) { return a.ord - b.ord; });
      var viuNaoIni = false;
      es.forEach(function(e) {
        if (e.status === 'pendente') viuNaoIni = true;
        else if ((e.status === 'ok' || e.status === 'andamento') && viuNaoIni) {
          foraCascata.push(pid3 + ' L' + e.linha + ' ord ' + e.ord + ' (' + e.status + ' após etapa não iniciada)');
        }
      });
    });

    // ── Capacidade: Ativo sem acento ──
    var ativoSemAcento = 0;
    if (wsCap) {
      var dC = wsCap.getDataRange().getValues();
      for (var c = 0; c < dC.length; c++) {
        for (var k = 0; k < dC[c].length; k++) {
          var v = String(dC[c][k] || '').trim();
          if (v === 'Nao') ativoSemAcento++;
        }
      }
    }

    // ── Monta relatório ──
    function bloco(titulo, arr) {
      if (!arr.length) return '✅ ' + titulo + ': nenhum\n';
      return '⚠️ ' + titulo + ' (' + arr.length + '):\n   • ' + arr.slice(0, 12).join('\n   • ') +
             (arr.length > 12 ? '\n   • … +' + (arr.length - 12) + ' outros' : '') + '\n';
    }
    var msg = '🔎 VALIDAÇÃO DE INTEGRIDADE\n\n'
      + bloco('Etapas duplicadas (ProcessoID + Ord.)', dups) + '\n'
      + bloco('DataRealizacao anterior ao D0', drAntes) + '\n'
      + bloco('Etapas "Concluída" sem DataRealizacao', conclSemData) + '\n'
      + bloco('Status fora de cascata', foraCascata) + '\n'
      + (ativoSemAcento ? '⚠️ Capacidade: ' + ativoSemAcento + ' célula(s) com "Nao" sem acento (cosmético).\n'
                        : '✅ Capacidade: coluna Ativo sem inconsistência de acento.\n');

    var totalProblemas = dups.length + drAntes.length + conclSemData.length + foraCascata.length + ativoSemAcento;
    msg += '\n' + (totalProblemas === 0 ? '🎉 Nenhum problema encontrado!' : 'Total de itens a revisar: ' + totalProblemas);
    ui.alert('Validação da planilha', msg, ui.ButtonSet.OK);

  } catch(e) {
    ui.alert('Erro na validação: ' + e.message);
  }
}

// Helper local: Date → DD/MM/AAAA (para o relatório de validação)
function _dmy_(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '—';
  var dd = ('0' + d.getDate()).slice(-2);
  var mm = ('0' + (d.getMonth() + 1)).slice(-2);
  return dd + '/' + mm + '/' + d.getFullYear();
}


// ════════════════════════════════════════════════════════════════════════
// FORMATAR COLUNA DE DATAS — formatarColunaDatas()
//
// Aplica o formato de exibição DD/MM/YYYY em toda a coluna
// "DataRealizacao◄ EDITAR" da aba Etapas.
//
// Por que isso é necessário:
//   O Google Sheets pode exibir datas no formato MM/DD/AAAA dependendo da
//   configuração regional da conta do usuário. Aplicar setNumberFormat()
//   força a exibição correta em DD/MM/YYYY para todos na planilha,
//   independentemente da localidade configurada.
//
// Chamada automaticamente por:
//   - onOpen()                    → ao abrir a planilha
//   - preencherDataRealizacaoHoje() → ao preencher datas em lote
// ════════════════════════════════════════════════════════════════════════
function formatarColunaDatas() {
  if (PAINEL_SOMENTE_LEITURA) return painelBloquearEscrita_('formatar coluna de datas');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wsEtapas = null;
  ss.getSheets().forEach(function(s) {
    var nome = s.getName().replace(/\s/g, '').toLowerCase();
    if (nome.indexOf('etapa') >= 0) wsEtapas = s;
  });
  if (!wsEtapas) return;

  var dados = wsEtapas.getDataRange().getValues();
  if (!dados.length) return;
  var header = dados[0].map(function(h) { return String(h).trim(); });
  var colDR  = header.indexOf('DataRealizacao◄ EDITAR');
  if (colDR < 0) return;

  var lastRow = wsEtapas.getLastRow();
  if (lastRow > 1) {
    // Aplica DD/MM/YYYY em toda a coluna (a partir da linha 2, pulando o cabeçalho)
    wsEtapas.getRange(2, colDR + 1, lastRow - 1, 1).setNumberFormat('DD/MM/YYYY');
  }
}

// Abre o painel (dashboard) em uma nova aba do navegador
function abrirPainel() {
  var url = painelWebAppUrl_();
  var html = HtmlService.createHtmlOutput(
    '<script>window.open("' + url + '", "_blank");google.script.host.close();</script>'
  ).setWidth(200).setHeight(50);
  SpreadsheetApp.getUi().showModalDialog(html, 'Abrindo painel...');
}

// Invalida o cache e confirma para o usuário
function atualizarDadosPainel() {
  invalidarCache();
  getDados();
  SpreadsheetApp.getUi().alert('Dados atualizados com sucesso!\n\nO painel já reflete as alterações mais recentes da planilha.');
}


// Ponto de entrada publico do backend do GitHub Pages.
// Rotas aceitas: painel.dados e painel.capacidade.
function doGet(e) {
  var params = (e && e.parameter) || {};
  var route = String(params.route || '').trim();

  if (!route) {
    return painelResponderJson_({
      ok: false,
      erro: 'Informe route=painel.dados ou route=painel.capacidade.'
    }, params);
  }

  try {
    if (params.refresh === '1') invalidarCache();

    if (route === 'painel.dados') {
      return painelResponderJson_(getDados(), params);
    }

    if (route === 'painel.capacidade') {
      return painelResponderJson_(getCapacidade(), params);
    }

    return painelResponderJson_({
      ok: false,
      erro: 'Rota nao encontrada: ' + route
    }, params);
  } catch(err) {
    return painelResponderJson_({
      ok: false,
      erro: 'Erro interno: ' + err.message
    }, params);
  }
}

function painelResponderJson_(payload, params) {
  params = params || {};
  var callback = String(params.callback || '').trim();
  var json = JSON.stringify(payload || {});

  if (callback) {
    if (!/^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(callback)) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, erro: 'Callback invalido.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}


// ════════════════════════════════════════════════════════════════════════
// FUNÇÃO PRINCIPAL — getDados()
//
// Chamada pelo painel via rota publica: route=painel.dados
// Lê a planilha, calcula todas as datas em cascata e devolve um objeto
// JSON com a lista de processos e suas etapas já prontos para exibição.
//
// Retorno em caso de sucesso:
//   { processos: [...], geradoEm: "2026-04-22T..." }
//
// Retorno em caso de erro:
//   { erro: "mensagem descritiva do problema" }
// ════════════════════════════════════════════════════════════════════════
function getDados() {
  try {
    // ── Cache: evita reler a planilha inteira a cada acesso ─────────────
    // O CacheService armazena o JSON por 120 segundos. Se múltiplos
    // usuários abrirem o painel ao mesmo tempo, apenas a primeira chamada
    // lê a planilha — as demais recebem o cache instantaneamente.
    // Para forçar atualização imediata, use invalidarCache().
    var cache = CacheService.getScriptCache();
    var cached = cache.get('dados_painel');
    if (cached) {
      try { return JSON.parse(cached); }
      catch(e) { /* cache corrompido — segue para leitura normal */ }
    }

    // Acessa a planilha vinculada ao projeto Apps Script
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // ── Localiza as abas pelo nome ──────────────────────────────────────
    // Usa expressão regular para encontrar mesmo que tenha emoji no nome
    // ex: "🏛 Processos" ou simplesmente "Processos" — ambos funcionam
    var wsProc = null, wsEtapas = null;
    ss.getSheets().forEach(function(s) {
      var n = s.getName();
      if (/processo/i.test(n))  wsProc   = s;   // aba de processos
      if (/etapa/i.test(n))     wsEtapas = s;   // aba de etapas
    });

    // Se não encontrar as abas, devolve erro descritivo
    if (!wsProc || !wsEtapas) {
      var abas = ss.getSheets().map(function(s){ return s.getName(); }).join(', ');
      return { erro: 'Abas não encontradas. Abas disponíveis: [' + abas + ']' };
    }

    // ── Lê e mapeia a aba de Processos ───────────────────────────────────
    // Lê todos os dados da aba de uma vez (mais eficiente que linha a linha)
    var dadosProc = wsProc.getDataRange().getValues();

    // Detecta dinamicamente a linha do cabeçalho real (contém "ProcessoID")
    // Isso garante que linhas decorativas (título, aviso) sejam ignoradas
    var hProcIdx = -1;
    for (var hi = 0; hi < dadosProc.length; hi++) {
      if (dadosProc[hi].join('|').indexOf('ProcessoID') >= 0) { hProcIdx = hi; break; }
    }
    if (hProcIdx < 0) return { erro: 'Cabeçalho "ProcessoID" não encontrado na aba de Processos.' };

    // Monta array com os nomes das colunas (ex: ['ProcessoID','N° SUAP','Objeto',...])
    var hProc = dadosProc[hProcIdx].map(function(h){ return String(h).trim(); });

    // Transforma cada linha em um objeto { coluna: valor }
    // ex: { ProcessoID: 'SEL-2026-001', 'N° SUAP': '23040.001/2026', ... }
    var processos = [];
    for (var i = hProcIdx + 1; i < dadosProc.length; i++) {
      var row = dadosProc[i];
      if (!row[0]) continue;   // ignora linhas completamente vazias
      var obj = {};
      hProc.forEach(function(h, idx){ obj[h] = row[idx]; });
      processos.push(obj);
    }

    // ── LOG DIAGNÓSTICO — ProcessoID + D0 de cada processo (remover após confirmar) ──
    processos.forEach(function(p) {
      var d0raw = p['D0 (Data Abertura)'];
      var tipo  = d0raw instanceof Date ? 'Date(UTC: ' + d0raw.toISOString() + ')' : typeof d0raw + '=' + d0raw;
      Logger.log('[DIAG] PID=' + p['ProcessoID'] + ' | Objeto=' + String(p['Objeto']).substring(0,30) + ' | Modal=' + p['Modalidade'] + ' | D0raw=' + tipo);
    });

    // ── Lê e mapeia a aba de Etapas ──────────────────────────────────────
    var dadosEtap = wsEtapas.getDataRange().getValues();

    // Detecta a linha do cabeçalho da aba de etapas (mesma lógica)
    var hEtapIdx = -1;
    for (var hj = 0; hj < dadosEtap.length; hj++) {
      if (dadosEtap[hj].join('|').indexOf('ProcessoID') >= 0) { hEtapIdx = hj; break; }
    }
    if (hEtapIdx < 0) return { erro: 'Cabeçalho "ProcessoID" não encontrado na aba de Etapas.' };

    var hEtap = dadosEtap[hEtapIdx].map(function(h){ return String(h).trim(); });
    var etapas = [];
    for (var j = hEtapIdx + 1; j < dadosEtap.length; j++) {
      var rowE = dadosEtap[j];
      if (!rowE[0]) continue;                              // ignora linha vazia
      if (rowE[1] === null || rowE[1] === '') continue;   // ignora linhas separadoras
      // As linhas separadoras têm texto na coluna A (ex: "N° SUAP: 23040...")
      // mas a coluna B (Ord.) está vazia — é esse o sinal para pular
      var objE = {};
      hEtap.forEach(function(h, idx){ objE[h] = rowE[idx]; });
      etapas.push(objE);
    }

    // ── Agrupa etapas por ProcessoID ─────────────────────────────────────
    // Cria um dicionário: { 'SEL-2026-001': [etapa1, etapa2,...], ... }
    var etapasPorProc = {};
    etapas.forEach(function(e) {
      var pid = String(e['ProcessoID'] || '').trim();
      if (!etapasPorProc[pid]) etapasPorProc[pid] = [];
      etapasPorProc[pid].push(e);
    });

    // Ordena as etapas de cada processo pelo número de ordem (coluna "Ord.")
    Object.keys(etapasPorProc).forEach(function(pid) {
      etapasPorProc[pid].sort(function(a, b){
        return Number(a['Ord.'] || 0) - Number(b['Ord.'] || 0);
      });
    });

    var filaDisplayCursor = new Date();
    filaDisplayCursor.setHours(0, 0, 0, 0);
    filaDisplayCursor = new Date(filaDisplayCursor.getFullYear(), filaDisplayCursor.getMonth() + 1, 1);
    if (MODO_CONTAGEM_PRAZOS === 'uteis') {
      while (!isDiaUtil(filaDisplayCursor)) filaDisplayCursor.setDate(filaDisplayCursor.getDate() + 1);
    }

    // ── Processa cada processo ────────────────────────────────────────────
    var resultado = processos.map(function(p) {
      var pid      = String(p['ProcessoID']       || '').trim();
      var suapNum  = String(p['N° SUAP']          || '').trim();
      var modal    = String(p['Modalidade']        || '').trim();
      var d0raw    = p['D0 (Data Abertura)']       || null;  // data de abertura (D0)
      var linkSuap = String(p['Link SUAP']         || '#').trim();
      var temIRP   = String(p['Tem IRP?']          || 'Não').trim();
      var tipoCD   = String(p['Tipo Contratação Direta'] || '').trim();  // subtipo da CD: Adesão, Dispensa com/sem disputa, Inexigibilidade
      var d0       = parseDateValue(d0raw);  // converte para objeto Date
      var d0Simulado = false;
      // Processo sem D0 fica na fila: gera uma data futura apenas para exibição no Gantt.
      if (!d0) {
        d0 = new Date(filaDisplayCursor.getTime());
        d0Simulado = true;
      }
      var etps     = etapasPorProc[pid] || [];

      // FIX: processo sem nenhuma etapa cadastrada — pula para evitar NaN no Gantt
      if (!etps.length) {
        Logger.log('AVISO: Processo ' + pid + ' ignorado — sem etapas cadastradas na aba Etapas.');
        return null;
      }

      // ── Filtra etapas fora do escopo do SEL ────────────────────────────
      // "Assinatura contrato / Ata (ARP)" é responsabilidade do Setor de
      // Contratos, não do SEL — por isso é excluída do painel.
      // Etapas "Não se aplica" (ex.: IRP quando Tem IRP? = Não) também ficam
      // fora: não pertencem à atribuição do SEL, igual às contratuais. Assim
      // não aparecem no Gantt nem entram no % de execução (paridade com o app).
      var etpsFiltradas = etps.filter(function(e) {
        var nomeEtapa = String(e['Etapa'] || '').toLowerCase().trim();
        if (nomeEtapa.indexOf('assinatura') >= 0 || nomeEtapa.indexOf('arp') >= 0) return false;
        if (normalizeStatus(String(e['StatusEtapa ◄ EDITAR'] || '').trim()) === 'naoaplica') return false;
        return true;
      });

      // ── Calcula datas em cascata (lógica central do sistema) ───────────
      // Cada etapa começa exatamente onde a anterior terminou.
      // Se uma etapa tem atraso (AtrasoRealDias > 0), todas as seguintes
      // são empurradas para frente automaticamente.
      //
      // Exemplo com D0 = 01/Jan/2026:
      //   Etapa 1: prazo 5 dias, atraso 0  → termina ainda em Jan/2026
      //   Etapa 2: prazo 45 dias, atraso 11 → termina 56 dias depois (11 a mais)
      //   Etapa 3: começa onde a Etapa 2 terminou (já empurrada pelo atraso)
      // (datas exatas dependem de MODO_CONTAGEM_PRAZOS: corridos ou úteis)
      var cursor = d0 ? new Date(d0.getTime()) : new Date();

      var etapasCalc = etpsFiltradas.map(function(e) {
        var nome        = String(e['Etapa']                         || '').trim();
        var base        = parseInt(e['Prazo (dias)'])               || 0;  // prazo previsto na Portaria 638/2026
        var motivo      = String(e['MotivoAtraso ◄ EDITAR']        || '').trim();
        var status      = normalizeStatus(String(e['StatusEtapa ◄ EDITAR'] || '').trim());
        var agente      = String(e['Agente Responsável']            || '').trim();
        var fase        = String(e['Fase']                          || '').trim();
        // DataRealizacao: data real de conclusão da etapa (preenchida pela equipe).
        // Substitui AtrasoRealDias — o atraso é calculado automaticamente
        // comparando esta data com a data de término prevista (fimSemAtraso).
        // Se não preenchida, assume-se que a etapa ainda está no prazo original.
        var realizacaoRaw = e['DataRealizacao◄ EDITAR'] || null;
        var dataRealizacao = (status === 'ok' && realizacaoRaw) ? parseDateValue(realizacaoRaw) : null;

        // Data de início desta etapa = posição atual do cursor
        var ini = new Date(cursor.getTime());

        // Etapa "Não se aplica" (ex.: IRP quando Tem IRP? = Não): não consome
        // prazo. Sem este tratamento, os 15 dias da IRP empurravam a previsão
        // de processos sem SRP — divergindo do app de gestão, que pula 'na'.
        var naoAplica = status === 'naoaplica';

        // Fim previsto puro (sem atraso): base em dias a partir de ini
        // (contagem conforme MODO_CONTAGEM_PRAZOS)
        var fimSemAtraso = adicionarDiasUteis(new Date(ini.getTime()), naoAplica ? 0 : base);

        // Calcula atraso em dias comparando DataRealizacao com o fim previsto.
        //   > 0 → realizou depois do prazo (atraso)
        //   ≤ 0 → realizou no prazo ou adiantado → sem atraso
        // Para etapas não concluídas (sem DataRealizacao), atraso = 0;
        // o painel calculará "atrasado há X dias" dinamicamente a partir de hoje.
        var atraso = 0;
        var adiantamento = 0;
        if (dataRealizacao && base > 0) {
          var diffDias = contarDiasUteis(fimSemAtraso, dataRealizacao);
          if (diffDias > 0) atraso = diffDias;         // realizou depois do prazo
          else if (diffDias < 0) adiantamento = -diffDias; // realizou adiantado
        }

        // Avança o cursor:
        //   - Se DataRealizacao preenchida: cursor avança até ela (data real de saída)
        //   - Etapa "Não se aplica": cursor NÃO avança (etapa pulada)
        //   - Caso contrário: avança pelo prazo base + atraso (lógica anterior)
        if (dataRealizacao && base > 0) {
          cursor = new Date(dataRealizacao.getTime());
        } else if (!naoAplica) {
          cursor = adicionarDiasUteis(new Date(cursor.getTime()), base + atraso);
        }

        // Data de fim = posição do cursor após avançar
        var fim = new Date(cursor.getTime());

        // Converte datas para índices de mês (Jan/2026 = 0, Fev/2026 = 1, ...)
        var prazoIni     = dateToMonthIdx(ini);
        var prazoFim     = dateToMonthIdx(fim);           // fim real (com ou sem atraso)
        var prazoFimBase = dateToMonthIdx(fimSemAtraso);  // fim previsto puro (sem atraso)
        // real_fim reflete a data real de conclusão nos dois sentidos: com atraso
        // estende além do baseline; com adiantamento recua antes dele.
        var realFim      = dataRealizacao ? prazoFim : prazoFimBase;

        return {
          nome:         nome,
          agente:       agente,       // setor responsável (ex: DECOF/DIAD, SEL/SEPMA)
          fase:         fase,         // Interna, Externa ou Contratual
          status:       status,       // ok | andamento | aguardando | paralisado | planejamento | naoaplica
          prazo_ini:    prazoIni,     // mês de início previsto
          prazo_fim:    prazoFimBase, // mês de fim original (sem atraso — prazo puro da Portaria)
          real_ini:     prazoIni,     // mês de início real (igual ao previsto — início não atrasa)
          real_fim:     realFim,      // mês de fim real (> prazo_fim se atraso, < se adiantamento)
          dias:         atraso,       // dias de atraso calculados (DataRealizacao - fimSemAtraso)
          adiantamento: adiantamento, // dias de adiantamento (fimSemAtraso - DataRealizacao)
          motivo:       motivo,       // justificativa do atraso
          realizacao_iso: dataRealizacao ? (dataRealizacao.getFullYear() + '-' + String(dataRealizacao.getMonth()+1).padStart(2,'0') + '-' + String(dataRealizacao.getDate()).padStart(2,'0')) : null,
          // ISO da data de início e fim — usado no tooltip para calcular
          // "Começa em X dias" / "Vence em X dias" / "Atrasado há X dias"
          ini_iso:      ini.getFullYear() + '-' + String(ini.getMonth()+1).padStart(2,'0') + '-' + String(ini.getDate()).padStart(2,'0'),
          // fim_iso = prazo puro da Portaria 638/2026 (sem atraso) — usado em "Prazo 638/2026" no tooltip de etapa.
          // NÃO usar 'fim' aqui — quando DataRealizacao está preenchida, 'fim' == DataRealizacao,
          // fazendo "Prazo 638/2026" e "Realizado" exibirem a mesma data no tooltip.
          fim_iso:      fimSemAtraso.getFullYear() + '-' + String(fimSemAtraso.getMonth()+1).padStart(2,'0') + '-' + String(fimSemAtraso.getDate()).padStart(2,'0'),
          // fim_real_iso = data real de saída da etapa (com atraso se houver) — usado no "Período" do processo.
          fim_real_iso: fim.getFullYear() + '-' + String(fim.getMonth()+1).padStart(2,'0') + '-' + String(fim.getDate()).padStart(2,'0')
        };
      });

      // ── Calcula range (mês inicial e final) do processo inteiro ────────
      var todosIni = etapasCalc.map(function(e){ return e.prazo_ini; }).filter(function(x){ return x !== null; });
      var todosFim = etapasCalc.map(function(e){ return e.real_fim !== null ? e.real_fim : e.prazo_fim; }).filter(function(x){ return x !== null; });
      var inicio   = todosIni.length ? Math.min.apply(null, todosIni) : 0;
      var fim2     = todosFim.length ? Math.max.apply(null, todosFim) : 0;

      // ── Calcula % de execução ───────────────────────────────────────────
      // Considera concluída qualquer etapa com status "ok" (Concluída na planilha)
      var concluidas = etapasCalc.filter(function(e){ return e.status === 'ok'; }).length;
      var execucao   = etapasCalc.length ? Math.round((concluidas / etapasCalc.length) * 100) : 0;

      // ── Determina status geral do processo ─────────────────────────────
      // Ordem de prioridade: atrasado > aguardando > paralisado > andamento > concluído > planejamento
      //
      // "aguardando": processo parado aguardando ação do setor requisitante
      // "paralisado": interrupção por fato extraordinário, sem prazo de retomada
      // Ambos são distintos de "atrasado" — não há culpa do SEL, mas o processo
      // não avança. Os dias acumulados nessas etapas entram no cascateamento normalmente.
      var temAtrasada   = etapasCalc.some(function(e){ return e.dias > 0; });
      var temAndamento  = etapasCalc.some(function(e){ return e.status === 'andamento'; });
      var temAguardando = etapasCalc.some(function(e){ return e.status === 'aguardando'; });
      var temParalisado = etapasCalc.some(function(e){ return e.status === 'paralisado'; });
      var statusBase    = normalizeStatus(String(p['Status'] || '').trim());
      var statusGeral;
      if (d0Simulado)                           statusGeral = 'planejamento';
      else if (temAtrasada)                     statusGeral = 'atrasado';
      else if (temAguardando)                   statusGeral = 'aguardando';
      else if (temParalisado)                   statusGeral = 'paralisado';
      else if (temAndamento)                    statusGeral = 'andamento';
      else if (execucao === 100)                statusGeral = 'ok';
      else if (statusBase === 'planejamento')   statusGeral = 'planejamento';
      else                                      statusGeral = statusBase || 'planejamento';

      // ── Pega o motivo de atraso mais recente com conteúdo ──────────────
      var motivos    = etapasCalc
        .filter(function(e){ return e.status === 'ok' && e.dias > 0 && e.motivo; })
        .map(function(e){ return e.motivo; });
      var motivoProc = motivos.length ? motivos[motivos.length - 1] : '';

      // ── Monta o objeto final do processo ───────────────────────────────
      // Datas ISO da 1ª etapa (início do processo) e última (fim do processo)
      // usadas no tooltip para exibir o intervalo com dia exato (DD/MM – DD/MM)
      var procIniIso = etapasCalc.length ? etapasCalc[0].ini_iso : null;
      // Para o "Período" do processo usamos fim_real_iso (data real com atraso),
      // não fim_iso (prazo puro) — queremos mostrar até quando o processo realmente durou.
      var procFimIso = etapasCalc.length ? etapasCalc[etapasCalc.length - 1].fim_real_iso : null;
      // Processos na fila (D0 simulado): as etapas seguem a cascata normal
      // calculada acima a partir do D0 simulado, usando o "Prazo (dias)" de
      // cada etapa (Portaria 638/2026). A antiga projeção visual de 150 dias
      // distribuídos igualmente entre as etapas foi removida — os prazos
      // exibidos para "A iniciar" agora refletem o padrão da Portaria.

      return {
        id:         pid,
        num:        suapNum || pid,  // exibe N° SUAP se disponível; senão usa ProcessoID
        pid:        pid,             // chave interna usada para relacionar etapas
        nome:       String(p['Objeto'] || pid).trim(),  // descrição do objeto contratado
        status:     statusGeral,     // atrasado | aguardando | paralisado | andamento | ok | planejamento
        inicio:     inicio,          // índice do mês de início (para posicionar no Gantt)
        fim:        fim2,            // índice do mês de término (para posicionar no Gantt)
        ini_iso:    procIniIso,      // data de início exata (YYYY-MM-DD) — para o tooltip DD/MM – DD/MM
        fim_iso:    procFimIso,      // data de fim exata (YYYY-MM-DD) — para o tooltip DD/MM – DD/MM
        d0_simulado: d0Simulado,     // true quando a data foi criada apenas para exibição da fila
        execucao:   execucao,        // percentual de conclusão (0 a 100)
        previsao:   absToLabel(fim2),// texto legível do mês de término (ex: "Ago/2026")
        suap:       linkSuap || '#', // URL do processo no SUAP
        motivo:     motivoProc,      // motivo de atraso exibido no tooltip
        modalidade: modalAbrev(modal), // PE | CD | CC
        tipoCD:     modalAbrev(modal) === 'CD' ? tipoCD : '', // subtipo (só p/ Contratação Direta)
        temIRP:     temIRP === 'Sim',  // true se tiver Intenção de Registro de Preços
        etapas:     etapasCalc       // array com todas as etapas calculadas
      };
    }).filter(function(p){ return p !== null && p.etapas.length > 0; });
    // Remove processos sem etapas (ex: linha vazia ou processo sem dados)
    // e processos retornados como null (D0 inválida — ver guard acima)

    var retorno = { processos: resultado, geradoEm: new Date().toISOString() };

    // ── Salva no cache por 120 segundos ──────────────────────────────────
    // O limite do CacheService é 100 KB por chave. Se o JSON for maior,
    // simplesmente não cacheia (o painel funciona igual, só mais lento).
    try {
      var json = JSON.stringify(retorno);
      if (json.length < 100000) cache.put('dados_painel', json, 120);
    } catch(e) { /* ignora erro de cache — não impede o funcionamento */ }

    return retorno;

  } catch(err) {
    // Captura qualquer erro inesperado e devolve mensagem descritiva
    return { erro: 'Erro interno: ' + err.message + ' — ' + err.stack };
  }
}


// ── INVALIDAR CACHE ──────────────────────────────────────────────────────
// Chamada pelo botão "Atualizar" do painel ou pelo menu da planilha.
// Remove o cache forçando a próxima chamada de getDados() a reler a planilha.
function invalidarCache() {
  var cache = CacheService.getScriptCache();
  cache.remove('dados_painel');
  cache.remove('dados_capacidade');
  CALENDARIO_CACHE = null;
  return { ok: true };
}


// ════════════════════════════════════════════════════════════════════════
// FUNÇÕES AUXILIARES (helpers)
// ════════════════════════════════════════════════════════════════════════

// Converte um valor de célula em objeto Date JavaScript.
// Aceita três formatos:
//   - Objeto Date nativo do Google Sheets
//   - String no formato brasileiro "DD/MM/AAAA"
//   - String no formato ISO "AAAA-MM-DD"
function parseDateValue(val) {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    // O Google Sheets armazena datas internamente em UTC (meia-noite).
    // No Brasil (UTC-3) isso causa um shift de -3h, fazendo "01/03/2026 00:00 UTC"
    // virar "28/02/2026 21:00 BRT" — um dia antes, às vezes um mês antes.
    // Corrição: recria o Date usando getUTCFullYear/Month/Date para forçar
    // o ano/mês/dia corretos independente do fuso.
    return new Date(val.getUTCFullYear(), val.getUTCMonth(), val.getUTCDate());
  }
  var s = String(val).trim();
  // Formato DD/MM/AAAA (padrão brasileiro)
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  // Fallback: tenta parsear como string genérica
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Converte uma data em índice de mês absoluto.
// A escala começa em Jan/ANO_BASE = 0.
// Exemplos (com ANO_BASE=2026): Fev/2026 = 1, Dez/2026 = 11, Jan/2027 = 12.
// Esse índice é usado no Gantt para posicionar as barras horizontalmente.
function dateToMonthIdx(d) {
  if (!d || isNaN(d.getTime())) return null;
  return (d.getFullYear() - ANO_BASE) * 12 + d.getMonth();
}

// Converte um índice de mês absoluto em texto legível (ex: 7 → "Ago/2026")
// Usado nos tooltips e na coluna "Previsão" do painel
function absToLabel(idx) {
  if (idx === null || idx === undefined) return '—';
  var MOS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  var y = ANO_BASE + Math.floor(idx / 12);
  return MOS[((idx % 12) + 12) % 12] + '/' + y;
}

function isoLocal_(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0');
}

// Converte os valores da coluna "StatusEtapa ◄ EDITAR" da planilha
// para chaves internas usadas no código JavaScript do painel.
// Isso permite que a equipe use linguagem natural na planilha
// sem depender de valores exatos.
//
// Mapeamento:
//   "Em andamento"          → 'andamento'   (exibido em azul)
//   "Concluída"             → 'ok'          (exibido em verde com ✓)
//   "Não iniciada"          → 'planejamento'(exibido em cinza)
//   "Não se aplica"         → 'naoaplica'   (etapa pulada, ex: IRP quando não é SRP)
//   "Aguardando requisitante" → 'aguardando' (processo parado; dependemos do setor requisitante)
//   "Paralisado"            → 'paralisado'  (interrupção por fato extraordinário; retomada sem prazo)
function normalizeStatus(s) {
  if (!s) return 'planejamento';
  var lower = String(s).toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  var map = {
    'em andamento':              'andamento',
    'concluida':                 'ok',
    // 'no prazo' era sinônimo antigo de 'concluída' — removido para evitar
    // contradição visual quando AtrasoRealDias > 0. Se a etapa tem atraso
    // mas ainda está acontecendo, o status correto é 'Em andamento'.
    'nao iniciada':              'planejamento',
    'nao se aplica':             'naoaplica',
    'planejamento':              'planejamento',
    'em planejamento':           'planejamento',
    'pendente':                  'pendente',
    'aguardando requisitante':   'aguardando',
    'paralisado':                'paralisado',
    'suspenso':                  'paralisado',
    'atrasado':                  'atrasado'
  };
  if (lower.indexOf('conclu') >= 0) return 'ok';
  if (lower.indexOf('andament') >= 0) return 'andamento';
  if (lower.indexOf('aguard') >= 0) return 'aguardando';
  if (lower.indexOf('paralis') >= 0 || lower.indexOf('suspens') >= 0) return 'paralisado';
  if (lower.indexOf('atras') >= 0) return 'atrasado';
  return map[lower] || 'planejamento';
}

// ════════════════════════════════════════════════════════════════════════
// TRIGGER DIÁRIO — Atualização automática dos dados
//
// O trigger roda todos os dias no horário configurado (padrão: entre 5h–6h).
// Ele invalida o cache e força uma nova leitura da planilha, garantindo que
// o painel já esteja com dados frescos quando a equipe acessar de manhã.
//
// Para instalar:  execute instalarTriggerDiario() uma única vez
// Para remover:   execute desinstalarTriggerDiario()
// ════════════════════════════════════════════════════════════════════════

// Função executada pelo trigger — invalida cache e relê a planilha
function atualizacaoDiaria() {
  invalidarCache();
  getDados();
  Logger.log('Atualização diária concluída em ' + new Date().toISOString());
}

// Instala o trigger para rodar todo dia entre 5h–6h
function instalarTriggerDiario() {
  if (PAINEL_SOMENTE_LEITURA) return painelBloquearEscrita_('instalar trigger diário');
  // Remove triggers anteriores para evitar duplicação
  desinstalarTriggerDiario();
  ScriptApp.newTrigger('atualizacaoDiaria')
    .timeBased()
    .everyDays(1)
    .atHour(5)
    .create();
  Logger.log('Trigger diário instalado com sucesso.');
  SpreadsheetApp.getUi().alert('Trigger diário instalado! O painel será atualizado automaticamente todo dia às 5h–6h.');
}

// Remove todos os triggers da função atualizacaoDiaria
function desinstalarTriggerDiario() {
  if (PAINEL_SOMENTE_LEITURA) return painelBloquearEscrita_('desinstalar trigger diário');
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'atualizacaoDiaria') {
      ScriptApp.deleteTrigger(t);
    }
  });
  Logger.log('Trigger(s) diário(s) removido(s).');
}

// ── Trigger installable para detector de atraso ──────────────────────────
// O onEdit simples não permite abrir diálogos (prompt/alert).
// Por isso usamos um trigger "installable" que chama onEditAtraso(),
// que tem permissões completas de UI.
// ── Preenche DataRealizacao vazia com data de hoje em todas as etapas ────
// Facilita o uso: célula com data já abre o calendário no primeiro clique.
// Só preenche células VAZIAS — não sobrescreve datas já registradas.
function preencherDataRealizacaoHoje() {
  if (PAINEL_SOMENTE_LEITURA) return painelBloquearEscrita_('preencher DataRealizacao em lote');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wsEtapas = null;
  ss.getSheets().forEach(function(s) {
    if (/etapa/i.test(s.getName())) wsEtapas = s;
  });
  if (!wsEtapas) { SpreadsheetApp.getUi().alert('Aba de Etapas não encontrada.'); return; }

  var dados = wsEtapas.getDataRange().getValues();
  var hIdx = -1;
  for (var i = 0; i < dados.length; i++) {
    if (dados[i].join('|').indexOf('ProcessoID') >= 0) { hIdx = i; break; }
  }
  if (hIdx < 0) return;

  var header = dados[hIdx].map(function(h) { return String(h).trim(); });
  var colDR = header.indexOf('DataRealizacao◄ EDITAR');
  if (colDR < 0) { SpreadsheetApp.getUi().alert('Coluna "DataRealizacao◄ EDITAR" não encontrada.'); return; }

  var hoje = new Date();
  var count = 0;
  for (var r = hIdx + 1; r < dados.length; r++) {
    var pid = String(dados[r][0] || '').trim();
    if (!pid) continue; // separador
    var val = dados[r][colDR];
    if (!val || val === '' || val === 0) {
      var cell = wsEtapas.getRange(r + 1, colDR + 1);
      cell.setValue(hoje);
      cell.setNumberFormat('DD/MM/YYYY');
      count++;
    }
  }
  // Garante formato DD/MM/YYYY em toda a coluna após o preenchimento em lote
  try { formatarColunaDatas(); } catch(e) {}

  SpreadsheetApp.getUi().alert(
    count + ' célula' + (count !== 1 ? 's' : '') + ' preenchida' + (count !== 1 ? 's' : '') +
    ' com a data de hoje.\n\nAo clicar em qualquer uma delas, o calendário abrirá automaticamente.\nSubstitua pela data real de conclusão quando a etapa terminar.'
  );
}

function instalarTriggerOnEdit() {
  if (PAINEL_SOMENTE_LEITURA) return painelBloquearEscrita_('instalar detector de atraso');
  desinstalarTriggerOnEdit(); // evita duplicação
  ScriptApp.newTrigger('onEditAtraso')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();
  SpreadsheetApp.getUi().alert(
    '🔔 Detector de atraso instalado!\n\n' +
    'A partir de agora, sempre que você preencher a coluna "DataRealizacao◄ EDITAR"\n' +
    'com uma data posterior ao prazo previsto, um aviso será exibido pedindo o motivo do atraso.'
  );
}

function desinstalarTriggerOnEdit() {
  if (PAINEL_SOMENTE_LEITURA) return painelBloquearEscrita_('desinstalar detector de atraso');
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'onEditAtraso') {
      ScriptApp.deleteTrigger(t);
    }
  });
}


// ════════════════════════════════════════════════════════════════════════
// NOVO PROCESSO — Insere processo + etapas padrão automaticamente
//
// Ao executar, pede via prompt apenas: N° SUAP, Objeto, Modalidade, D0 e IRP.
// O ProcessoID é GERADO AUTOMATICAMENTE no formato SEL-AAAA-NNN, onde:
//   AAAA = ano atual do sistema
//   NNN  = próximo número sequencial disponível para aquele ano (001, 002…)
//
// Depois insere:
//   1. Uma linha na aba Processos com esses dados
//   2. Um bloco de etapas padrão (Portaria 638/2026) na aba Etapas
//
// OBSERVAÇÃO: o setor responsável NÃO é mais perguntado aqui porque,
// segundo a nova modelagem, pode variar por etapa. Fica como
// "A definir" inicialmente e deve ser editado manualmente na planilha.
// ════════════════════════════════════════════════════════════════════════

function novoProcesso() {
  if (PAINEL_SOMENTE_LEITURA) return painelBloquearEscrita_('cadastrar novo processo pelo painel');
  var ui = SpreadsheetApp.getUi();

  // ── Coleta dados via prompts (ProcessoID gerado automaticamente) ─────
  var suapResp = ui.prompt('Novo Processo', 'N° SUAP (ex: 23040.009/2026):', ui.ButtonSet.OK_CANCEL);
  if (suapResp.getSelectedButton() !== ui.Button.OK) return;
  var suap = suapResp.getResponseText().trim();

  var objResp = ui.prompt('Novo Processo', 'Objeto (descrição resumida):', ui.ButtonSet.OK_CANCEL);
  if (objResp.getSelectedButton() !== ui.Button.OK) return;
  var objeto = objResp.getResponseText().trim();

  var modalResp = ui.prompt('Novo Processo', 'Modalidade:\n1 = Dispensa Eletrônica\n2 = Inexigibilidade\n3 = Pregão Eletrônico\n4 = Concorrência\n\nDigite 1, 2, 3 ou 4:', ui.ButtonSet.OK_CANCEL);
  if (modalResp.getSelectedButton() !== ui.Button.OK) return;
  var modalNum = modalResp.getResponseText().trim();
  var modalidades = { '1': 'Dispensa Eletrônica', '2': 'Inexigibilidade', '3': 'Pregão Eletrônico', '4': 'Concorrência' };
  var modalidade = modalidades[modalNum] || 'Pregão Eletrônico';

  var d0Resp = ui.prompt('Novo Processo', 'Data de abertura D0 (DD/MM/AAAA):', ui.ButtonSet.OK_CANCEL);
  if (d0Resp.getSelectedButton() !== ui.Button.OK) return;
  var d0str = d0Resp.getResponseText().trim();
  var d0 = parseDateValue(d0str);
  if (!d0) { ui.alert('Data inválida. Use o formato DD/MM/AAAA.'); return; }

  var irpResp = ui.prompt('Novo Processo', 'Tem IRP (Intenção de Registro de Preços)?\nDigite Sim ou Não:', ui.ButtonSet.OK_CANCEL);
  if (irpResp.getSelectedButton() !== ui.Button.OK) return;
  var temIRP = /sim/i.test(irpResp.getResponseText()) ? 'Sim' : 'Não';

  var linkResp = ui.prompt('Novo Processo', 'Link SUAP (URL completa do processo — pode deixar em branco):', ui.ButtonSet.OK_CANCEL);
  if (linkResp.getSelectedButton() !== ui.Button.OK) return;
  var linkSuap = linkResp.getResponseText().trim();

  var ehPregao = capIsPregao_(modalidade);
  var respInterno = capPromptServidor_(ui, 'Responsavel', ehPregao ? 'Responsavel pela fase interna:' : 'Responsavel unico pelo processo:');
  if (!respInterno) return;
  var respExterno = 'N/A';
  if (ehPregao) {
    respExterno = capPromptServidor_(ui, 'Responsavel', 'Responsavel pela fase externa (diferente da fase interna):');
    if (!respExterno) return;
    if (respExterno === respInterno) {
      ui.alert('No Pregao, o responsavel interno e o externo precisam ser diferentes.');
      return;
    }
  }

  var naturezaOpt = capPromptNumero_(ui, 'Natureza do objeto', 'Escolha a natureza do objeto:\n1 = Comum\n2 = TIC\n3 = Especial\n4 = Mao de Obra Dedicada\n5 = Obras/Engenharia\n6 = Processo compartilhado', {
    '1': { label: 'Comum', pts: 0 },
    '2': { label: 'TIC', pts: 1 },
    '3': { label: 'Especial', pts: 2 },
    '4': { label: 'Mao de Obra Dedicada', pts: 3 },
    '5': { label: 'Obras/Engenharia', pts: 3 },
    '6': { label: 'Processo compartilhado', pts: 1 }
  }, { label: 'Comum', pts: 0 });
  if (!naturezaOpt) return;

  var irpPts = 0;
  var irpLabel = 'Sem IRP';
  if (temIRP === 'Sim') {
    var irpOpt = capPromptNumero_(ui, 'IRP', 'Quantidade de itens da IRP:\n1 = Ate 10 itens\n2 = Ate 25 itens\n3 = Ate 50 itens\n4 = 100 itens ou mais', {
      '1': { label: 'IRP ate 10 itens', pts: 0.5 },
      '2': { label: 'IRP ate 25 itens', pts: 1 },
      '3': { label: 'IRP ate 50 itens', pts: 1.5 },
      '4': { label: 'IRP 100+ itens', pts: 2 }
    }, { label: 'IRP ate 10 itens', pts: 0.5 });
    if (!irpOpt) return;
    irpPts = irpOpt.pts;
    irpLabel = irpOpt.label;
  }

  var sessaoOpt = ehPregao
    ? { label: 'Sessao de Pregao/Concorrencia', pts: 2 }
    : capPromptNumero_(ui, 'Sessao externa', 'Tipo de sessao da fase externa:\n1 = Sem sessao publica\n2 = Sessao de Dispensa Eletronica', {
        '1': { label: 'Sem sessao publica', pts: 0 },
        '2': { label: 'Sessao de Dispensa Eletronica', pts: 1 }
      }, { label: 'Sem sessao publica', pts: 0 });
  if (!sessaoOpt) return;

  // Natureza na fase externa (Pregao/Concorrencia): afeta analise de propostas/habilitacao
  // Comum=0, Especial=+1, Mao de Obra Dedicada=+2
  var natExternaOpt = { label: 'Comum', pts: 0 };
  if (ehPregao || capNorm_(modalidade).indexOf('CONCORR') >= 0) {
    natExternaOpt = capPromptNumero_(ui, 'Natureza fase externa', 'Natureza do objeto na fase externa:\n1 = Comum (bens/servicos padrao)\n2 = Especial (analise mais critica de propostas)\n3 = Mao de Obra Dedicada (planilhas trabalhistas + habilitacao)', {
      '1': { label: 'Comum', pts: 0 },
      '2': { label: 'Especial', pts: 1 },
      '3': { label: 'Mao de Obra Dedicada', pts: 2 }
    }, { label: 'Comum', pts: 0 });
    if (!natExternaOpt) return;
  }

  // Grupos de itens (Pregao/Concorrencia com SRP): afeta volume de analise por grupo
  // Ate 4 grupos=+1, 5 ou mais grupos=+2; sem grupos=0
  var gruposOpt = { label: 'Sem grupos', pts: 0 };
  if (ehPregao || capNorm_(modalidade).indexOf('CONCORR') >= 0) {
    gruposOpt = capPromptNumero_(ui, 'Grupos de itens', 'Quantidade de grupos do certame (SRP):\n0 = Sem grupos (item unico ou nao se aplica)\n1 = Ate 4 grupos\n2 = 5 grupos ou mais', {
      '0': { label: 'Sem grupos', pts: 0 },
      '1': { label: 'Ate 4 grupos', pts: 1 },
      '2': { label: '5 grupos ou mais', pts: 2 }
    }, { label: 'Sem grupos', pts: 0 });
    if (!gruposOpt) return;
  }

  var setor = respInterno;

  // ── Localiza as abas ─────────────────────────────────────────────────
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wsProc = null, wsEtapas = null;
  ss.getSheets().forEach(function(s) {
    var n = s.getName();
    if (/processo/i.test(n))  wsProc   = s;
    if (/etapa/i.test(n))     wsEtapas = s;
  });
  if (!wsProc || !wsEtapas) { ui.alert('Abas "Processos" ou "Etapas" não encontradas.'); return; }

  // ── Gera ProcessoID automaticamente ──────────────────────────────────
  // Formato: SEL-AAAA-NNN (AAAA = ano atual, NNN = sequencial 3 dígitos)
  // Varre a coluna A (ProcessoID) procurando o maior NNN já usado no ano.
  var dadosProc = wsProc.getDataRange().getValues();
  var anoAtual = new Date().getFullYear();
  var prefixo = 'SEL-' + anoAtual + '-';
  var maiorSeq = 0;
  for (var i = 0; i < dadosProc.length; i++) {
    var cell = String(dadosProc[i][0] || '').trim();
    if (cell.indexOf(prefixo) === 0) {
      var seq = parseInt(cell.substring(prefixo.length), 10);
      if (!isNaN(seq) && seq > maiorSeq) maiorSeq = seq;
    }
  }
  var pid = prefixo + String(maiorSeq + 1).padStart(3, '0');

  // ── Insere linha na aba Processos ────────────────────────────────────
  // Detecta o cabeçalho para saber a ordem das colunas
  var hProcIdx = -1;
  for (var hi = 0; hi < dadosProc.length; hi++) {
    if (dadosProc[hi].join('|').indexOf('ProcessoID') >= 0) { hProcIdx = hi; break; }
  }
  if (hProcIdx < 0) { ui.alert('Cabeçalho "ProcessoID" não encontrado na aba Processos.'); return; }
  var hProc = dadosProc[hProcIdx].map(function(h){ return String(h).trim(); });

  // Monta a linha respeitando a ordem das colunas
  var novaLinhaProc = hProc.map(function(col) {
    switch(col) {
      case 'ProcessoID':          return pid;
      case 'N° SUAP':             return suap;
      case 'Objeto':              return objeto;
      case 'Modalidade':          return modalidade;
      case 'D0 (Data Abertura)':  return d0;
      case 'Setor Requisitante':  return setor;
      case 'Status':              return 'Em planejamento';
      case 'Tem IRP?':            return temIRP;
      case 'Link SUAP':           return linkSuap;
      default:                    return '';
    }
  });
  // ── Localiza a primeira linha vazia na aba Processos ───────────────────
  // getDataRange() só lê linhas com CONTEÚDO — linhas pré-formatadas sem
  // valores ficam fora desse range. Por isso lemos um bloco explícito de
  // até 150 linhas após o cabeçalho, cobrindo dados reais + linhas vazias
  // pré-formatadas.
  var colProcP = hProc.indexOf('ProcessoID');
  var procRowSheet = -1;
  var primeiraLinhaProc = hProcIdx + 2;                      // 1ª linha de dados (1-based)
  var nColsProc        = hProc.length;
  var limiteLinhasProc = Math.min(wsProc.getMaxRows() - primeiraLinhaProc + 1, 150);
  if (limiteLinhasProc > 0) {
    var blocoProc = wsProc.getRange(primeiraLinhaProc, 1, limiteLinhasProc, nColsProc).getValues();
    for (var pi = 0; pi < blocoProc.length; pi++) {
      if (String(blocoProc[pi][colProcP] || '').trim() === '') {
        procRowSheet = primeiraLinhaProc + pi;               // linha real na planilha (1-based)
        break;
      }
    }
  }
  if (procRowSheet < 0) {
    ui.alert('Não há linhas disponíveis na aba Processos.\nAdicione mais linhas pré-formatadas.');
    return;
  }
  wsProc.getRange(procRowSheet, 1, 1, novaLinhaProc.length).setValues([novaLinhaProc]);

  // Formata a célula D0 como data pura (sem hora)
  var d0ColIdx = hProc.indexOf('D0 (Data Abertura)');
  if (d0ColIdx >= 0) {
    wsProc.getRange(procRowSheet, d0ColIdx + 1).setNumberFormat('DD/MM/YYYY');
  }

  // ── Localiza o próximo bloco vazio na aba Etapas ─────────────────────
  // A aba tem 100 blocos pré-formatados de 10 linhas cada:
  //   1 separador  (col Ord. vazia, col ProcessoID vazia = bloco livre)
  //   9 etapas     (Ord. 1..9, ProcessoID vazio = ainda não usado)
  //
  // Todo o visual (bordas, fonte Arial 11, cores, formatação condicional)
  // já está na planilha. O código só precisa preencher os valores:
  //   • Nome do objeto no separador (col A, já mesclada)
  //   • ProcessoID nas 9 linhas de etapa
  //   • Etapa 4 (IRP) → "Não se aplica" quando temIRP = Não
  //   • Etapa 8 (Fase externa) → nome e prazo conforme modalidade
  // Lê o cabeçalho da aba Etapas via getDataRange() (cabeçalho sempre tem conteúdo)
  var dadosEtap = wsEtapas.getDataRange().getValues();
  var hEtapIdx = -1;
  for (var hj = 0; hj < dadosEtap.length; hj++) {
    if (dadosEtap[hj].join('|').indexOf('ProcessoID') >= 0) { hEtapIdx = hj; break; }
  }
  if (hEtapIdx < 0) { ui.alert('Cabeçalho "ProcessoID" não encontrado na aba Etapas.'); return; }
  var hEtap    = dadosEtap[hEtapIdx].map(function(h){ return String(h).trim(); });
  var colProcE = hEtap.indexOf('ProcessoID');
  var colOrdE  = hEtap.indexOf('Ord.');
  var colEtapE = hEtap.indexOf('Etapa');
  var colAgenteE = hEtap.indexOf('Agente Responsável');
  var colPrazE = hEtap.indexOf('Prazo (dias)');
  var colStatE = hEtap.indexOf('StatusEtapa ◄ EDITAR');

  // Procura o primeiro separador livre: Ord. e ProcessoID ambos vazios.
  // getDataRange() não inclui linhas pré-formatadas sem valores, então
  // lemos um bloco explícito de até 1100 linhas (100 blocos × 10 + folga).
  var primeiraLinhaEtap = hEtapIdx + 2;                     // 1ª linha de dados (1-based)
  var nColsEtap         = hEtap.length;
  var limiteEtap        = Math.min(wsEtapas.getMaxRows() - primeiraLinhaEtap + 1, 1100);
  var sepRowSheet = -1;
  if (limiteEtap > 0) {
    var blocoEtap = wsEtapas.getRange(primeiraLinhaEtap, 1, limiteEtap, nColsEtap).getValues();
    for (var ri = 0; ri < blocoEtap.length; ri++) {
      var ordVal = String(blocoEtap[ri][colOrdE]  || '').trim();
      var pidVal = String(blocoEtap[ri][colProcE] || '').trim();
      if (ordVal === '' && pidVal === '') {
        sepRowSheet = primeiraLinhaEtap + ri;                // linha real na planilha (1-based)
        break;
      }
    }
  }
  if (sepRowSheet < 0) {
    ui.alert('Não há blocos disponíveis na aba Etapas.\nTodos os 100 espaços pré-formatados foram utilizados.');
    return;
  }

  // Grava o nome do objeto no separador (col A, já está mesclada)
  wsEtapas.getRange(sepRowSheet, 1).setValue(objeto);

  // Preenche ProcessoID nas 9 linhas de etapa abaixo do separador
  wsEtapas.getRange(sepRowSheet + 1, colProcE + 1, 9, 1).setValue(pid);

  // Preenche responsaveis nas etapas: 1-7 fase interna, 8 fase externa,
  // 9 contratual fica como esta no modelo.
  if (colAgenteE >= 0) {
    wsEtapas.getRange(sepRowSheet + 1, colAgenteE + 1, 7, 1).setValue(respInterno);
    wsEtapas.getRange(sepRowSheet + 8, colAgenteE + 1).setValue(ehPregao ? respExterno : respInterno);
  }

  // Etapa 4 — IRP: marca "Não se aplica" quando o processo não tem IRP
  if (temIRP !== 'Sim' && colStatE >= 0) {
    wsEtapas.getRange(sepRowSheet + 4, colStatE + 1).setValue('Não se aplica');
  }

  // Etapa 8 — Fase externa: ajusta nome e prazo conforme modalidade
  // (o bloco pré-formatado assume Pregão Eletrônico como padrão)
  if (modalidade !== 'Pregão Eletrônico') {
    var faseNome  = 'Fase externa — ' + modalidade;
    var fasePrazo = faseExternaDias(modalidade);
    if (colEtapE >= 0) wsEtapas.getRange(sepRowSheet + 8, colEtapE + 1).setValue(faseNome);
    if (colPrazE >= 0) wsEtapas.getRange(sepRowSheet + 8, colPrazE + 1).setValue(fasePrazo);
  }

  // Registra a carga inicial na aba Capacidade. Pregao tem linha interna
  // ativa e externa preparada; demais modalidades usam responsavel unico.
  var modPts = capModalidadePts_(modalidade);
  var capItems = [];
  if (ehPregao) {
    // Fase interna: modalidade + natureza do objeto + IRP
    var totalInterno = modPts + naturezaOpt.pts + irpPts;
    // Fase externa: modalidade + sessao + natureza fase externa + grupos
    var totalExterno = modPts + sessaoOpt.pts + natExternaOpt.pts + gruposOpt.pts;
    capItems.push({
      pid: pid, objeto: objeto, servidor: respInterno, modalidade: modalidade,
      fase: 'Interna', ativo: 'Nao', modPts: modPts, natPts: naturezaOpt.pts,
      sessPts: 0, outrosPts: irpPts, total: totalInterno,
      obs: naturezaOpt.label + '; ' + irpLabel + '. Externo: ' + respExterno,
      divisao: 'Pregao: fase interna preparada; passa a contar quando o processo iniciar.'
    });
    capItems.push({
      pid: pid, objeto: objeto, servidor: respExterno, modalidade: modalidade,
      fase: 'Externa', ativo: 'Nao', modPts: modPts, natPts: natExternaOpt.pts,
      sessPts: sessaoOpt.pts, outrosPts: gruposOpt.pts, total: totalExterno,
      obs: sessaoOpt.label + '; ' + natExternaOpt.label + '; ' + gruposOpt.label + '. Interno: ' + respInterno,
      divisao: 'Pregao: fase externa preparada; passa a contar quando a fase externa assumir.'
    });
  } else {
    // Modalidade unica: tudo numa linha so (nao ha segregacao interna/externa)
    var totalUnico = modPts + naturezaOpt.pts + irpPts + sessaoOpt.pts;
    capItems.push({
      pid: pid, objeto: objeto, servidor: respInterno, modalidade: modalidade,
      fase: 'Unica', ativo: 'Nao', modPts: modPts, natPts: naturezaOpt.pts,
      sessPts: sessaoOpt.pts, outrosPts: irpPts, total: totalUnico,
      obs: 'Responsavel externo: N/A. ' + naturezaOpt.label + '; ' + irpLabel + '; ' + sessaoOpt.label + '.',
      divisao: 'Modalidade sem segundo responsavel separado; passa a contar quando o processo iniciar.'
    });
  }
  var capRows = capAppendRows_(capItems);
  sincronizarCapacidade(true);

  SpreadsheetApp.flush(); // confirma todas as escritas antes de seguir

  // Invalida o cache para que o painel reflita o novo processo
  invalidarCache();

  ui.alert('Processo "' + pid + '" criado com sucesso!\n\n' +
           '• ProcessoID: ' + pid + '\n' +
           '• Bloco pré-formatado preenchido na aba Etapas\n' +
           '• Capacidade: ' + capRows + ' linha(s) registrada(s)\n' +
           (temIRP !== 'Sim' ? '• Etapa 4 (IRP) marcada como Nao se aplica\n' : '• IRP incluida como etapa 4 (' + irpLabel + ')\n') +
           (modalidade !== 'Pregao Eletronico' ? '• Fase externa ajustada para ' + modalidade + '\n' : '') +
           (ehPregao ? '• Fase externa: ' + natExternaOpt.label + '; ' + gruposOpt.label + '\n' : '') +
           '\nO painel ja vai exibir o novo processo na proxima atualizacao.');
}

// Helper: retorna os dias da fase externa por modalidade (lê PORTARIA_638)
function faseExternaDias(modalidade) {
  if (/direta|dispensa|inexig/i.test(modalidade)) return PORTARIA_638.FASE_EXTERNA.DIRETA;
  if (/concorrência|concorrencia/i.test(modalidade)) return PORTARIA_638.FASE_EXTERNA.CONCORRENCIA;
  return PORTARIA_638.FASE_EXTERNA.PREGAO; // Pregão Eletrônico (padrão)
}

// ════════════════════════════════════════════════════════════════════════
// AUTOMACAO DE CAPACIDADE
// ════════════════════════════════════════════════════════════════════════

function capNorm_(s) {
  return String(s || '').toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function capGetServidoresConfig_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('⚙️ ConfigSEL') || ss.getSheetByName('ConfigSEL');
    if (!sh || sh.getLastRow() < 2) return [];
    var vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 4)).getValues();
    var h = vals[0].map(function(c){ return String(c || '').trim(); });
    var iNome = h.indexOf('Nome');
    if (iNome < 0) return [];
    var out = [];
    for (var r = 1; r < vals.length; r++) {
      var nome = String(vals[r][iNome] || '').trim();
      if (nome) out.push(nome);
    }
    return out;
  } catch(e) {
    return [];
  }
}

function capGetServidoresAtivos_() {
  try {
    var cfg = capGetServidoresConfig_();
    if (cfg.length) return cfg.map(function(n){ return capNorm_(n); });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ws = capFindSheet_(ss, 'Capacidade');
    if (!ws) return CAP_SERVIDORES_ATIVOS.slice();
    var data = ws.getDataRange().getValues();
    var sumHdr = -1, regHdr = -1;
    for (var r = 0; r < data.length; r++) {
      var a = String(data[r][0] || '').trim();
      var b = String(data[r][1] || '').trim();
      var c = String(data[r][2] || '').trim();
      if (sumHdr < 0 && a === 'Servidor' && b.indexOf('Outros') >= 0) sumHdr = r;
      if (regHdr < 0 && a.indexOf('Servidor') >= 0 && c === 'ProcessoID') regHdr = r;
      if (sumHdr >= 0 && regHdr >= 0) break;
    }
    if (sumHdr < 0) return CAP_SERVIDORES_ATIVOS.slice();
    var limite = regHdr > sumHdr ? regHdr : data.length;
    var out = [];
    for (var i = sumHdr + 1; i < limite; i++) {
      var nome = String(data[i][0] || '').trim();
      if (!nome || /total/i.test(nome)) continue;
      out.push(capNorm_(nome));
    }
    return out.length ? out : CAP_SERVIDORES_ATIVOS.slice();
  } catch(e) {
    return CAP_SERVIDORES_ATIVOS.slice();
  }
}

function capIsServidorAtivo_(nome) {
  return capGetServidoresAtivos_().indexOf(capNorm_(nome)) >= 0;
}

function capColLetter_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - m) / 26);
  }
  return s;
}

function capFindSheet_(ss, needle) {
  var found = null;
  ss.getSheets().forEach(function(s) {
    if (capNorm_(s.getName()).indexOf(capNorm_(needle)) >= 0) found = s;
  });
  return found;
}

function capFindHeaderRow_(ws) {
  // Procura a linha de cabecalho do REGISTRO (nao do resumo).
  // O registro tem "ProcessoID" + "Servidor" + "Total" na mesma linha.
  // O bloco de resumo (linha ~5) tem "Servidor" e "Total" mas nao tem "ProcessoID".
  var max = Math.min(ws.getLastRow(), 40);
  if (max < 1) return CAP_HEADER_ROW_FALLBACK;
  var ncols = Math.max(ws.getLastColumn(), 1);
  var values = ws.getRange(1, 1, max, ncols).getValues();
  for (var r = 0; r < values.length; r++) {
    var rowNorm = values[r].map(capNorm_);
    var rowStr  = rowNorm.join('|');
    if (rowNorm.indexOf('PROCESSOID') >= 0 &&
        rowNorm.indexOf('SERVIDOR')   >= 0 &&
        rowStr.indexOf('TOTAL')       >= 0) {
      return r + 1;
    }
  }
  return CAP_HEADER_ROW_FALLBACK;
}

function capFindCol_(header, names) {
  var wanted = names.map(capNorm_);
  for (var i = 0; i < header.length; i++) {
    var h = capNorm_(header[i]);
    for (var j = 0; j < wanted.length; j++) {
      if (h === wanted[j]) return i;
    }
  }
  for (var k = 0; k < header.length; k++) {
    var hk = capNorm_(header[k]);
    for (var n = 0; n < wanted.length; n++) {
      if (hk.indexOf(wanted[n]) >= 0) return k;
    }
  }
  return -1;
}

function capFindColExact_(header, name) {
  var wanted = capNorm_(name);
  for (var i = 0; i < header.length; i++) {
    if (capNorm_(header[i]) === wanted) return i;
  }
  return -1;
}

function capGetInfo_(ws) {
  var headerRow = capFindHeaderRow_(ws);
  var lastCol = Math.max(ws.getLastColumn(), 1);
  var header = ws.getRange(headerRow, 1, 1, lastCol).getValues()[0].map(function(h) {
    return String(h || '').trim();
  });
  // dataStartRow = headerRow + 2 porque a linha imediatamente apos o cabecalho
  // e um aviso/instrucao (linha 18 na nova estrutura) e nao uma linha de dados.
  var info = {
    headerRow: headerRow,
    dataStartRow: headerRow + 2,
    header: header,
    colPid: capFindCol_(header, ['ProcessoID']),
    colObjeto: capFindCol_(header, ['Processo / Objeto', 'Processo Objeto']),
    colServidor: capFindCol_(header, ['Servidor', 'Servidor EDITAR']),
    colModalidade: capFindColExact_(header, 'Modalidade'),
    colFase: capFindCol_(header, ['Fase da Carga', 'Fase Atual', 'Fase Atual EDITAR']),
    colAtivo: capFindCol_(header, ['Ativo']),
    colModPts: capFindCol_(header, ['Modalidade pts', 'Modalidade(pts)', 'Mod pts', 'Mod (pts)']),
    colNatPts: capFindCol_(header, ['Natureza pts', 'Natureza(pts)', 'Nat pts', 'Nat (pts)']),
    colSessPts: capFindCol_(header, ['Sessao pts', 'Sessao(pts)', 'Sessão pts', 'Sess pts', 'Sess (pts)']),
    colOutrosPts: capFindCol_(header, ['Outros pts', 'Outros(pts)', 'Outros (pts)']),
    colTotal: capFindCol_(header, ['Total']),
    colObs: capFindCol_(header, ['Observacao', 'Observação'])
  };
  return info;
}

function capEnsureColumns_(ws) {
  var info = capGetInfo_(ws);
  var desired = [
    { key: 'colPid', label: 'ProcessoID' },
    { key: 'colModalidade', label: 'Modalidade' },
    { key: 'colFase', label: 'Fase da Carga' },
    { key: 'colAtivo', label: 'Ativo' }
  ];
  var lastCol = ws.getLastColumn();
  desired.forEach(function(item) {
    info = capGetInfo_(ws);
    if (info[item.key] < 0) {
      lastCol = Math.max(ws.getLastColumn(), lastCol) + 1;
      ws.getRange(info.headerRow, lastCol).setValue(item.label);
    }
  });
  return capGetInfo_(ws);
}

function capAtualizarFormulasResumo_(wsCap, info) {
  if (info.colServidor < 0 || info.colTotal < 0 || info.colAtivo < 0 || info.colFase < 0) {
    return false;
  }
  var maxRows = wsCap.getMaxRows();
  var start = info.dataStartRow;
  var end = maxRows;
  var sheetName = "'" + wsCap.getName().replace(/'/g, "''") + "'";
  var servidorRange = sheetName + '!' + capColLetter_(info.colServidor + 1) + start + ':' + capColLetter_(info.colServidor + 1) + end;
  var totalRange = sheetName + '!' + capColLetter_(info.colTotal + 1) + start + ':' + capColLetter_(info.colTotal + 1) + end;
  var ativoRange = sheetName + '!' + capColLetter_(info.colAtivo + 1) + start + ':' + capColLetter_(info.colAtivo + 1) + end;
  var faseRange = sheetName + '!' + capColLetter_(info.colFase + 1) + start + ':' + capColLetter_(info.colFase + 1) + end;

  var resumoRows = [];
  var preHeaderRows = Math.max(info.headerRow - 1, 1);
  var pre = wsCap.getRange(1, 1, preHeaderRows, Math.min(wsCap.getLastColumn(), 2)).getValues();
  var sumHdr = -1;
  for (var sr = 0; sr < pre.length; sr++) {
    if (String(pre[sr][0] || '').trim() === 'Servidor' &&
        String(pre[sr][1] || '').trim().indexOf('Outros') >= 0) {
      sumHdr = sr + 1;
      break;
    }
  }
  if (sumHdr > 0) {
    for (var rr = sumHdr + 1; rr < info.headerRow; rr++) {
      var nome = String(wsCap.getRange(rr, 1).getValue() || '').trim();
      if (!nome || /total/i.test(nome)) continue;
      resumoRows.push(rr);
    }
  }

  // A coluna Ativo garante que apenas a fase corrente conte. Por isso o resumo
  // soma todas as cargas ativas, internas ou externas, sem dupla contagem.
  resumoRows.forEach(function(r) {
    wsCap.getRange(r, 3).setFormula('=SUMIFS(' + totalRange + ',' + servidorRange + ',$A' + r + ',' + ativoRange + ',"Sim")');
  });
  if (!resumoRows.length) {
    for (var r = 5; r <= 8; r++) {
      wsCap.getRange(r, 3).setFormula('=SUMIFS(' + totalRange + ',' + servidorRange + ',$A' + r + ',' + ativoRange + ',"Sim")');
    }
  }
  return true;
}

// ════════════════════════════════════════════════════════════════════════
// MIGRAR CAPACIDADE ATUAL — migrarCapacidadeAtual()
//
// Para cada processo de Pregao ja listado na aba Capacidade com apenas
// uma linha (fase interna), cria a linha de fase externa correspondente.
//
// Regras:
//   - Pontuacao preservada: os valores ja preenchidos nao sao alterados.
//   - Servidor externo nao definido: linha criada com servidor = "REVISAR"
//     e Ativo = "Nao" (fora do SUMIFS ate ser corrigido manualmente).
//   - ProcessoID preenchido automaticamente cruzando objeto com aba Processos.
//   - Linhas que ja tem fase externa definida (coluna "Fase da Carga" = "Externa")
//     sao ignoradas — nao duplica.
//   - Processos com IGOR: observacao marcada, servidor = "REVISAR".
// ════════════════════════════════════════════════════════════════════════

function migrarCapacidadeAtual() {
  if (PAINEL_SOMENTE_LEITURA) return painelBloquearEscrita_('migrar capacidade pelo painel');
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wsCap = capFindSheet_(ss, 'Capacidade');
  if (!wsCap) { ui.alert('Aba Capacidade nao encontrada.'); return; }

  var info = capGetInfo_(wsCap);
  if (info.colPid < 0 || info.colServidor < 0 || info.colFase < 0 || info.colAtivo < 0) {
    ui.alert('Colunas necessarias (ProcessoID / Servidor / Fase da Carga / Ativo) nao encontradas.\nImporte a planilha CronogramaContratacoes_CPII_v3.xlsx antes de migrar.');
    return;
  }

  // Confirma antes de executar
  var conf = ui.alert(
    'Migrar capacidade atual',
    'Esta funcao vai:\n' +
    '  1. Preencher ProcessoID nas linhas que nao tem (cruzando pelo objeto).\n' +
    '  2. Para cada Pregao com linha unica, criar a linha de fase externa\n' +
    '     com Ativo=Nao e servidor=REVISAR (se nao houver segundo servidor).\n\n' +
    'Pontuacoes existentes NAO serao alteradas.\nDeseja continuar?',
    ui.ButtonSet.OK_CANCEL
  );
  if (conf !== ui.Button.OK) return;

  // Carrega processos da aba Processos para cruzamento de PID por objeto
  var processosPorObj = {};
  var processosPorPid = {};
  var wsProc = capFindSheet_(ss, 'Processos');
  if (wsProc) {
    var dpROC = wsProc.getDataRange().getValues();
    var hpIdx = -1;
    for (var hi = 0; hi < dpROC.length; hi++) {
      if (dpROC[hi].join('|').indexOf('ProcessoID') >= 0) { hpIdx = hi; break; }
    }
    if (hpIdx >= 0) {
      var hp = dpROC[hpIdx].map(function(h) { return String(h || '').trim(); });
      var cpPid = capFindCol_(hp, ['ProcessoID']);
      var cpObj = capFindCol_(hp, ['Objeto']);
      var cpMod = capFindCol_(hp, ['Modalidade']);
      for (var pr = hpIdx + 1; pr < dpROC.length; pr++) {
        var ppid = String(dpROC[pr][cpPid] || '').trim();
        var pobj = capNorm_(String(dpROC[pr][cpObj] || '').trim());
        var pmod = String(dpROC[pr][cpMod] || '').trim();
        if (!ppid) continue;
        processosPorPid[ppid] = { pid: ppid, objeto: pobj, modalidade: pmod };
        if (pobj) processosPorObj[pobj] = { pid: ppid, objeto: pobj, modalidade: pmod };
      }
    }
  }

  // Le todas as linhas do registro de capacidade
  var lastRow = wsCap.getLastRow();
  if (lastRow < info.dataStartRow) {
    ui.alert('Nenhuma linha de dados encontrada no registro de capacidade.');
    return;
  }
  var nCols = info.header.length;
  var vals = wsCap.getRange(info.dataStartRow, 1, lastRow - info.dataStartRow + 1, nCols).getValues();

  // Mapeia PIDs que ja tem linha externa definida (para nao duplicar)
  var temFaseExterna = {};
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i];
    var pid  = String(row[info.colPid]  || '').trim();
    var fase = capNorm_(String(row[info.colFase] || ''));
    if (pid && fase.indexOf('EXTERNA') >= 0) temFaseExterna[pid] = true;
  }

  // Processa cada linha: preenche PID se ausente, cria linha externa se necessario
  var alteracoes = 0;
  var linhasExternas = []; // { afterRow, rowData }

  for (var i = 0; i < vals.length; i++) {
    var row = vals[i];
    var rowNum = info.dataStartRow + i;

    var servidorRaw = String(row[info.colServidor] || '').trim();
    var objeto      = String(row[info.colObjeto >= 0 ? info.colObjeto : 1] || '').trim();
    var pidAtual    = String(row[info.colPid] || '').trim();
    var fase        = capNorm_(String(row[info.colFase] || ''));
    var modalidade  = String(info.colModalidade >= 0 ? row[info.colModalidade] : '').trim();

    // Linha vazia: pula
    if (!servidorRaw && !objeto && !pidAtual) continue;

    // --- Passo 1: preencher ProcessoID se ausente ---
    var proc = null;
    if (pidAtual) {
      proc = processosPorPid[pidAtual] || null;
    } else {
      var objNorm = capNorm_(objeto);
      // Tenta match exato primeiro, depois substring
      proc = processosPorObj[objNorm] || null;
      if (!proc) {
        // Busca parcial: objeto da planilha contido no objeto do processo ou vice-versa
        var keys = Object.keys(processosPorObj);
        for (var k = 0; k < keys.length; k++) {
          if (keys[k].indexOf(objNorm) >= 0 || objNorm.indexOf(keys[k]) >= 0) {
            proc = processosPorObj[keys[k]];
            break;
          }
        }
      }
      if (proc) {
        wsCap.getRange(rowNum, info.colPid + 1).setValue(proc.pid);
        pidAtual = proc.pid;
        alteracoes++;
      }
    }

    // Modalidade: usa a do registro; se vazia, usa a da aba Processos
    if (!modalidade && proc) modalidade = proc.modalidade;

    // --- Passo 2: para Pregao, criar linha externa se ainda nao existe ---
    if (!capIsPregao_(modalidade)) continue;
    if (temFaseExterna[pidAtual]) continue;         // ja tem linha externa
    if (fase.indexOf('EXTERNA') >= 0) continue;     // esta propria linha e externa

    // Descobre se ha outro servidor definido para este PID na aba Capacidade
    var servidorExterno = 'REVISAR';
    for (var j = 0; j < vals.length; j++) {
      if (j === i) continue;
      var outroRow = vals[j];
      var outroPid  = String(outroRow[info.colPid] || '').trim();
      var outraFase = capNorm_(String(outroRow[info.colFase] || ''));
      var outroServ = capNorm_(String(outroRow[info.colServidor] || '').trim());
      if (outroPid === pidAtual && outraFase.indexOf('EXTERNA') >= 0 && capIsServidorAtivo_(outroServ)) {
        servidorExterno = outroServ; // ja existe uma linha externa com servidor valido
        break;
      }
    }

    // Monta linha externa preservando pontuacao base da linha interna
    var modPts  = info.colModPts  >= 0 ? Number(row[info.colModPts])  || 0 : 0;
    var sessPts = capIsPregao_(modalidade) ? 2 : 1; // sessao externa Pregao = 2
    var totalExt = modPts + sessPts;

    var novaLinha = info.header.map(function(col) {
      var c = capNorm_(col);
      if (c === 'PROCESSOID')                               return pidAtual || '';
      if (c.indexOf('PROCESSOOBJETO') >= 0)                return objeto;
      if (c === 'SERVIDOR' || c.indexOf('SERVIDOR') >= 0) return servidorExterno;
      if (c === 'MODALIDADE')                               return modalidade;
      if (c.indexOf('FASEDACARGA') >= 0 || c.indexOf('FASEATUAL') >= 0) return 'Fase Externa';
      if (c === 'ATIVO')                                    return 'Nao';
      if (c.indexOf('MODPTS') >= 0 || c.indexOf('MODPTSED') >= 0) return modPts;
      if (c.indexOf('NATPTS')  >= 0)                        return 0;
      if (c.indexOf('SESSPTS') >= 0 || c.indexOf('SESSPTSED') >= 0) return sessPts;
      if (c.indexOf('OUTROSPTS') >= 0)                      return 0;
      if (c === 'TOTAL')                                    return totalExt;
      if (c.indexOf('OBSERV') >= 0) {
        return servidorExterno === 'REVISAR'
          ? 'Fase externa — definir responsavel manualmente (substituir REVISAR pelo nome do servidor)'
          : 'Fase externa — responsavel definido automaticamente';
      }
      return '';
    });

    linhasExternas.push({ afterRow: rowNum, data: novaLinha });
    temFaseExterna[pidAtual] = true; // evita duplicar se o mesmo PID aparecer duas vezes
  }

  // Insere as linhas externas de baixo para cima (para nao deslocar indices)
  linhasExternas.reverse().forEach(function(item) {
    var nextEmpty = capNextEmptyRow_(wsCap, info);
    wsCap.getRange(nextEmpty, 1, 1, item.data.length).setValues([item.data]);
    alteracoes++;
  });

  invalidarCache();

  var msg = 'Migracao concluida.\n\n' +
    'ProcessoIDs preenchidos/linhas externas criadas: ' + alteracoes + '\n\n';
  if (linhasExternas.length > 0) {
    msg += 'Linhas externas criadas com servidor = REVISAR:\n' +
      linhasExternas.map(function(l) {
        return '  • ' + (l.data[info.colPid] || '?') + ' — ' + (l.data[info.colObjeto >= 0 ? info.colObjeto : 1] || '');
      }).join('\n') + '\n\n' +
      'Substitua REVISAR pelo nome do servidor responsavel pela fase externa.';
  } else {
    msg += 'Nenhuma linha externa nova necessaria.';
  }
  ui.alert(msg);
}


function capModalidadePts_(modalidade) {
  var m = capNorm_(modalidade);
  if (m.indexOf('DISPENSA') >= 0) return 1;
  if (m.indexOf('INEXIG') >= 0) return 2;
  if (m.indexOf('PREGAO') >= 0 || m.indexOf('CONCORR') >= 0) return 3;
  if (m.indexOf('DIRETA') >= 0) return 1;
  return 3;
}

function capIsPregao_(modalidade) {
  return capNorm_(modalidade).indexOf('PREGAO') >= 0;
}

function capPromptServidor_(ui, titulo, mensagem) {
  while (true) {
    var resp = ui.prompt(titulo, mensagem + '\n\nOpcoes: Amanda, Beatriz, Bruno, Samuel', ui.ButtonSet.OK_CANCEL);
    if (resp.getSelectedButton() !== ui.Button.OK) return null; // usuario cancelou
    var nome = capNorm_(resp.getResponseText());
    if (capIsServidorAtivo_(nome)) return nome;
    ui.alert('Servidor invalido. Use Amanda, Beatriz, Bruno ou Samuel.\n\nObrigatorio para continuar. Clique OK e tente novamente, ou cancele para abortar.');
  }
}

function capPromptNumero_(ui, titulo, mensagem, mapa, padrao) {
  var resp = ui.prompt(titulo, mensagem, ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return null;
  var val = String(resp.getResponseText() || '').trim();
  return mapa.hasOwnProperty(val) ? mapa[val] : padrao;
}

function capSplitResponsaveis_(texto) {
  var raw = String(texto || '').toUpperCase()
    .replace(/\s+E\s+/g, '/')
    .replace(/[,;|+]/g, '/')
    .split('/');
  var out = [];
  raw.forEach(function(p) {
    var n = capNorm_(p);
    if (!n || n === 'IGOR') return;
    if (CAP_SERVIDORES_ATIVOS.indexOf(n) >= 0 && out.indexOf(n) < 0) out.push(n);
  });
  return out.slice(0, 2);
}

function capPontuacaoNota_(item) {
  var partes = [
    'ProcessoID: ' + item.pid,
    'Modalidade: ' + item.modalidade + ' = ' + item.modPts + ' pts',
    'Natureza = ' + item.natPts + ' pts',
    'Sessao = ' + item.sessPts + ' pts',
    'Outros = ' + item.outrosPts + ' pts',
    'Total da linha = ' + item.total + ' pts',
    'Fase da carga: ' + item.fase
  ];
  if (item.divisao) partes.push(item.divisao);
  if (item.obs) partes.push('Obs.: ' + item.obs);
  return partes.join('\n');
}

function capRowFromItem_(header, item) {
  return header.map(function(col) {
    var c = capNorm_(col);
    if (c === 'PROCESSOID') return item.pid;
    if (c.indexOf('PROCESSOOBJETO') >= 0) return item.objeto;
    if (c === 'SERVIDOR' || c.indexOf('SERVIDOR') >= 0) return item.servidor;
    if (c === 'MODALIDADE') return item.modalidade;
    if (c.indexOf('FASEDACARGA') >= 0 || c.indexOf('FASEATUAL') >= 0) return item.fase;
    if (c === 'ATIVO') return item.ativo;
    if (c.indexOf('MODALIDADEPTS') >= 0) return item.modPts;
    if (c.indexOf('NATUREZAPTS') >= 0) return item.natPts;
    if (c.indexOf('SESSAOPTS') >= 0) return item.sessPts;
    if (c.indexOf('OUTROSPTS') >= 0) return item.outrosPts;
    if (c === 'TOTAL') return item.total;
    if (c.indexOf('OBSERV') >= 0) return item.obs || '';
    return '';
  });
}

function capBuildProcessos_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wsProc = capFindSheet_(ss, 'Processos');
  if (!wsProc) return [];
  var dados = wsProc.getDataRange().getValues();
  var hIdx = -1;
  for (var i = 0; i < dados.length; i++) {
    if (dados[i].join('|').indexOf('ProcessoID') >= 0) { hIdx = i; break; }
  }
  if (hIdx < 0) return [];
  var h = dados[hIdx].map(function(x) { return String(x || '').trim(); });
  var cPid = capFindCol_(h, ['ProcessoID']);
  var cObj = capFindCol_(h, ['Objeto']);
  var cMod = capFindCol_(h, ['Modalidade']);
  var cIrp = capFindCol_(h, ['Tem IRP?', 'Tem IRP']);
  var cResp = capFindCol_(h, ['Responsaveis', 'Responsáveis', 'Responsavel', 'Responsável']);
  var out = [];
  for (var r = hIdx + 1; r < dados.length; r++) {
    var pid = String(dados[r][cPid] || '').trim();
    if (!pid) continue;
    out.push({
      pid: pid,
      objeto: String(dados[r][cObj] || '').trim(),
      modalidade: String(dados[r][cMod] || '').trim(),
      temIRP: String(dados[r][cIrp] || '').trim(),
      responsaveis: cResp >= 0 ? String(dados[r][cResp] || '').trim() : ''
    });
  }
  return out;
}

function capMatchProcessoByObjeto_(texto, processos) {
  var alvo = capNorm_(texto);
  if (!alvo) return { status: 'vazio', processo: null };
  var matches = processos.filter(function(p) {
    var obj = capNorm_(p.objeto);
    if (!obj) return false;
    return obj === alvo || obj.indexOf(alvo) >= 0 || alvo.indexOf(obj) >= 0;
  });
  if (matches.length === 1) return { status: 'ok', processo: matches[0] };
  if (matches.length > 1) return { status: 'multiplo', processo: null };
  return { status: 'nao_encontrado', processo: null };
}

function capBuildCapacidadeAtual_(processos) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wsCap = capFindSheet_(ss, 'Capacidade');
  if (!wsCap) return [];
  var info = capEnsureColumns_(wsCap);
  var lastRow = wsCap.getLastRow();
  if (lastRow < info.dataStartRow) return [];
  var vals = wsCap.getRange(info.dataStartRow, 1, lastRow - info.dataStartRow + 1, info.header.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i];
    var servidor = info.colServidor >= 0 ? capNorm_(row[info.colServidor]) : '';
    var objeto = info.colObjeto >= 0 ? String(row[info.colObjeto] || '').trim() : '';
    var total = info.colTotal >= 0 ? Number(row[info.colTotal]) || 0 : 0;
    if (!servidor || !objeto || !total) continue;
    if (!capIsServidorAtivo_(servidor)) continue;

    var pidAtual = info.colPid >= 0 ? String(row[info.colPid] || '').trim() : '';
    var processo = null;
    var matchStatus = 'sem_pid';
    if (pidAtual) {
      processo = processos.filter(function(p) { return p.pid === pidAtual; })[0] || null;
      matchStatus = processo ? 'ok' : 'pid_nao_encontrado';
    } else {
      var match = capMatchProcessoByObjeto_(objeto, processos);
      processo = match.processo;
      matchStatus = match.status;
    }

    out.push({
      rowNumber: info.dataStartRow + i,
      pid: processo ? processo.pid : pidAtual,
      objeto: processo ? processo.objeto : objeto,
      servidor: servidor,
      modalidade: processo ? processo.modalidade : '',
      fase: info.colFase >= 0 ? String(row[info.colFase] || 'Unica').trim() : 'Unica',
      ativo: matchStatus === 'ok' ? 'Sim' : 'REVISAR',
      modPts: info.colModPts >= 0 ? Number(row[info.colModPts]) || 0 : 0,
      natPts: info.colNatPts >= 0 ? Number(row[info.colNatPts]) || 0 : 0,
      sessPts: info.colSessPts >= 0 ? Number(row[info.colSessPts]) || 0 : 0,
      outrosPts: info.colOutrosPts >= 0 ? Number(row[info.colOutrosPts]) || 0 : 0,
      total: total,
      obs: info.colObs >= 0 ? String(row[info.colObs] || '').trim() : '',
      matchStatus: matchStatus
    });
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════
// capBuildEtapasStatus_()
//
// Lê a aba de Etapas e devolve um mapa { pid → statusObj } com os
// sinalizadores que controlam a coluna Ativo na aba Capacidade.
//
// Campos do statusObj:
//   faseCorrente   — fase real do processo pelo andamento das etapas:
//                    int antes da transição; ext depois que a externa assumir
//   iniciadoSEL    — ao menos uma etapa do SEL já foi iniciada/concluída
//   etapa1Ativa / etapa7Concluida — mantidos por compatibilidade com rotinas antigas
//   concluidoSEL   — todas as etapas 1–8 estão Concluídas ou Não se aplica
//                    → desativa todas as linhas do processo na Capacidade
//   temEtapaSEL    — flag de sanidade: processo tem pelo menos uma etapa
// ════════════════════════════════════════════════════════════════════════
function capBuildEtapasStatus_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wsEtapas = capFindSheet_(ss, 'Etapas');
  var status = {};
  if (!wsEtapas) return status;
  var dados = wsEtapas.getDataRange().getValues();
  var hIdx = -1;
  for (var i = 0; i < dados.length; i++) {
    if (dados[i].join('|').indexOf('ProcessoID') >= 0) { hIdx = i; break; }
  }
  if (hIdx < 0) return status;
  var h = dados[hIdx].map(function(x) { return String(x || '').trim(); });
  var cPid  = capFindCol_(h, ['ProcessoID']);
  var cOrd  = capFindCol_(h, ['Ord.']);
  var cEtapa = capFindCol_(h, ['Etapa']);
  var cFase = capFindCol_(h, ['Fase']);
  var cStat = capFindCol_(h, ['StatusEtapa ◄ EDITAR', 'StatusEtapa EDITAR', 'StatusEtapa']);
  if (cPid < 0 || cStat < 0) return status;
  for (var r = hIdx + 1; r < dados.length; r++) {
    var pid = String(dados[r][cPid] || '').trim();
    if (!pid) continue;
    var ord = parseInt(dados[r][cOrd], 10);
    var nomeEtapa = cEtapa >= 0 ? String(dados[r][cEtapa] || '').trim() : '';
    var faseTxt = cFase >= 0 ? String(dados[r][cFase] || '').trim() : '';
    var faseNorm = capNorm_(faseTxt);
    var nomeNorm = capNorm_(nomeEtapa);
    if (faseNorm.indexOf('CONTRAT') >= 0 || nomeNorm.indexOf('ASSINATURA') >= 0 || nomeNorm.indexOf('ARP') >= 0) continue;
    var st  = normalizeStatus(String(dados[r][cStat] || '').trim());
    var faseKind = faseNorm.indexOf('EXTERNA') >= 0 ? 'ext' : 'int';
    if (!status[pid]) status[pid] = {
      etapa1Ativa:     false,   // etapa 1 em andamento ou concluída
      etapa7Concluida: false,   // etapa 7 concluída → vira fase externa
      concluidoSEL:    true,    // todo processo concluído até prova em contrário
      temEtapaSEL:     false,
      iniciadoSEL:     false,
      faseCorrente:    '',
      _ativa:          '',
      _primeiraPend:   '',
      _primeiraPendPosOk: '',
      _ok:             0
    };
    // Etapa 1 — Designação da equipe: ativa quando Em andamento ou Concluída
    if (ord === 1 && (st === 'andamento' || st === 'ok')) {
      status[pid].etapa1Ativa = true;
    }
    if (st === 'ok') status[pid]._ok++;
    // Compatibilidade legada: fase externa começa quando todas as internas acabam.
    if (faseKind === 'ext' && (status[pid]._ok > 0 || st !== 'planejamento')) {
      status[pid].etapa7Concluida = true;
    }
    // Qualquer etapa SEL (1-8) não concluída → processo ainda em andamento
    if (!isNaN(ord)) {
      status[pid].temEtapaSEL = true;
      if (st !== 'ok' && st !== 'naoaplica') status[pid].concluidoSEL = false;
      if (st === 'ok' || ['andamento','aguardando','paralisado','atrasado'].indexOf(st) >= 0) status[pid].iniciadoSEL = true;
      if (['andamento','aguardando','paralisado','atrasado'].indexOf(st) >= 0 && !status[pid]._ativa) status[pid]._ativa = faseKind;
      if (st === 'planejamento' || st === 'pendente') {
        if (!status[pid]._primeiraPend) status[pid]._primeiraPend = faseKind;
        if (status[pid]._ok > 0 && !status[pid]._primeiraPendPosOk) status[pid]._primeiraPendPosOk = faseKind;
      }
    }
  }
  Object.keys(status).forEach(function(pid) {
    if (!status[pid].temEtapaSEL) status[pid].concluidoSEL = false;
    status[pid].faseCorrente = status[pid]._ativa
      || status[pid]._primeiraPendPosOk
      || status[pid]._primeiraPend
      || '';
    status[pid].etapa7Concluida = status[pid].faseCorrente === 'ext';
  });
  return status;
}

function capNextEmptyRow_(ws, info) {
  var max = ws.getMaxRows();
  var width = Math.max(info.header.length, ws.getLastColumn());
  var vals = ws.getRange(info.dataStartRow, 1, max - info.dataStartRow + 1, width).getValues();
  for (var i = 0; i < vals.length; i++) {
    var pid = info.colPid >= 0 ? String(vals[i][info.colPid] || '').trim() : '';
    var obj = info.colObjeto >= 0 ? String(vals[i][info.colObjeto] || '').trim() : '';
    var serv = info.colServidor >= 0 ? String(vals[i][info.colServidor] || '').trim() : '';
    var total = info.colTotal >= 0 ? String(vals[i][info.colTotal] || '').trim() : '';
    if (!pid && !obj && !serv && !total) return info.dataStartRow + i;
  }
  ws.insertRowsAfter(max, 20);
  return max + 1;
}

function capAppendRows_(items) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wsCap = capFindSheet_(ss, 'Capacidade');
  if (!wsCap || !items || !items.length) return 0;
  var info = capEnsureColumns_(wsCap);
  var row = capNextEmptyRow_(wsCap, info);
  var values = items.map(function(item) { return capRowFromItem_(info.header, item); });
  var alvo = wsCap.getRange(row, 1, values.length, info.header.length).getValues();
  var precisaInserir = alvo.some(function(r) {
    return r.some(function(c) { return String(c || '').trim() !== ''; });
  });
  if (precisaInserir) {
    wsCap.insertRowsBefore(row, values.length);
    info = capGetInfo_(wsCap);
  }
  capAtualizarFormulasResumo_(wsCap, info);
  wsCap.getRange(row, 1, values.length, info.header.length).setValues(values);
  items.forEach(function(item, idx) {
    var note = capPontuacaoNota_(item);
    if (info.colServidor >= 0) wsCap.getRange(row + idx, info.colServidor + 1).setNote(note);
    if (info.colTotal >= 0) wsCap.getRange(row + idx, info.colTotal + 1).setNote(note);
  });
  return values.length;
}

function prepararMigracaoCapacidade() {
  if (PAINEL_SOMENTE_LEITURA) return painelBloquearEscrita_('preparar migração de capacidade');
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var processos = capBuildProcessos_();
  var etapas = capBuildEtapasStatus_();
  if (!processos.length) { ui.alert('Nenhum processo encontrado para migracao.'); return; }

  var name = 'Previa Migracao Capacidade';
  var wsPrev = ss.getSheetByName(name) || ss.insertSheet(name);
  wsPrev.clear();
  var header = ['Aplicar?', 'ProcessoID', 'Processo / Objeto', 'Servidor', 'Modalidade', 'Fase da Carga', 'Ativo', 'Modalidade pts', 'Natureza pts', 'Sessao pts', 'Outros pts', 'Total', 'Observacao'];
  var rows = [header];

  var atuais = capBuildCapacidadeAtual_(processos);
  if (atuais.length) {
    atuais.forEach(function(item) {
      var stAtual = item.pid ? etapas[item.pid] || {} : {};
      var faseAtual = item.fase || 'Unica';
      var ativoAtual = item.ativo;
      if (ativoAtual !== 'REVISAR' && stAtual.concluidoSEL) ativoAtual = 'Nao';
      if (ativoAtual !== 'REVISAR' && capIsPregao_(item.modalidade)) {
        faseAtual = stAtual.etapa7Concluida ? 'Externa' : 'Interna';
      }
      var obsAtual = item.obs;
      if (item.matchStatus !== 'ok') {
        obsAtual = 'REVISAR vinculo ProcessoID (' + item.matchStatus + '). ' + obsAtual;
      } else {
        obsAtual = 'Migrado da linha atual da Capacidade ' + item.rowNumber + '. ' + obsAtual;
      }
      rows.push([
        item.ativo === 'REVISAR' ? 'Nao' : 'Sim',
        item.pid,
        item.objeto,
        item.servidor,
        item.modalidade,
        faseAtual,
        ativoAtual,
        item.modPts,
        item.natPts,
        item.sessPts,
        item.outrosPts,
        item.total,
        obsAtual
      ]);
    });
  } else {
    processos.forEach(function(p) {
      var resp = capSplitResponsaveis_(p.responsaveis);
      var tinhaIgor = String(p.responsaveis || '').toUpperCase().indexOf('IGOR') >= 0;
      var revisar = resp.length === 0;
      if (resp.length === 0) resp = ['REVISAR'];
      var base = capModalidadePts_(p.modalidade);
      var st = etapas[p.pid] || {};
      var fase = capIsPregao_(p.modalidade) ? (st.etapa7Concluida ? 'Externa' : 'Interna') : 'Unica';
      var ativo = st.concluidoSEL ? 'Nao' : (revisar ? 'REVISAR' : 'Sim');
      resp.forEach(function(s) {
        var modPts = base; // pontuacao cheia para cada servidor (cada um carrega o peso do processo)
        rows.push([
          revisar ? 'Nao' : 'Sim',
          p.pid,
          p.objeto,
          s,
          p.modalidade,
          fase,
          ativo,
          modPts,
          0,
          0,
          0,
          modPts,
          (revisar ? 'REVISAR responsavel/pontuacao. ' : '') + (tinhaIgor ? 'IGOR ignorado por nao estar mais no setor. ' : '') + 'Ajustar adicionais da matriz (Natureza, Sessao, Outros) se necessario.'
        ]);
      });
    });
  }
  wsPrev.getRange(1, 1, rows.length, header.length).setValues(rows);
  wsPrev.setFrozenRows(1);
  ui.alert('Previa de migracao criada na aba "' + name + '".\n\n' +
    (atuais.length ? 'Usei as linhas atuais da aba Capacidade como base, preservando servidor, pontos e fase.\n' : 'Nao encontrei linhas atuais aproveitaveis; usei a aba Processos como base.\n') +
    'Confira ProcessoID, responsaveis, pontos e Aplicar? antes de rodar "Aplicar migracao".');
}

function aplicarMigracaoCapacidade() {
  if (PAINEL_SOMENTE_LEITURA) return painelBloquearEscrita_('aplicar migração de capacidade');
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wsPrev = ss.getSheetByName('Previa Migracao Capacidade');
  if (!wsPrev) { ui.alert('Aba de previa nao encontrada. Rode "Preparar migracao" primeiro.'); return; }
  var dados = wsPrev.getDataRange().getValues();
  if (dados.length < 2) { ui.alert('Previa vazia.'); return; }
  var h = dados[0].map(function(x) { return String(x || '').trim(); });
  var cAplicar = capFindCol_(h, ['Aplicar?']);
  var cPid = capFindCol_(h, ['ProcessoID']);
  var cObj = capFindCol_(h, ['Processo / Objeto']);
  var cServ = capFindCol_(h, ['Servidor']);
  var cMod = capFindCol_(h, ['Modalidade']);
  var cFase = capFindCol_(h, ['Fase da Carga']);
  var cAtivo = capFindCol_(h, ['Ativo']);
  var cModPts = capFindCol_(h, ['Modalidade pts']);
  var cNatPts = capFindCol_(h, ['Natureza pts']);
  var cSessPts = capFindCol_(h, ['Sessao pts']);
  var cOutrosPts = capFindCol_(h, ['Outros pts']);
  var cTotal = capFindCol_(h, ['Total']);
  var cObs = capFindCol_(h, ['Observacao']);

  var wsCap = capFindSheet_(ss, 'Capacidade');
  var existing = {};
  if (wsCap) {
    var infoCap = capEnsureColumns_(wsCap);
    var lastCap = wsCap.getLastRow();
    if (lastCap >= infoCap.dataStartRow && infoCap.colPid >= 0 && infoCap.colServidor >= 0 && infoCap.colFase >= 0) {
      var capVals = wsCap.getRange(infoCap.dataStartRow, 1, lastCap - infoCap.dataStartRow + 1, infoCap.header.length).getValues();
      capVals.forEach(function(row) {
        var key = capNorm_(row[infoCap.colPid]) + '|' + capNorm_(row[infoCap.colServidor]) + '|' + capNorm_(row[infoCap.colFase]);
        if (key.replace(/\|/g, '')) existing[key] = true;
      });
    }
  }

  var items = [];
  for (var r = 1; r < dados.length; r++) {
    if (capNorm_(dados[r][cAplicar]) !== 'SIM') continue;
    var servidor = String(dados[r][cServ] || '').trim();
    var ativo = String(dados[r][cAtivo] || '').trim();
    if (!capIsServidorAtivo_(servidor) || capNorm_(ativo) === 'REVISAR') continue;
    var keyMig = capNorm_(dados[r][cPid]) + '|' + capNorm_(servidor) + '|' + capNorm_(dados[r][cFase]);
    if (existing[keyMig]) continue;
    existing[keyMig] = true;
    items.push({
      pid: String(dados[r][cPid] || '').trim(),
      objeto: String(dados[r][cObj] || '').trim(),
      servidor: capNorm_(servidor),
      modalidade: String(dados[r][cMod] || '').trim(),
      fase: String(dados[r][cFase] || '').trim(),
      ativo: ativo || 'Sim',
      modPts: Number(dados[r][cModPts]) || 0,
      natPts: Number(dados[r][cNatPts]) || 0,
      sessPts: Number(dados[r][cSessPts]) || 0,
      outrosPts: Number(dados[r][cOutrosPts]) || 0,
      total: Number(dados[r][cTotal]) || 0,
      obs: String(dados[r][cObs] || '').trim(),
      divisao: ''
    });
  }
  var count = capAppendRows_(items);
  invalidarCache();
  ui.alert(count + ' linha(s) migrada(s) para a aba Capacidade.\n\nLinhas marcadas como REVISAR ou Aplicar? = Nao nao foram importadas.');
}

// ════════════════════════════════════════════════════════════════════════
// sincronizarCapacidade()
//
// Percorre a aba Capacidade e atualiza a coluna "Ativo" automaticamente
// com base no status das etapas na aba Etapas:
//
//   Regra 1 — Processo concluído (todas etapas 1-8 ok/naoaplica):
//     → Ativo = "Não" em todas as linhas do processo
//
//   Regra 2 — Fase Interna:
//     → Ativo = "Sim" quando a fase corrente real é interna e o processo iniciou
//     → Ativo = "Não" quando a fase externa assumir ou o processo concluir
//
//   Regra 3 — Fase Externa:
//     → Ativo = "Sim" quando a fase corrente real é externa
//     → Ativo = "Não" enquanto a fase interna ainda estiver corrente
//
//   Regra 4 — Fase Única (Dispensa/Contratação Direta):
//     → Ativo = "Sim" quando a fase corrente real for interna e o processo tiver iniciado
//     → Ativo = "Não" quando processo estiver concluído
//
//   Linhas com Ativo = "REVISAR" são preservadas — não são tocadas.
//
// Pode ser chamada:
//   - Pelo menu "Capacidade → Sincronizar capacidade"
//   - Automaticamente pelo onEditAtraso() a cada edição de StatusEtapa
//   - Pelo trigger diário (atualizacaoDiaria)
// ════════════════════════════════════════════════════════════════════════
function sincronizarCapacidade(silencioso) {
  if (PAINEL_SOMENTE_LEITURA) return painelBloquearEscrita_('sincronizar capacidade pelo painel');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wsCap = capFindSheet_(ss, 'Capacidade');
  if (!wsCap) return { ok: false, erro: 'Aba Capacidade nao encontrada.' };
  var info = capGetInfo_(wsCap);
  if (info.colPid < 0 || info.colFase < 0 || info.colAtivo < 0) {
    if (!silencioso) SpreadsheetApp.getUi().alert('Prepare a automacao de capacidade antes de sincronizar.');
    return { ok: false, erro: 'Colunas ProcessoID/Fase/Ativo ausentes.' };
  }
  var etapas = capBuildEtapasStatus_();
  var lastRow = wsCap.getLastRow();
  if (lastRow < info.dataStartRow) return { ok: true, alteradas: 0 };

  // Remove validação de dados e notas da coluna Ativo para não bloquear a escrita.
  // A validação 'Sim/Nao/REVISAR' foi adicionada em versões anteriores e causa o
  // popup "_x000a_" e pode rejeitar valores silenciosamente dependendo do acento.
  if (info.colAtivo >= 0) {
    var ativoRange = wsCap.getRange(info.dataStartRow, info.colAtivo + 1,
                                    lastRow - info.dataStartRow + 1, 1);
    ativoRange.clearDataValidations();
    ativoRange.clearNote();
  }

  var values = wsCap.getRange(
    info.dataStartRow, 1,
    lastRow - info.dataStartRow + 1,
    info.header.length
  ).getValues();
  var changed = 0;

  for (var i = 0; i < values.length; i++) {
    var pid        = String(values[i][info.colPid]   || '').trim();
    var ativoAtual = String(values[i][info.colAtivo] || '').trim();
    var fase       = capNorm_(values[i][info.colFase]);

    if (!pid) continue;

    // Linhas marcadas como REVISAR são preservadas — não mexer
    if (capNorm_(ativoAtual) === 'REVISAR') continue;

    // Processo sem etapas mapeadas — sem dados suficientes para decidir
    if (!etapas[pid]) continue;

    var st = etapas[pid];
    var novoAtivo = ativoAtual; // mantém por padrão

    if (st.concluidoSEL) {
      // Regra 1: processo todo concluído → desativa tudo
      novoAtivo = 'Nao';

    } else if (fase.indexOf('UNICA') >= 0) {
      // Regra 4: fase única (Dispensa/CD sem segregação) → ativa depois que o processo inicia
      novoAtivo = (st.faseCorrente === 'int' && st.iniciadoSEL) ? 'Sim' : 'Nao';

    } else if (fase.indexOf('INTERNA') >= 0) {
      // Regra 2: fase interna ativa quando a fase corrente real ainda é interna
      novoAtivo = (st.faseCorrente === 'int' && st.iniciadoSEL) ? 'Sim' : 'Nao';

    } else if (fase.indexOf('EXTERNA') >= 0) {
      // Regra 3: fase externa ativa quando a fase corrente real é externa
      novoAtivo = st.faseCorrente === 'ext' ? 'Sim' : 'Nao';
    }

    // Normaliza o valor atual para comparação sem sensibilidade a acento
    // (célula pode ter 'Não', 'Nao', 'não', 'nao' — tudo equivale a 'Nao')
    var ativoNorm = capNorm_(ativoAtual);
    var novoNorm  = capNorm_(novoAtivo);
    if (ativoNorm !== novoNorm) {
      wsCap.getRange(info.dataStartRow + i, info.colAtivo + 1).setValue(novoAtivo);
      changed++;
    }
  }

  // Não zera pontuações de fases encerradas: a coluna Ativo já controla a carga.
  // Preservar os pontos permite regressão de fase sem perda da pontuação original.

  invalidarCache();
  if (!silencioso) {
    SpreadsheetApp.getUi().alert(
      'Capacidade sincronizada!\n\n' +
      'Linhas atualizadas: ' + changed + '\n\n' +
      'Regras aplicadas:\n' +
      '  • Fase Interna → Sim quando a fase corrente real for interna e o processo tiver iniciado\n' +
      '  • Fase Externa → Sim quando a fase corrente real for externa\n' +
      '  • Pontuações são preservadas; Ativo controla se contam ou não\n' +
      '  • Concluído    → Não em todas as linhas'
    );
  }
  return { ok: true, alteradas: changed };
}

function concluirProcesso() {
  if (PAINEL_SOMENTE_LEITURA) return painelBloquearEscrita_('concluir processo pelo painel');
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Concluir processo', 'Informe o ProcessoID (ex: SEL-2026-001):', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var pidAlvo = resp.getResponseText().trim();
  if (!pidAlvo) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wsCap = capFindSheet_(ss, 'Capacidade');
  if (!wsCap) { ui.alert('Aba Capacidade nao encontrada.'); return; }
  var info = capGetInfo_(wsCap);
  if (info.colPid < 0 || info.colAtivo < 0) { ui.alert('Colunas ProcessoID/Ativo nao encontradas.'); return; }
  var lastRow = wsCap.getLastRow();
  var count = 0;
  if (lastRow >= info.dataStartRow) {
    var vals = wsCap.getRange(info.dataStartRow, 1, lastRow - info.dataStartRow + 1, info.header.length).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][info.colPid] || '').trim() === pidAlvo) {
        wsCap.getRange(info.dataStartRow + i, info.colAtivo + 1).setValue('Nao');
        count++;
      }
    }
  }
  invalidarCache();
  ui.alert(count ? 'Carga de ' + pidAlvo + ' desativada na Capacidade.' : 'ProcessoID nao encontrado na Capacidade.');
}


// ════════════════════════════════════════════════════════════════════════
// CONTAGEM DE PRAZOS — controlada por MODO_CONTAGEM_PRAZOS (definida no topo)
//
// Modo atual: 'corridos' — adicionarDiasUteis/contarDiasUteis contam TODOS
// os dias de calendário (fins de semana e feriados incluídos).
//
// Toda a infraestrutura de feriados abaixo (FERIADOS_FIXOS + aba Calendario)
// foi mantida: se MODO_CONTAGEM_PRAZOS voltar a 'uteis', o cálculo volta a
// excluir sábados, domingos e feriados automaticamente.
// ════════════════════════════════════════════════════════════════════════

// Feriados nacionais FIXOS no formato "MM-DD" (valem para qualquer ano)
var FERIADOS_FIXOS = [
  '01-01', // Confraternização Universal
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '09-07', // Independência do Brasil
  '10-12', // Nossa Senhora Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Consciência Negra (Lei 14.759/2023)
  '12-25'  // Natal
];
var CALENDARIO_ABA = 'Calendario';
var CALENDARIO_CACHE = null;
var CALENDARIO_CACHE_MS = 5 * 60 * 1000;
// A aba Calendario complementa os feriados nacionais fixos com feriados
// oficiais nacionais moveis, estaduais e municipais cadastrados por ano.
// Linhas de ponto facultativo ficam fora da regra atual.

function calNorm_(s) {
  return String(s || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ');
}

function calKey_(s) {
  return calNorm_(s).replace(/\s+/g, '');
}

var CALENDARIO_MUNICIPIO_MEMO = null;
function calMunicipio_() {
  // Memoiza o município por execução. Sem isso, este getProperty do
  // PropertiesService era disparado a CADA chamada de isDiaUtil() — dezenas de
  // milhares de vezes por requisição de painel.dados —, estourando o tempo de
  // execução ("Tempo esgotado ao comunicar com o Apps Script").
  if (CALENDARIO_MUNICIPIO_MEMO !== null) return CALENDARIO_MUNICIPIO_MEMO;
  CALENDARIO_MUNICIPIO_MEMO = painelConfig_('PAINEL_MUNICIPIO_CALENDARIO', PAINEL_MUNICIPIO_CALENDARIO_FALLBACK);
  return CALENDARIO_MUNICIPIO_MEMO;
}

function calFindCol_(header, nomes) {
  var alvo = {};
  nomes.forEach(function(n) { alvo[calKey_(n)] = true; });
  for (var i = 0; i < header.length; i++) {
    if (alvo[calKey_(header[i])]) return i;
  }
  return -1;
}

function calTipoFeriado_(tipo) {
  var n = calNorm_(tipo);
  return n.indexOf('FERIADO') >= 0 &&
    n.indexOf('FACULTATIVO') < 0 &&
    n.indexOf('PONTO') < 0;
}

function calAfetaPrazo_(valor) {
  var n = calNorm_(valor);
  return n === 'SIM' || n === 'S' || n === 'TRUE' || n === '1';
}

function calMunicipioOk_(valor, municipioAlvo) {
  var m = calNorm_(valor);
  return !m || m === 'TODOS' || m === calNorm_(municipioAlvo);
}

function calSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  var sh = ss.getSheetByName(CALENDARIO_ABA);
  if (sh) return sh;
  var alvo = calKey_(CALENDARIO_ABA);
  var achada = null;
  ss.getSheets().forEach(function(s) {
    if (!achada && calKey_(s.getName()) === alvo) achada = s;
  });
  return achada;
}

function calendarioFeriadosMap_() {
  var municipio = calMunicipio_();
  var agora = Date.now();
  if (CALENDARIO_CACHE &&
      CALENDARIO_CACHE.municipio === municipio &&
      (agora - CALENDARIO_CACHE.ts) < CALENDARIO_CACHE_MS) {
    return CALENDARIO_CACHE.datas;
  }

  var datas = {};
  try {
    var sh = calSheet_();
    if (!sh || sh.getLastRow() < 2) {
      CALENDARIO_CACHE = { municipio: municipio, ts: agora, datas: datas };
      return datas;
    }
    var values = sh.getDataRange().getValues();
    var headerRow = -1;
    for (var r = 0; r < values.length; r++) {
      if (calFindCol_(values[r], ['Data']) >= 0) { headerRow = r; break; }
    }
    if (headerRow < 0) {
      CALENDARIO_CACHE = { municipio: municipio, ts: agora, datas: datas };
      return datas;
    }
    var h = values[headerRow];
    var iData = calFindCol_(h, ['Data']);
    var iTipo = calFindCol_(h, ['Tipo']);
    var iMun = calFindCol_(h, ['Municipio', 'Município']);
    var iAfeta = calFindCol_(h, ['AfetaPrazo', 'Afeta Prazo']);
    if (iData < 0 || iTipo < 0 || iAfeta < 0) {
      CALENDARIO_CACHE = { municipio: municipio, ts: agora, datas: datas };
      return datas;
    }
    for (var linha = headerRow + 1; linha < values.length; linha++) {
      var row = values[linha];
      var d = parseDateValue(row[iData]);
      if (!d) continue;
      if (!calTipoFeriado_(row[iTipo])) continue;
      if (!calAfetaPrazo_(row[iAfeta])) continue;
      if (!calMunicipioOk_(iMun >= 0 ? row[iMun] : 'TODOS', municipio)) continue;
      datas[isoLocal_(d)] = true;
    }
  } catch(e) {
    datas = {};
  }

  CALENDARIO_CACHE = { municipio: municipio, ts: agora, datas: datas };
  return datas;
}

// Verifica se uma data é feriado nacional fixo
function isFeriadoFixo(d) {
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  return FERIADOS_FIXOS.indexOf(mm + '-' + dd) >= 0;
}

// Verifica se uma data é dia útil: não é sáb/dom, não é feriado nacional
// fixo e não está na aba Calendario (feriados móveis/estaduais/municipais).
// Só é consultada quando MODO_CONTAGEM_PRAZOS === 'uteis'.
function isDiaUtil(d) {
  var dow = d.getDay(); // 0=Dom, 6=Sáb
  return dow !== 0 && dow !== 6 && !isFeriadoFixo(d) && !calendarioFeriadosMap_()[isoLocal_(d)];
}

// Avança uma data em N dias de prazo, conforme MODO_CONTAGEM_PRAZOS:
//   'corridos' → soma N dias de calendário, sem pular nada.
//   'uteis'    → pula sáb/dom e feriados (isDiaUtil).
// Se qtdDias = 0, retorna a própria data (sem avançar).
// O nome "DiasUteis" foi mantido para não alterar dezenas de chamadas.
function adicionarDiasUteis(dataBase, qtdDias) {
  if (MODO_CONTAGEM_PRAZOS !== 'uteis') {
    var dc = new Date(dataBase.getTime());
    if (qtdDias > 0) dc.setDate(dc.getDate() + qtdDias);
    return dc;
  }
  var d = new Date(dataBase.getTime());
  var restante = qtdDias;
  while (restante > 0) {
    d.setDate(d.getDate() + 1);
    if (isDiaUtil(d)) restante--;
  }
  return d;
}


/*
 * contarDiasUteis(dataA, dataB) → número de dias de prazo entre dataA e dataB,
 * conforme MODO_CONTAGEM_PRAZOS ('corridos' = dias de calendário; 'uteis' = isDiaUtil).
 * Resultado positivo → dataB é depois de dataA (atraso).
 * Resultado negativo → dataB é antes de dataA (adiantamento).
 * O nome "DiasUteis" foi mantido para não alterar dezenas de chamadas.
 */
function contarDiasUteis(dataA, dataB) {
  var a = new Date(dataA.getTime()); a.setHours(0,0,0,0);
  var b = new Date(dataB.getTime()); b.setHours(0,0,0,0);
  if (MODO_CONTAGEM_PRAZOS !== 'uteis') {
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }
  var sinal = 1;
  if (a.getTime() > b.getTime()) { var tmp = a; a = b; b = tmp; sinal = -1; }
  var count = 0;
  var d = new Date(a.getTime());
  d.setDate(d.getDate() + 1); // começa no dia seguinte ao de referência
  while (d.getTime() <= b.getTime()) {
    if (isDiaUtil(d)) count++;
    d.setDate(d.getDate() + 1);
  }
  return sinal * count;
}

// Abrevia o nome da modalidade de licitação para exibição no Gantt.
// PE = Pregão Eletrônico  (barra azul escuro)
// CD = Contratação Direta (barra dourada — inclui dispensa e inexigibilidade)
// CC = Concorrência       (barra verde escuro)
// Se não reconhecer, assume PE por segurança.
function modalAbrev(m) {
  // Normaliza: remove acentos e converte para minúsculas para comparação robusta
  // (previne falha quando o Sheets importa xlsx com encoding ligeiramente diferente)
  var n = String(m || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/prego|pregao/.test(n))               return 'PE';
  if (/direta|dispensa|inexig/.test(n))     return 'CD';
  if (/concorr/.test(n))                    return 'CC';
  return 'PE';
}


// ════════════════════════════════════════════════════════════════════════
// ONEDIT SIMPLES — Correção automática de formato de data
//
// O Google Sheets sobrescreve o formato de célula ao exibir datas usando
// o padrão regional da conta do usuário (ex: conta em inglês → MM/DD/AAAA).
// Esta função simples é acionada automaticamente pelo GAS a cada edição
// e re-aplica DD/MM/YYYY na célula da coluna DataRealizacao se for editada.
//
// Por ser um "simple trigger", não precisa ser instalado manualmente —
// o GAS executa automaticamente toda vez que há uma edição na planilha.
// ════════════════════════════════════════════════════════════════════════
function onEdit(e) {
  if (PAINEL_SOMENTE_LEITURA) {
    Logger.log('[READ_ONLY] Edição manual detectada, mas o painel público não grava nem sincroniza dados.');
    return;
  }
  if (!e || !e.range) return;

  var sheet = e.range.getSheet();
  // Age apenas na aba Etapas
  var nomAba = sheet.getName().replace(/\s/g, '').toLowerCase();
  if (nomAba.indexOf('etapa') < 0) return;

  // Lê o cabeçalho uma vez para localizar as colunas relevantes
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  var colDR   = -1;  // DataRealizacao
  var colStat = -1;  // StatusEtapa

  for (var i = 0; i < header.length; i++) {
    var h = String(header[i]).trim();
    if (h === 'DataRealizacao◄ EDITAR')    colDR   = i;
    if (h.indexOf('StatusEtapa') >= 0)     colStat = i;
  }

  var colEditada = e.range.getColumn();

  // Re-aplica DD/MM/YYYY se editou DataRealizacao
  if (colDR >= 0 && colEditada === colDR + 1) {
    e.range.setNumberFormat('DD/MM/YYYY');
  }

  // Sincroniza Capacidade se editou StatusEtapa
  // onEdit simples NÃO tem permissão de UI — sincronizarCapacidade() funciona
  // em modo silencioso (só lê/grava células, sem alert/prompt)
  if (colStat >= 0 && colEditada === colStat + 1) {
    try {
      sincronizarCapacidade(true);
    } catch(eSinc) {
      Logger.log('[onEdit] Falha ao sincronizar capacidade: ' + eSinc.message);
    }
  }
}


// ════════════════════════════════════════════════════════════════════════
// ONEDIT INSTALÁVEL — Detector automático de atraso ao preencher DataRealizacao
//
// Quando a equipe preenche a coluna "DataRealizacao◄ EDITAR" de uma etapa,
// esta função verifica automaticamente se houve atraso comparando a data
// informada com o prazo previsto (calculado em cascata a partir de D0).
//
// Se houver atraso, abre um popup pedindo o motivo e grava automaticamente
// na coluna "MotivoAtraso ◄ EDITAR" da mesma linha.
//
// DIFERENÇA do onEdit simples acima: esta função usa UI (prompt/alert),
// o que exige um trigger instalável com permissões elevadas.
// ════════════════════════════════════════════════════════════════════════

function onEditAtraso(e) {
  if (PAINEL_SOMENTE_LEITURA) {
    Logger.log('[READ_ONLY] onEditAtraso ignorado: alterações devem ser registradas pelo AppSEL.');
    return;
  }
  // Ignora edições fora da planilha ativa ou sem range definido
  if (!e || !e.range) return;

  var sheet = e.range.getSheet();
  var nomAba = sheet.getName();

  // Só age na aba de Etapas
  if (!/etapa/i.test(nomAba)) return;

  // Descobre os índices das colunas relevantes a partir do cabeçalho
  var dados = sheet.getDataRange().getValues();
  var hIdx = -1;
  for (var i = 0; i < dados.length; i++) {
    if (dados[i].join('|').indexOf('ProcessoID') >= 0) { hIdx = i; break; }
  }
  if (hIdx < 0) return;

  var header = dados[hIdx].map(function(h) { return String(h).trim(); });
  var colRealizacao = header.indexOf('DataRealizacao◄ EDITAR');
  var colMotivo     = header.indexOf('MotivoAtraso ◄ EDITAR');
  var colPrazo      = header.indexOf('Prazo (dias)');
  var colProcID     = header.indexOf('ProcessoID');
  var colStatus     = header.indexOf('StatusEtapa ◄ EDITAR');

  var colEditada = e.range.getColumn();

  // ── Bloco 1: mudança de StatusEtapa para "Aguardando requisitante" ou "Paralisado" ──
  // Pede motivo apenas se MotivoAtraso estiver vazio (não sobrescreve motivo existente).
  if (colStatus >= 0 && colEditada === colStatus + 1) {
    var novoStatus = String(e.range.getValue() || '').trim();
    var statusAlerta = ['Aguardando requisitante', 'Paralisado'];
    if (statusAlerta.indexOf(novoStatus) >= 0) {
      var linhaStatus = e.range.getRow();
      if (colMotivo >= 0) {
        var motivoAtual = String(sheet.getRange(linhaStatus, colMotivo + 1).getValue() || '').trim();
        if (!motivoAtual) {
          // Motivo vazio — pede o motivo via prompt
          var uiS = SpreadsheetApp.getUi();
          var icone = novoStatus === 'Paralisado' ? '⛔' : '⏳';
          var respS = uiS.prompt(
            icone + ' ' + novoStatus,
            'Por que a etapa está com status "' + novoStatus + '"?\n\nSeja objetivo — descreva o fato:',
            uiS.ButtonSet.OK_CANCEL
          );
          if (respS.getSelectedButton() === uiS.Button.OK) {
            var motivoS = respS.getResponseText().trim();
            if (motivoS) {
              sheet.getRange(linhaStatus, colMotivo + 1).setValue(motivoS);
              SpreadsheetApp.getActiveSpreadsheet().toast(
                'Motivo registrado para "' + novoStatus + '".',
                icone + ' Motivo salvo', 4
              );
              invalidarCache();
            }
          }
        }
        // Se motivo já preenchido — não faz nada (preserva o motivo existente)
      }
    }
    try { sincronizarCapacidade(true); } catch(eSyncStatus) {}
    return; // encerra — edição de status não passa pelo bloco de DataRealizacao
  }

  // Só age se a célula editada for da coluna DataRealizacao
  // (colunas da planilha são 1-based, indexOf retorna 0-based)
  if (colRealizacao < 0 || colEditada !== colRealizacao + 1) return;

  // Pega o valor da célula editada
  var valorCelula = e.range.getValue();
  if (!valorCelula) return; // célula foi apagada — sem ação

  var dataRealizacao = parseDateValue(valorCelula);
  if (!dataRealizacao) return; // valor inválido — sem ação

  var linhaEtapa = e.range.getRow();

  // Precisa calcular o fim previsto da etapa para saber se houve atraso.
  // Estratégia: lê o ProcessoID desta linha, vai até a aba Processos buscar
  // D0, depois recalcula o cascateamento até esta etapa.
  var pidLinha = String(dados[linhaEtapa - 1][colProcID] || '').trim();
  if (!pidLinha) return;

  // Busca D0 na aba Processos
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wsProc = null;
  ss.getSheets().forEach(function(s) {
    if (/processo/i.test(s.getName())) wsProc = s;
  });
  if (!wsProc) return;

  var dadosProc = wsProc.getDataRange().getValues();
  var hProcIdx = -1;
  for (var hp = 0; hp < dadosProc.length; hp++) {
    if (dadosProc[hp].join('|').indexOf('ProcessoID') >= 0) { hProcIdx = hp; break; }
  }
  if (hProcIdx < 0) return;

  var hProc = dadosProc[hProcIdx].map(function(h) { return String(h).trim(); });
  var colD0 = hProc.indexOf('D0 (Data Abertura)');
  var colPidProc = hProc.indexOf('ProcessoID');
  if (colD0 < 0 || colPidProc < 0) return;

  var d0 = null;
  for (var rp = hProcIdx + 1; rp < dadosProc.length; rp++) {
    if (String(dadosProc[rp][colPidProc] || '').trim() === pidLinha) {
      d0 = parseDateValue(dadosProc[rp][colD0]);
      break;
    }
  }
  if (!d0) return;

  // Recalcula o cascateamento até a linha editada para achar o fim previsto
  // Percorre todas as etapas do processo na ordem, acumulando o cursor
  var cursor = new Date(d0.getTime());
  var fimPrevisto = null;

  for (var re = hIdx + 1; re < dados.length; re++) {
    var rowPid = String(dados[re][colProcID] || '').trim();
    if (!rowPid) continue;          // linha separadora
    if (rowPid !== pidLinha) {
      if (fimPrevisto !== null) break; // já passou para outro processo
      continue;
    }

    var base = parseInt(dados[re][colPrazo]) || 0;

    // Para etapas anteriores à editada: usa DataRealizacao se preenchida
    if (re < linhaEtapa - 1) {
      var drAnterior = parseDateValue(dados[re][colRealizacao]);
      if (drAnterior) {
        cursor = new Date(drAnterior.getTime());
      } else {
        cursor = adicionarDiasUteis(cursor, base);
      }
    } else if (re === linhaEtapa - 1) {
      // Esta é a linha editada — calcula o fim previsto puro
      fimPrevisto = adicionarDiasUteis(new Date(cursor.getTime()), base);
      break;
    }
  }

  if (!fimPrevisto) return;

  // Compara DataRealizacao com o fim previsto
  var diasAtraso = contarDiasUteis(fimPrevisto, dataRealizacao);
  if (diasAtraso <= 0) {
    // Sem atraso — limpa motivo se havia algum antigo e avisa
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Etapa concluída dentro do prazo previsto. Nenhum atraso registrado. 💡 Dica: ao registrar um atraso futuramente, seja objetivo e direto — descreva o fato, não a justificativa.',
      '✅ Sem atraso', 6
    );
    return;
  }

  // Houve atraso — pede o motivo via prompt
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt(
    '⚠ Atraso detectado',
    'Esta etapa terminou ' + diasAtraso + ' dia' + (diasAtraso > 1 ? 's' : '') +
    ' depois do prazo previsto.\n\nPor favor, informe o motivo do atraso:',
    ui.ButtonSet.OK_CANCEL
  );

  if (resp.getSelectedButton() === ui.Button.OK) {
    var motivo = resp.getResponseText().trim();
    if (motivo) {
      // Grava o motivo na coluna MotivoAtraso da mesma linha
      sheet.getRange(linhaEtapa, colMotivo + 1).setValue(motivo);
      SpreadsheetApp.getActiveSpreadsheet().toast(
        'Atraso de ' + diasAtraso + ' dia' + (diasAtraso > 1 ? 's úteis' : ' útil') + ' registrado com sucesso.',
        '📝 Motivo salvo', 4
      );
    }
  }

  // Invalida o cache do painel para refletir a alteração na próxima carga
  try { sincronizarCapacidade(true); } catch(eSyncData) {}
  invalidarCache();
}


// ════════════════════════════════════════════════════════════════════════
// CAPACIDADE DO SETOR — getCapacidade()
//
// Lê a aba "📊 Capacidade" da planilha e devolve ao painel o nível de
// ocupação atual do Setor de Licitações, calculado pela Matriz de
// Complexidade (Portaria 638/2026 + Manual POP CPII v1.0).
//
// Retorno em caso de sucesso:
//   {
//     pct:      0.70,           // percentual decimal (ex: 0.70 = 70%)
//     nivel:    "🟡 Limitada", // texto da célula C13 da aba Capacidade
//     mensagem: "Capacidade reduzida — ...", // texto da célula D13
//     totalPts: 28,             // pontos totais do setor
//     tetoPts:  40,             // teto total (nº servidores × 10)
//     ok: true
//   }
//
// Retorno em caso de erro (aba não encontrada ou dados ausentes):
//   { ok: false, erro: "..." }
//
// ESTRUTURA ESPERADA DA ABA "📊 Capacidade":
//   Linha 11, coluna B → % ocupado do setor (número ou fórmula =D9/E9)
//   Linha 11, coluna C → nível textual ("🟢 Disponível" | "🟡 Limitada" | "🔴 Máxima")
//   Linha 11, coluna D → mensagem descritiva
//   Linha  9, coluna D → total de pontos do setor (=SUM(D5:D8))
//   Linha  9, coluna E → teto total de pontos (=SUM(E5:E8))
//   Resumo servidores: linhas 5–8 (AMANDA, BEATRIZ, BRUNO, SAMUEL)
//   Teto individual: 10 pts por servidor na fase interna
// ════════════════════════════════════════════════════════════════════════
function getCapacidade() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Localiza a aba de Capacidade (aceita nome com ou sem emoji)
    var wsCap = null;
    ss.getSheets().forEach(function(s) {
      if (/capacidade/i.test(s.getName())) wsCap = s;
    });

    if (!wsCap) {
      return { ok: false, erro: 'Aba "Capacidade" não encontrada. Adicione a aba 📊 Capacidade à planilha.' };
    }

    // Lê o bloco de dados relevante de uma só vez (linhas 1-30 devem cobrir tudo)
    var dados = wsCap.getDataRange().getValues();

    // Mantem compatibilidade com o bloco antigo, mas calcula dinamicamente
    // quando a equipe tiver mais/menos servidores.
    if (dados.length < 11) {
      return { ok: false, erro: 'Aba Capacidade incompleta — esperadas ao menos 11 linhas.' };
    }

    var rowTotais   = dados[8];   // fallback antigo: linha 9
    var rowStatus   = dados[10];  // fallback antigo: linha 11

    function parseNumCap_(v) {
      if (typeof v === 'number') return v;
      return parseFloat(String(v || '0').replace(',', '.')) || 0;
    }
    function isSimCap_(v) {
      var n = String(v || '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return v === true || n === 'sim' || n === 's' || n === 'true' || n === '1';
    }
    function parsePctDecimalCap_(v) {
      if (typeof v === 'number') return v > 1 ? v / 100 : v;
      var txt = String(v || '').trim();
      if (!txt) return NaN;
      var n = parseFloat(txt.replace('%', '').replace(',', '.'));
      if (isNaN(n)) return NaN;
      return n > 1 ? n / 100 : n;
    }

    var sumHdr = -1, regHdr = -1;
    for (var rr = 0; rr < dados.length; rr++) {
      var ca = String(dados[rr][0] || '').trim();
      var cb = String(dados[rr][1] || '').trim();
      var cc = String(dados[rr][2] || '').trim();
      if (sumHdr < 0 && ca === 'Servidor' && cb.indexOf('Outros') >= 0) sumHdr = rr;
      if (regHdr < 0 && ca.indexOf('Servidor') >= 0 && cc === 'ProcessoID') regHdr = rr;
      if (sumHdr >= 0 && regHdr >= 0) break;
    }

    var servidoresConfig = capGetServidoresConfig_();
    var usandoConfigServidores = servidoresConfig.length > 0;
    var servidoresResumo = {};
    servidoresConfig.forEach(function(nomeCfg) {
      servidoresResumo[capNorm_(nomeCfg)] = true;
    });
    var outrosPts = 0;
    if (sumHdr >= 0) {
      var limite = regHdr > sumHdr ? regHdr : dados.length;
      for (var sr = sumHdr + 1; sr < limite; sr++) {
        var nomeResumo = String(dados[sr][0] || '').trim();
        if (/total/i.test(nomeResumo)) {
          rowTotais = dados[sr];
          continue;
        }
        if (/ocupacao|ocupação/i.test(nomeResumo)) {
          rowStatus = dados[sr];
          continue;
        }
        if (!nomeResumo || /total/i.test(nomeResumo)) continue;
        var keyResumo = capNorm_(nomeResumo);
        if (!usandoConfigServidores) servidoresResumo[keyResumo] = true;
        if (!usandoConfigServidores || servidoresResumo[keyResumo]) {
          // Painel público mostra a capacidade interna, que é a informação
          // útil para requisitantes avaliarem entrada de novas demandas.
          outrosPts += parseNumCap_(dados[sr][1]);
        }
      }
    }

    var processosPts = 0;
    var usarServidoresDoRegistro = Object.keys(servidoresResumo).length === 0;
    if (regHdr >= 0) {
      var hCap = dados[regHdr].map(function(h){ return String(h || '').trim(); });
      var iServ = hCap.indexOf('Servidor');
      var iAtivo = hCap.indexOf('Ativo');
      var iFase = hCap.indexOf('Fase da Carga');
      var iTotal = hCap.indexOf('Total');
      var iP1 = capFindCol_(hCap, ['Modalidade pts', 'Modalidade(pts)', 'Mod pts', 'Mod (pts)', '1.1', '2.1']);
      var iP2 = capFindCol_(hCap, ['Natureza pts', 'Natureza(pts)', 'Nat pts', 'Nat (pts)', '1.2', '2.2']);
      var iP3 = capFindCol_(hCap, ['Sessao pts', 'Sessao(pts)', 'Sessão pts', 'Sess pts', 'Sess (pts)', 'IRP', '2.3']);
      for (var pr = regHdr + 1; pr < dados.length; pr++) {
        var rowCap = dados[pr];
        var servCap = iServ >= 0 ? String(rowCap[iServ] || '').trim() : String(rowCap[0] || '').trim();
        if (!servCap) continue;
        if (iAtivo >= 0 && !isSimCap_(rowCap[iAtivo])) continue;
        var faseCap = iFase >= 0 ? capNorm_(rowCap[iFase]) : '';
        if (faseCap.indexOf('EXTERNA') >= 0) continue;
        // Soma somente a carga interna ativa. A fase externa segue controlada
        // internamente no AppSEL, sem inflar o indicador público.
        var totalLinha = iTotal >= 0 ? parseNumCap_(rowCap[iTotal]) : 0;
        var somaPts = (iP1 >= 0 ? parseNumCap_(rowCap[iP1]) : 0)
          + (iP2 >= 0 ? parseNumCap_(rowCap[iP2]) : 0)
          + (iP3 >= 0 ? parseNumCap_(rowCap[iP3]) : 0);
        processosPts += somaPts > 0 && Math.abs(somaPts - totalLinha) > 0.001 ? somaPts : totalLinha;
        if (usarServidoresDoRegistro) servidoresResumo[capNorm_(servCap)] = true;
      }
    }

    var qtdServidores = Object.keys(servidoresResumo).length;
    var totalCalc = processosPts + outrosPts;
    var totalOficial = parseNumCap_(rowTotais[3]);
    var tetoOficial = parseNumCap_(rowTotais[4]);
    var totalPts = (regHdr >= 0 || sumHdr >= 0) ? totalCalc : totalOficial;
    var tetoPts  = tetoOficial > 0 ? tetoOficial : (qtdServidores ? qtdServidores * 10 : 40);
    var pct      = tetoPts > 0 ? totalPts / tetoPts : 0;

    // O percentual público é calculado no servidor apenas com a fase interna,
    // para não depender de fórmula antiga nem misturar a fila externa.
    var nivel = pct >= 0.9 ? '🔴 Máxima' : pct >= 0.6 ? '🟡 Limitada' : '🟢 Disponível';

    // Mensagem orientada ao setor requisitante — calculada sempre pelo servidor
    // para garantir coerência independentemente do que estiver na célula D13.
    // Três níveis de orientação:
    //   🟢 Disponível  (< 60%) → pode encaminhar qualquer processo
    //   🟡 Limitada   (60-90%) → somente demandas prioritárias ou de baixa complexidade
    //   🔴 Máxima      (≥ 90%) → não encaminhar; aguardar orientação do SEL
    var mensagem = pct >= 0.9
      ? 'Capacidade máxima — não encaminhar novos processos; aguardar orientação do SEL'
      : pct >= 0.6
      ? 'Capacidade limitada — encaminhar somente demandas prioritárias ou de baixa complexidade'
      : 'Setor disponível — novos processos podem ser encaminhados regularmente';

    var retorno = {
      ok:       true,
      pct:      Math.round(pct * 100 + 1e-9),  // +epsilon evita arredondamento incorreto por ponto flutuante (ex: 1.025*100 = 102.499... em IEEE 754)
      nivel:    nivel,
      mensagem: mensagem,
      totalPts: totalPts,
      tetoPts:  tetoPts,
      fase:     'interna'
    };

    return retorno;

  } catch(err) {
    return { ok: false, erro: 'Erro em getCapacidade(): ' + err.message };
  }
}
