// ════════════════════════════════════════════════════════════════
// SANITIZAÇÃO — previne injeção de HTML/XSS via dados da planilha
// ════════════════════════════════════════════════════════════════
// Os dados vêm de uma planilha editável por múltiplos usuários.
// Sem sanitização, um campo com "<script>" ou aspas poderia quebrar
// o painel ou executar código malicioso no navegador.
function esc(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ════════════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ════════════════════════════════════════════════════════════════
// DATA         → array com todos os processos retornados por getDados()
//                Cada item tem: id, nome, num, modalidade, status,
//                inicio, fim, execucao, motivo, suap, previsao, etapas[]
// activeStatus → status selecionado no filtro ('', 'andamento', etc.)
// expanded     → objeto {[id]: true/false} — quais processos estão abertos
var DATA         = [];
var activeStatus = '';
var activeAno    = '';
var expanded     = {};
var _todayRange  = null;  // range atual do Gantt — usado para reposicionar a linha Hoje

// CELL_W  → largura de cada célula mensal em px (ajuste junto com .gh-mo e .mo-cell no CSS)
// LABEL_W → largura da coluna de rótulos em px (deve coincidir com --label-w no CSS)
// MOS     → nomes dos meses em pt-BR para exibição no cabeçalho do Gantt
var CELL_W      = 70;   // mantido para compatibilidade; o valor real vem de getCellW()
var LABEL_W     = 300;  // largura do painel fixo de nomes — espelha --label-w no CSS
var MOS         = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
var escalaAtiva = 'mes'; // 'mes' | 'trimestre'
// ANO_BASE: ano de referência do índice de meses (Jan/ANO_BASE = idx 0).
// Alterar aqui no futuro se quiser "rebasear" o eixo (ex: mudar para 2027 em 2028+).
// Esta constante também existe no Codigo.gs — manter os dois sincronizados.
var ANO_BASE    = 2026;

/*
 * getCellW() → largura em px de cada unidade de coluna conforme a escala ativa
 *   Mês:       70px — cada coluna = 1 mês (comportamento padrão)
 *   Trimestre: 45px — cada coluna = 1 mês, mas só Jan/Abr/Jul/Out têm rótulo
 * (Escala "Ano" foi descartada — o filtro de ano no dropdown já cumpre o papel.)
 */
function getCellW() {
  if (escalaAtiva === 'trimestre') return 45;
  return 70; // padrão: modo Mês
}

// ════════════════════════════════════════════════════════════════
// COMUNICAÇÃO COM O APPS SCRIPT (Codigo.gs)
// ════════════════════════════════════════════════════════════════

/*
 * showSkeleton()
 * Preenche o #gantt-table com 12 linhas de "esqueleto" animadas
 * enquanto os dados reais ainda não chegaram do servidor.
 * Usa larguras aleatorizadas para parecer conteúdo real.
 * Também zera os valores dos KPIs para '—'.
 */
function showSkeleton() {
  var names = document.getElementById('gantt-names');
  var bars  = document.getElementById('gantt-bars');
  if (names) names.innerHTML = '';
  if (bars)  bars.innerHTML  = '';
  var widths = ['60%','45%','75%','40%','65%','55%','70%','50%','62%','48%','68%','43%'];
  for (var i = 0; i < 12; i++) {
    if (names) {
      var nr = document.createElement('div');
      nr.className = 'sk-row';
      nr.innerHTML =
        '<div class="sk sk-expand"></div>' +
        '<div class="sk-info">' +
          '<div class="sk sk-num" style="width:' + (i % 3 === 0 ? '48%' : '0') + ';display:' + (i % 3 === 0 ? 'block' : 'none') + '"></div>' +
          '<div class="sk sk-name" style="width:' + widths[i % widths.length] + '"></div>' +
          '<div class="sk sk-num" style="width:22%;margin-top:2px"></div>' +
        '</div>';
      names.appendChild(nr);
    }
    if (bars) {
      var br = document.createElement('div');
      br.className = 'sk-row';
      br.innerHTML = '<div class="sk-bar-cell"><div class="sk sk-bar" style="width:' + widths[(i+4) % widths.length] + ';margin-left:' + (i * 7 % 30) + '%"></div></div>';
      bars.appendChild(br);
    }
  }
  ['kv-tot','kv-and','kv-atra','kv-plan','kv-conc'].forEach(function(id) {
    document.getElementById(id).textContent = '—';
  });
}

function hideSkeleton() {
  // O render() já substitui o conteúdo do gantt-table, nada a fazer
}

/*
 * Camada de Acesso a Dados (transporte ao Apps Script + leitura Firestore-first)
 * foi extraída para data-gateway.js — Fase 1 do PLANO_SEGURANCA.md.
 * Funções disponíveis globalmente: obterDadosPainel_() e obterCapacidade_(),
 * além de PainelGateway.lerDados()/lerCapacidade().
 */

/*
 * carregarDados()
 * Ponto de entrada principal. Chamado na carga da pagina e pelo
 * botao "Atualizar". Busca dados no Apps Script por rota publica
 * somente leitura, compativel com GitHub Pages.
 */
function carregarDados(forcarAtualizacao) {
  showBanner('loading', 'Carregando dados...');
  showSkeleton();

  obterDadosPainel_(forcarAtualizacao)
    .then(function(result) {
      if (result.erro) {
        showBanner('error', 'Aviso: ' + result.erro);
        return;
      }
      DATA     = ajustarFilaVisual(result.processos || []);
      expanded = {};

      var agora = new Date();
      document.getElementById('last-update').textContent =
        'Atualizado: ' + agora.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});

      showBanner('success', 'OK - ' + DATA.length + ' processos carregados');
      setTimeout(hideBanner, 3000);
      populateAnoSelect();
      restaurarFiltros();
      applyFilters();
    })
    .catch(function(err) {
      showBanner('error', 'Não foi possível carregar os dados agora: ' + (err.message || err) + ' — tente Atualizar em instantes.');
    });

  carregarCapacidade();
}

/*
 * carregarCapacidade()
 * Busca os dados de capacidade do setor via rota publica somente leitura.
 */
/* obterCapacidade_() foi movida para data-gateway.js (Fase 1). */

function carregarCapacidade() {
  obterCapacidade_()
    .then(function(cap) {
      if (!cap || !cap.ok) {
        document.getElementById('kv-cap').textContent    = 'N/D';
        document.getElementById('kv-cap-msg').textContent = cap && cap.erro ? cap.erro : 'Aba Capacidade nao configurada';
        return;
      }
      updateCapacidade(cap);
    })
    .catch(function() {
      document.getElementById('kv-cap').textContent    = 'N/D';
      document.getElementById('kv-cap-msg').textContent = 'Indisponivel';
    });
}
/*
 * updateCapacidade(cap)
 * Atualiza o card KPI de capacidade com os dados recebidos.
 * cap = { pct, nivel, mensagem, totalPts, tetoPts }
 *
 * Nível → classe CSS que controla a cor:
 *   🟢 Disponível → cap-disp (verde)
 *   🟡 Limitada   → cap-lim  (âmbar)
 *   🔴 Máxima     → cap-max  (vermelho)
 */
function updateCapacidade(cap) {
  var card = document.getElementById('kpi-cap');
  if (!card) return;

  // Remove classe de nível anterior e aplica a nova
  card.classList.remove('cap-disp', 'cap-lim', 'cap-max');
  var cls = /máxima|maxima/i.test(cap.nivel)    ? 'cap-max'
          : /limitada/i.test(cap.nivel)           ? 'cap-lim'
          : 'cap-disp';
  card.classList.add(cls);

  // Valor principal: emoji + %
  var emoji = /máxima|maxima/i.test(cap.nivel) ? '🔴'
            : /limitada/i.test(cap.nivel)        ? '🟡'
            : '🟢';
  document.getElementById('kv-cap').textContent = emoji + ' ' + cap.pct + '%';

  // Barra de progresso
  var bar = document.getElementById('kv-cap-bar');
  if (bar) bar.style.width = Math.min(cap.pct, 100) + '%';

  // Mensagem sutil
  document.getElementById('kv-cap-msg').textContent = cap.mensagem || '';
}

// ════════════════════════════════════════════════════════════════
// BANNER
// ════════════════════════════════════════════════════════════════
/*
 * showBanner(type, msg) — exibe a faixa de status com estilo e texto
 * hideBanner()          — oculta a faixa (remove classe de estado)
 */
function showBanner(type, msg) {
  var b = document.getElementById('status-banner');
  b.className = 'status-banner ' + type;
  document.getElementById('status-msg').textContent = msg;
  document.getElementById('status-spinner').style.display = type === 'loading' ? 'block' : 'none';
}
function hideBanner() {
  document.getElementById('status-banner').className = 'status-banner';
}

// ════════════════════════════════════════════════════════════════
// HELPERS — Funções auxiliares de data e posicionamento do Gantt
// ════════════════════════════════════════════════════════════════

/*
 * SISTEMA DE ÍNDICE DE MESES
 * O Gantt usa um índice inteiro para representar meses:
 *   Jan/2026 = 0,  Fev/2026 = 1, … Dez/2026 = 11
 *   Jan/2027 = 12, Fev/2027 = 13, … Dez/2027 = 23
 * Fórmula: idx = (ano - ANO_BASE) × 12 + (mês, base 0)
 * Este índice é calculado pelo Codigo.gs e vem no campo
 * p.inicio / p.fim / et.prazo_ini / et.prazo_fim / et.real_ini / et.real_fim.
 */

/*
 * todayIdx() → índice do mês atual (baseado no relógio do navegador)
 * Usado para posicionar a linha vertical "Hoje" e para destacar
 * a coluna do mês corrente no cabeçalho.
 */
function todayIdx() {
  var n = new Date();
  return (n.getFullYear() - ANO_BASE) * 12 + n.getMonth();
}

/*
 * absToLabel(idx) → "Mmm/AAAA" legível por humanos
 * Ex: absToLabel(0) → "Jan/2026", absToLabel(14) → "Mar/2027"
 * Retorna '—' para valores nulos.
 */
function absToLabel(idx) {
  if (idx === null || idx === undefined) return '—';
  var y = ANO_BASE + Math.floor(idx / 12);
  return MOS[((idx % 12) + 12) % 12] + '/' + y;
}

/*
 * absToYear(idx) → só o ano (usado no cabeçalho por grupo de ano)
 */
function absToYear(idx) { return ANO_BASE + Math.floor(idx / 12); }

/*
 * isoToDD_MM(iso) → "DD/MM" a partir de uma string YYYY-MM-DD
 * Ex: isoToDD_MM("2026-04-02") → "02/04"
 * Retorna '—' para valores nulos ou inválidos.
 */
function isoToDD_MM(iso) {
  if (!iso) return '—';
  var p = iso.split('-');
  if (p.length < 3) return '—';
  return p[2] + '/' + p[1];
}

/*
 * isoToDD_MM_YY(iso) → "DD/MM/YY" a partir de uma string YYYY-MM-DD
 * Ex: isoToDD_MM_YY("2026-12-02") → "02/12/26"
 * Retorna '—' para valores nulos ou inválidos.
 */
function isoToDD_MM_YY(iso) {
  if (!iso) return '—';
  var p = iso.split('-');
  if (p.length < 3) return '—';
  return p[2] + '/' + p[1] + '/' + p[0].slice(2);
}

/*
 * barX(moIdx, rangeStart) → posição left em px da barra
 *   Mês/Trimestre: (idxMês - rangeStart) × cellW + 4px de respiro
 */
function addDiasIso_(iso, dias) {
  if (!iso) return '';
  var d = new Date(String(iso).substring(0,10) + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + (dias || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function periodoRealizadoEtapa_(et) {
  if (!et || !et.realizacao_iso) return null;
  if (et.status === 'ok' && et.dias > 0 && et.fim_iso) {
    return { label: 'Período realizado', texto: isoToDD_MM(addDiasIso_(et.fim_iso, 1)) + ' → ' + isoToDD_MM_YY(et.realizacao_iso) };
  }
  // Concluído antes do prazo previsto: mostra a data real (anterior ao baseline).
  if (et.status === 'ok' && et.adiantamento > 0) {
    return { label: 'Concluído antes do prazo', texto: isoToDD_MM_YY(et.realizacao_iso) };
  }
  return { label: 'Realizado em', texto: isoToDD_MM_YY(et.realizacao_iso) };
}

function isFilaVisual_(p) {
  return p && (p.d0_simulado === true || (p.status === 'planejamento' && Number(p.execucao || 0) === 0));
}

function ajustarFilaVisual(data) {
  // Os prazos dos processos "A iniciar" NÃO são mais redesenhados aqui com
  // durações arbitrárias (barras escalonadas de ~4 meses). O backend já
  // calcula a cascata a partir do D0 simulado usando o "Prazo (dias)" de
  // cada etapa (Portaria 638/2026) — o Gantt exibe esses valores direto.
  // Esta função apenas garante a marcação d0_simulado para o rótulo
  // "Previsão exibida" do tooltip.
  (data || []).forEach(function(p) {
    if (!isFilaVisual_(p)) return;
    p.d0_simulado = true;
  });

  return data || [];
}

function barX(moIdx, rangeStart) {
  return (moIdx - rangeStart) * getCellW() + 4;
}

/*
 * barW(ini, fim) → largura em px da barra
 * Equação: (fim - ini + 1) × cellW − 8px (4px de respiro de cada lado)
 */
function barW(ini, fim) {
  return (fim - ini + 1) * getCellW() - 8;
}

/*
 * getRange(data) → { start, end } — intervalo de meses a exibir no Gantt
 * Varre todos os processos para encontrar o menor início e maior fim.
 * Garante mínimo de Dez/2027 (índice 23) para o eixo não ficar curto.
 * Adiciona 1 mês de margem em cada extremidade (start-1, end+1).
 */
function getRange(data) {
  var mn = Infinity, mx = -Infinity;
  var tidx = todayIdx();
  data.forEach(function(p) {
    if (p.inicio !== null && p.inicio !== undefined) mn = Math.min(mn, p.inicio);
    if (p.fim    !== null && p.fim    !== undefined) mx = Math.max(mx, p.fim);
    // considera também as etapas para não cortar barras de etapa
    if (p.etapas) p.etapas.forEach(function(et) {
      if (et.prazo_ini !== null && et.prazo_ini !== undefined) mn = Math.min(mn, et.prazo_ini);
      if (et.prazo_fim !== null && et.prazo_fim !== undefined) mx = Math.max(mx, et.prazo_fim);
    });
  });
  if (!isFinite(mn)) mn = tidx;
  if (!isFinite(mx)) mx = tidx + 11;
  // Range dinâmico — se expande automaticamente conforme os dados dos processos.
  // Margem: 1 mês antes, 2 meses depois para respiro visual à direita sem excesso.
  var start = mn - 1;
  var end   = mx + 2;
  return { start: start, end: end };
}

// STATUS_COLORS → mapeia o status da etapa para a classe CSS da barra colorida
// STATUS_LABEL  → mapeia o status para o texto legível exibido no tooltip
var STATUS_COLORS = { andamento:'b-andamento', atrasado:'b-atrasado', ok:'b-ok', planejamento:'b-planejamento', fila:'b-planejamento', pendente:'b-pendente', aguardando:'b-aguardando', paralisado:'b-paralisado' };
var STATUS_LABEL  = { andamento:'Em andamento', atrasado:'Atrasado', ok:'Concluído', planejamento:'A iniciar', fila:'Em fila', pendente:'Pendente', aguardando:'Aguardando requisitante', paralisado:'Paralisado', naoaplica:'Não se aplica' };

// ════════════════════════════════════════════════════════════════
// RENDER — Constrói o Gantt no DOM a partir dos dados filtrados
// ════════════════════════════════════════════════════════════════
/*
 * render(filtered)
 * Reconstrói o #gantt-table do zero a cada chamada.
 * Parâmetro: filtered → array de processos já filtrados e ordenados.
 *
 * Sequência de construção:
 *   1. Calcula o intervalo de meses (getRange)
 *   2. Monta o cabeçalho de anos/meses (.gh-wrap)
 *   3. Para cada processo:
 *      a. Cria linha de processo (.process-row) com:
 *         - Botão +/− de expansão (toggleExpand)
 *         - Número SUAP (se existir e não for placeholder)
 *         - Nome do processo truncado (ellipsis)
 *         - Barra de progresso colorida (pc2: ok/bad/plan)
 *         - Barra do Gantt colorida por modalidade (b-pe/b-cd/b-cc)
 *         - Eventos hover/click para tooltip de processo
 *      b. Para cada etapa do processo:
 *         - Cria linha de etapa (.etapa-row, oculta por padrão)
 *         - Barra baseline (prazo previsto — faixa fina cinza)
 *         - Barra real (prazo realizado — colorida por status)
 *         - Eventos hover para tooltip de etapa
 *   4. Adiciona a linha "Hoje" (linha dourada vertical)
 *   5. Atualiza os KPIs (updateKPIs)
 */
function render(filtered) {
  var tidx  = todayIdx();
  var range = getRange(filtered.length ? filtered : DATA);
  var cw    = getCellW();
  var nMeses = range.end - range.start + 1;
  var barsW  = nMeses * cw;  // largura total da área de barras

  // Containers dos dois painéis
  var namesEl = document.getElementById('gantt-names');
  var barsEl  = document.getElementById('gantt-bars');
  namesEl.innerHTML = '';
  barsEl.innerHTML  = '';

  // ── Cabeçalho de meses/anos (só no painel direito) ──
  var ghWrap = document.createElement('div'); ghWrap.className = 'gh-wrap';
  ghWrap.style.width = barsW + 'px';
  var ghMos = document.createElement('div'); ghMos.className = 'gh-months';
  var TRIM_MOS = [0, 3, 6, 9];
  var curYear = null, ghYear = null, ghYearMos = null;
  for (var i = range.start; i <= range.end; i++) {
    var y = absToYear(i);
    if (y !== curYear) {
      if (ghYear) { ghYear.appendChild(ghYearMos); ghMos.appendChild(ghYear); }
      ghYear = document.createElement('div'); ghYear.className = 'gh-year';
      var ylbl = document.createElement('div'); ylbl.className = 'gh-year-lbl'; ylbl.textContent = y;
      ghYear.appendChild(ylbl);
      ghYearMos = document.createElement('div'); ghYearMos.className = 'gh-mos';
      curYear = y;
    }
    var moNum = ((i % 12) + 12) % 12;
    var isTrimKey = TRIM_MOS.indexOf(moNum) >= 0;
    var mo = document.createElement('div');
    mo.style.width = mo.style.minWidth = cw + 'px';
    if (escalaAtiva === 'trimestre') {
      mo.className = 'gh-mo' + (i === tidx ? ' cur-mo' : '') + (isTrimKey ? '' : ' trim-vazio');
      mo.textContent = isTrimKey ? MOS[moNum] : '';
    } else {
      mo.className = 'gh-mo' + (i === tidx ? ' cur-mo' : '');
      mo.textContent = MOS[moNum];
    }
    ghYearMos.appendChild(mo);
  }
  if (ghYear) { ghYear.appendChild(ghYearMos); ghMos.appendChild(ghYear); }
  ghWrap.appendChild(ghMos);
  var hdrEl = document.getElementById('gantt-header');
  hdrEl.innerHTML = '';
  hdrEl.appendChild(ghWrap);

  // ── Linhas: cria uma linha de nome e uma linha de barra para cada processo/etapa ──
  var TRIM_KEY = [0,3,6,9];

  function makeBarRow(cls) {
    var row = document.createElement('div');
    row.className = 'gr-row ' + cls;
    var gt = document.createElement('div'); gt.className = 'gt';
    gt.style.width = barsW + 'px';
    for (var mi = range.start; mi <= range.end; mi++) {
      var mc = document.createElement('div');
      var miNum = ((mi % 12) + 12) % 12;
      var isTKey = TRIM_KEY.indexOf(miNum) >= 0;
      mc.className = 'mo-cell' + (mi === tidx ? ' cur-mo' : '') +
                     (escalaAtiva === 'trimestre' && !isTKey ? ' trim-vazio' : '');
      mc.style.width = mc.style.minWidth = cw + 'px';
      gt.appendChild(mc);
    }
    row.appendChild(gt);
    return { row: row, gt: gt };
  }

  filtered.forEach(function(p) {
    // ── Linha de nome (painel esquerdo) ──
    var nameRow = document.createElement('div');
    nameRow.className = 'gl-row process-row'; nameRow.dataset.pid = p.id;
    var ebtn = document.createElement('div');
    ebtn.className = 'expand-btn' + (expanded[p.id] ? ' open' : '');
    ebtn.textContent = expanded[p.id] ? '−' : '+';
    ebtn.title = 'Expandir / recolher etapas';
    (function(pid){ ebtn.onclick = function(e){ e.stopPropagation(); toggleExpand(pid); }; })(p.id);
    // Cor da barra de progresso: azul CPII padrão; verde só quando 100% concluído.
    // O status (atrasado/andamento/planejamento) é comunicado pelo ícone de alerta
    // e pelas cores das barras do Gantt à direita — não mais pela cor do fill.
    var pc2 = (p.execucao === 100 || p.status === 'ok') ? 'done' : 'ok';
    var info = document.createElement('div'); info.className = 'name-info';
    info.style.cursor = 'pointer';
    info.title = 'Clique para expandir ou recolher as etapas';
    info.setAttribute('role', 'button');
    info.setAttribute('tabindex', '0');
    info.setAttribute('aria-expanded', expanded[p.id] ? 'true' : 'false');
    (function(pid, el){
      el.onclick = function(e){ e.stopPropagation(); toggleExpand(pid); };
      el.onkeydown = function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleExpand(pid);
        }
      };
    })(p.id, info);
    info.innerHTML =
      (p.num && p.num.indexOf('SEL-') !== 0 ? '<span class="proc-num">N° ' + esc(p.num) + '</span>' : '') +
      '<span class="proc-name" title="' + esc(p.nome) + '">' + esc(p.nome) + '</span>' +
      '<div class="proc-pbar-wrap">' +
        '<div class="proc-pbar"><div class="proc-pbar-fill ' + pc2 + '" style="width:' + p.execucao + '%"></div></div>' +
        '<span class="proc-pbar-pct">' + p.execucao + '%</span>' +
      '</div>';
    nameRow.append(ebtn, info);

    // Ícone de alerta à direita da linha — varia por status:
    //   atrasado   → ícone vermelho (exclamação)
    //   aguardando → ícone laranja (relógio/espera)
    //   paralisado → ícone roxo (proibido)
    // Desaparece quando execucao === 100 (barra verde já comunica conclusão).
    if (p.execucao < 100) {
      if (p.status === 'atrasado') {
        var motivoIcone = motivoProcessoExibivel_(p);
        var alertIcon = document.createElement('div');
        alertIcon.className = 'proc-alert';
        alertIcon.title = 'Processo atrasado' + (p.motivo ? ' — ' + p.motivo.substring(0, 80) : '');
        alertIcon.title = 'Processo atrasado' + (motivoIcone ? ' - ' + motivoIcone.substring(0, 80) : '');
        alertIcon.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="#b02035" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<circle cx="12" cy="12" r="10"/>' +
            '<line x1="12" y1="8" x2="12" y2="12"/>' +
            '<line x1="12" y1="16" x2="12.01" y2="16"/>' +
          '</svg>';
        nameRow.appendChild(alertIcon);
      } else if (p.status === 'aguardando') {
        var warnIcon = document.createElement('div');
        warnIcon.className = 'proc-alert';
        warnIcon.title = 'Aguardando requisitante — processo parado dependendo de ação do setor requisitante';
        warnIcon.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="#c0622a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<circle cx="12" cy="12" r="10"/>' +
            '<polyline points="12 6 12 12 16 14"/>' +
          '</svg>';
        nameRow.appendChild(warnIcon);
      } else if (p.status === 'paralisado') {
        var paralIcon = document.createElement('div');
        paralIcon.className = 'proc-alert';
        paralIcon.title = 'Processo paralisado — interrupção por fato extraordinário, sem prazo de retomada';
        paralIcon.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="#7d3c98" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<circle cx="12" cy="12" r="10"/>' +
            '<line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>' +
          '</svg>';
        nameRow.appendChild(paralIcon);
      }
    }

    namesEl.appendChild(nameRow);

    // ── Linha de barra (painel direito) ──
    var br = makeBarRow('process-row'); br.row.dataset.pid = p.id;
    var bwrap = document.createElement('div'); bwrap.className = 'bar-wrap';
    bwrap.style.left  = barX(p.inicio, range.start) + 'px';
    bwrap.style.width = barW(p.inicio, p.fim) + 'px';
    var bar = document.createElement('div');
    var modClass = p.modalidade === 'CD' ? 'b-cd' : p.modalidade === 'CC' ? 'b-cc' : 'b-pe';
    bar.className = 'bar ' + modClass; bar.style.width = '100%';
    bwrap.appendChild(bar); br.gt.appendChild(bwrap);
    barsEl.appendChild(br.row);

    (function(proc, bw){
      bw.addEventListener('mouseenter', function(e){ if (!ttPinned) showProcTT(e, proc); });
      bw.addEventListener('mousemove',  function(e){ moveTT(e); });
      bw.addEventListener('mouseleave', hideTT);
      bw.addEventListener('click',      function(e){ pinTT(e, proc); });
    })(p, bwrap);

    // ── Linhas de etapas ──
    p.etapas.forEach(function(et) {
      if (et.prazo_ini === null) return;
      var visCls = expanded[p.id] ? ' visible' : '';

      // Nome da etapa (painel esquerdo)
      var enr = document.createElement('div');
      enr.className = 'gl-row etapa-row' + visCls; enr.dataset.pid = p.id;
      var indent = document.createElement('div'); indent.className = 'etapa-indent';
      var dot = document.createElement('div'); dot.className = 'etapa-dot';
      var dotC = { ok:'var(--success)', atrasado:'var(--danger)', andamento:'var(--accent2)', pendente:'var(--muted)', planejamento:'var(--warning)' };
      dot.style.background = dotC[et.status] || 'var(--muted)';
      var en = document.createElement('div'); en.className = 'etapa-name'; en.textContent = et.nome;
      enr.append(indent, dot, en);
      namesEl.appendChild(enr);

      // Barra da etapa (painel direito)
      var ebr = makeBarRow('etapa-row' + visCls); ebr.row.dataset.pid = p.id;

      // Baseline (prazo planejado)
      var bbase = document.createElement('div'); bbase.className = 'bar-wrap';
      bbase.style.left = barX(et.prazo_ini, range.start) + 'px';
      bbase.style.width = barW(et.prazo_ini, et.prazo_fim) + 'px';
      bbase.style.top = 'calc(50% + 8px)'; bbase.style.transform = 'none';
      var barBase = document.createElement('div'); barBase.className = 'bar b-baseline'; barBase.style.width = '100%';
      bbase.appendChild(barBase); ebr.gt.appendChild(bbase);

      // Barra real
      if (et.real_ini !== null) {
        var realFim = et.real_fim !== null ? et.real_fim : et.prazo_fim;
        var breal = document.createElement('div'); breal.className = 'bar-wrap';
        breal.style.left  = barX(et.real_ini, range.start) + 'px';
        breal.style.width = barW(et.real_ini, realFim) + 'px';
        var barReal = document.createElement('div');
        barReal.className = 'bar ' + (STATUS_COLORS[et.status] || 'b-pendente');
        barReal.style.width = '100%';
        barReal.textContent = et.status==='ok' ? (et.adiantamento > 0 ? '−'+et.adiantamento+'d' : '✓') : et.status==='atrasado' ? '+'+et.dias+'d' : et.status==='andamento' ? '…' : '';
        breal.appendChild(barReal); ebr.gt.appendChild(breal);
        (function(proc, etapa){
          breal.addEventListener('mouseenter', function(e){ showEtapaTT(e, proc, etapa); });
          breal.addEventListener('mousemove',  function(e){ moveTT(e); });
          breal.addEventListener('mouseleave', hideTT);
        })(p, et);
      }
      barsEl.appendChild(ebr.row);
    });
  });

  // ── Filler de grade: atualiza variáveis CSS para alinhar linhas verticais ──

  // ── Linha "Hoje" ──
  _todayRange = range;
  document.querySelectorAll('.today-line').forEach(function(x){ x.remove(); });
  var tl = document.createElement('div'); tl.className = 'today-line'; tl.id = 'today-line';
  var grBody = document.getElementById('gr-panel-body');
  if (grBody) grBody.appendChild(tl);

  // Linhas verticais tracejadas no fundo do gr-panel-body:
  // Ficam alinhadas às colunas reais (mesmo cw e mesmo offset de início).
  // background-size limita a largura coberta pelas verticais a barsW,
  // enquanto as horizontais cobrem 100% (background-size padrão = 100%).
  if (grBody) {
    var hGrad = 'repeating-linear-gradient(to bottom,' +
      'transparent 0px,transparent calc(var(--row-h) - 1px),' +
      'var(--border) calc(var(--row-h) - 1px),var(--border) var(--row-h))';
    // No trimestre as bordas visíveis são a cada 3 meses (Jan/Abr/Jul/Out)
    // Calcula o offset para alinhar o gradiente com a primeira coluna trimestral do range
    var vStep, nextTrimOffset;
    if (escalaAtiva === 'trimestre') {
      vStep = cw * 3; // 135px por trimestre
      // Quantos meses desde o início do range até o próximo Jan/Abr/Jul/Out
      var startMoNum = ((range.start % 12) + 12) % 12;
      var TRIM_KEYS_BG = [0, 3, 6, 9];
      nextTrimOffset = 0;
      for (var ti = 0; ti < 3; ti++) {
        if (TRIM_KEYS_BG.indexOf(((startMoNum + ti) % 12)) >= 0) {
          nextTrimOffset = ti; break;
        }
      }
    } else {
      vStep = cw;
      nextTrimOffset = 0;
    }
    var vGrad = 'repeating-linear-gradient(to right,' +
      'transparent 0px,transparent ' + (vStep - 1) + 'px,' +
      'rgba(176,200,222,.55) ' + (vStep - 1) + 'px,' +
      'rgba(176,200,222,.55) ' + vStep + 'px)';
    // background-position-x: desloca o tile para que a linha (em vStep-1 dentro do tile)
    // caia exatamente na borda direita da primeira célula trimestral do range.
    // Fórmula: P = (nextTrimOffset + 1)*cw - vStep
    var vPosX = escalaAtiva === 'trimestre' ? ((nextTrimOffset + 1) * cw - vStep) : 0;
    // O tile vertical começa em vPosX (pode ser negativo).
    // Para cobrir até barsW, o size precisa ser barsW + |vPosX|
    var vSizeW = barsW + Math.abs(vPosX);
    grBody.style.backgroundImage      = vGrad + ',' + hGrad;
    grBody.style.backgroundSize       = vSizeW + 'px 100%, 100% auto';
    grBody.style.backgroundRepeat     = 'no-repeat, repeat-y';
    grBody.style.backgroundPosition   = vPosX + 'px 0px, 0px 0px';
    grBody.style.backgroundAttachment = 'local, local';
  }

  repositionTodayLine();
  updateKPIs(filtered);
}

/*
 * toggleExpand(pid)
 * Alterna a visibilidade das linhas de etapa de um processo.
 * Atualiza o objeto 'expanded' (estado global) e:
 *   - Adiciona/remove a classe "visible" em todas as etapa-row do processo
 *   - Troca o ícone do botão (+/−) e a classe "open"
 */
function toggleExpand(pid) {
  expanded[pid] = !expanded[pid];
  document.querySelectorAll('.etapa-row[data-pid="' + pid + '"]').forEach(function(r){
    r.classList.toggle('visible', expanded[pid]);
  });
  var btn = document.querySelector('.process-row[data-pid="' + pid + '"] .expand-btn');
  if (btn) { btn.classList.toggle('open', expanded[pid]); btn.textContent = expanded[pid] ? '−' : '+'; }
  var info = document.querySelector('.process-row[data-pid="' + pid + '"] .name-info');
  if (info) info.setAttribute('aria-expanded', expanded[pid] ? 'true' : 'false');
}

// ════════════════════════════════════════════════════════════════
// TOOLTIPS — balões de detalhes ao passar/clicar nas barras
// ════════════════════════════════════════════════════════════════
/*
 * Há dois tipos de tooltip:
 *   showProcTT(e, p)      → tooltip do processo (barra principal)
 *   showEtapaTT(e, p, et) → tooltip da etapa (barra de etapa)
 *
 * Fluxo normal: mouseenter → showXTT → positionTT → show
 *               mousemove  → moveTT (reposiciona enquanto o mouse anda)
 *               mouseleave → hideTT (oculta se não estiver fixado)
 *
 * Fluxo fixado (pinned): click na barra → pinTT
 *   O tooltip fica visível e clicável (pointer-events:all).
 *   Clicar fora do tooltip o libera (event listener no document).
 *   Clicar novamente na barra também o libera.
 */
var tt = document.getElementById('tt');
function motivoAtrasoValido_(motivo) {
  var m = String(motivo || '').trim();
  if (!m) return false;
  if (m.toLowerCase() === 'a verificar') return false;
  if (/^RETORNO PARA FILA:/i.test(m)) return false;
  return true;
}
function motivoProcessoExibivel_(p) {
  var etapas = Array.isArray(p && p.etapas) ? p.etapas : [];
  for (var i = etapas.length - 1; i >= 0; i--) {
    var et = etapas[i];
    if (et && et.status === 'ok' && et.dias > 0 && motivoAtrasoValido_(et.motivo)) {
      return String(et.motivo).trim();
    }
  }
  return '';
}
var ttPinned = false;  // true quando o tooltip está fixado por clique

/*
 * _modalidadeChip_(mod)
 * Retorna um "chip" HTML identificando a modalidade do processo, com a mesma
 * convenção de cor das barras do Gantt (dourado = Contratação Direta,
 * azul = Pregão, verde = Concorrência). Serve para o gestor identificar de
 * relance, dentro do tooltip, que se trata de uma contratação direta.
 */
function _subtipoCDLabel_(tipoCD) {
  // Normaliza o subtipo da Contratação Direta para um rótulo amigável, na mesma
  // nomenclatura do app de gestão (art. 74/75 da Lei 14.133/2021).
  var t = (tipoCD || '').toLowerCase();
  if (!t) return '';
  if (t.indexOf('ades') >= 0)          return 'Adesão (carona)';
  if (t.indexOf('com disputa') >= 0)   return 'Dispensa c/ disputa';
  if (t.indexOf('sem disputa') >= 0)   return 'Dispensa s/ disputa';
  if (t.indexOf('inexig') >= 0)        return 'Inexigibilidade';
  if (t.indexOf('dispensa') >= 0)      return 'Dispensa';
  return tipoCD;  // valor livre não previsto — mostra como veio
}

function _modalidadeChip_(mod, tipoCD) {
  var m = (mod || '').toUpperCase();
  var info = m === 'CD' ? { txt: 'Contratação Direta', cor: '201,162,42' }
           : m === 'CC' ? { txt: 'Concorrência',        cor: '45,80,22'   }
           : m === 'PE' ? { txt: 'Pregão Eletrônico',   cor: '30,78,140'  }
           : null;
  if (!info) return '';
  // Para Contratação Direta, acrescenta o subtipo (adesão, dispensa, etc.).
  var sub = m === 'CD' ? _subtipoCDLabel_(tipoCD) : '';
  var texto = info.txt + (sub ? ' · ' + sub : '');
  return '<span class="tt-mod" style="background:rgba(' + info.cor + ',.15);' +
         'border:1px solid rgba(' + info.cor + ',.55);color:var(--text);' +
         'font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;' +
         'display:inline-block;letter-spacing:.2px">' + esc(texto) + '</span>';
}

/*
 * showProcTT(e, p)
 * Monta o HTML do tooltip de processo com: status, % de execução,
 * barra de progresso inline, período, link do SUAP.
 * Se o processo estiver atrasado e tiver motivo, exibe caixa de alerta.
 */
function showProcTT(e, p) {
  // Cancela hide pendente — estamos passando direto para outra barra
  if (_ttHideTimer) { clearTimeout(_ttHideTimer); _ttHideTimer = null; }
  var pc = p.status === 'atrasado' ? 'bad'
         : p.status === 'planejamento' ? 'plan'
         : 'ok';
  var statusV = p.status === 'atrasado'
    ? '<span class="tt-v bad">'  + STATUS_LABEL[p.status] + '</span>'
    : p.status === 'andamento'
    ? '<span class="tt-v warn">' + STATUS_LABEL[p.status] + '</span>'
    : p.status === 'aguardando'
    ? '<span class="tt-v" style="color:#c0622a">' + STATUS_LABEL[p.status] + '</span>'
    : p.status === 'paralisado'
    ? '<span class="tt-v" style="color:#7d3c98">' + STATUS_LABEL[p.status] + '</span>'
    : '<span class="tt-v ok">' + (STATUS_LABEL[p.status] || p.status) + '</span>';
  // Bloco de conclusão institucional: quando o processo está 100% executado,
  // mostra uma caixa verde com check sinalizando que o SEL cumpriu sua parte.
  // Usa o mesmo SVG da KPI "Concluídos". Aparece em qualquer processo com
  // execucao===100 (inclusive atrasados já finalizados), porque a mensagem
  // é sobre a conclusão das etapas sob responsabilidade do SEL.
  var isConcluido = (p.execucao === 100) || p.status === 'ok';
  var successHtml = isConcluido
    ? '<div class="tt-success">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="#2ecc71" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' +
        '</svg>' +
        '<div><b>Processo concluído</b>Todas as etapas a cargo do Setor de Licitações foram realizadas.</div>' +
      '</div>'
    : '';
  // Trunca o motivo em 200 caracteres para não sobrecarregar o tooltip.
  // O texto completo continua disponível na planilha e nas etapas expandidas.
  var motivoProc = motivoProcessoExibivel_(p);
  var MOTIVO_MAX = 200;
  var motivoTrunc = p.motivo && p.motivo.length > MOTIVO_MAX
    ? p.motivo.substring(0, MOTIVO_MAX).trimEnd() + '…'
    : (p.motivo || '');
  motivoTrunc = motivoProc && motivoProc.length > MOTIVO_MAX
    ? motivoProc.substring(0, MOTIVO_MAX).trimEnd() + '...'
    : motivoProc;

  // Caixa de alerta/aviso varia conforme o status do processo:
  //   atrasado   → caixa vermelha com motivo do atraso
  //   aguardando → caixa laranja explicando que estamos aguardando o requisitante
  //   paralisado → caixa roxa indicando interrupção extraordinária
  var alertHtml = '';
  if (!isConcluido) {
    if (p.status === 'atrasado' && motivoTrunc)
      alertHtml = '<div class="tt-alert"><b>⚠ Motivo do atraso</b>' + esc(motivoTrunc) + '</div>';
    else if (p.status === 'aguardando')
      alertHtml = '<div class="tt-warn"><b>⏳ Aguardando requisitante</b>Processo parado. Dependemos de resposta ou ação do setor requisitante para prosseguir.</div>';
    else if (p.status === 'paralisado')
      alertHtml = '<div class="tt-paral"><b>⛔ Paralisado</b>Processo interrompido por fato extraordinário. Retomada sem prazo definido.</div>';
  }
  var hintHtml = isConcluido
    ? '<div class="tt-hint">💡 Clique no nome do processo ou em <b>+</b> para revisar o cronograma executado</div>'
    : (p.status === 'atrasado' || p.status === 'aguardando' || p.status === 'paralisado')
    ? '<div class="tt-hint">🔍 Clique no nome do processo ou em <b>+</b> para expandir as etapas</div>'
    : '<div class="tt-hint">💡 Clique no nome do processo ou em <b>+</b> para ver o cronograma por etapa</div>';
  var corPct = pc === 'bad' ? 'danger' : pc === 'plan' ? 'muted' : 'accent2';
  var periodoLabel = p.d0_simulado ? 'Previsão exibida' : 'Período';
  var filaHtml = p.d0_simulado
    ? '<div class="tt-warn"><b>Fila de prioridade</b>Datas estimadas apenas para visualização. O início real será definido pelo SEL no app de gestão.</div>'
    : '';
  tt.innerHTML =
    '<div class="tt-head">' + (p.num && p.num.indexOf('SEL-') !== 0 ? 'N° ' + esc(p.num) : esc(p.nome)) + '</div>' +
    (_modalidadeChip_(p.modalidade, p.tipoCD) ? '<div class="tt-row"><span class="tt-k">Modalidade</span>' + _modalidadeChip_(p.modalidade, p.tipoCD) + '</div>' : '') +
    '<div class="tt-row"><span class="tt-k">Status</span>' + statusV + '</div>' +
    '<div class="tt-row"><span class="tt-k">Execução</span>' +
      '<div class="pbar-wrap" style="min-width:120px">' +
        '<div class="pbar"><div class="pbar-fill ' + pc + '" style="width:' + p.execucao + '%"></div></div>' +
        '<span class="pbar-pct" style="color:var(--' + corPct + ')">' + p.execucao + '%</span>' +
      '</div></div>' +
    '<div class="tt-row"><span class="tt-k">' + periodoLabel + '</span><span class="tt-v">' + isoToDD_MM(p.ini_iso) + ' – ' + isoToDD_MM_YY(p.fim_iso) + '</span></div>' +
    successHtml + alertHtml + filaHtml + hintHtml +
    '<div class="tt-sep"></div>' +
    '<div class="tt-k" style="font-size:13px;margin-bottom:3px">Link no SUAP</div>' +
    '<a class="tt-link" href="' + esc(p.suap) + '" target="_blank">' + (p.suap === '#' ? '(não configurado)' : esc(p.suap)) + '</a>' +
    '<div class="tt-hint" style="margin-top:6px">📌 Clique na barra para fixar</div>';
  positionTT(e); tt.classList.add('show');
}

/*
 * showEtapaTT(e, p, et)
 * Monta o tooltip de etapa com: status, prazo 638/2026, prazo real,
 * atraso em dias (se > 0) e motivo do atraso (se informado).
 * Nota: dias de atraso é exibido sempre que et.dias > 0, independente
 * do status — isso permite mostrar o atraso mesmo em etapas "em andamento".
 */
function showEtapaTT(e, p, et) {
  // Cancela hide pendente — estamos passando direto para outra barra
  if (_ttHideTimer) { clearTimeout(_ttHideTimer); _ttHideTimer = null; }
  var statusV = et.status === 'atrasado' ? '<span class="tt-v bad">' + STATUS_LABEL[et.status] + '</span>'
    : et.status === 'andamento' ? '<span class="tt-v warn">' + STATUS_LABEL[et.status] + '</span>'
    : et.status === 'ok' ? '<span class="tt-v ok">' + STATUS_LABEL[et.status] + '</span>'
    : '<span class="tt-v">' + (STATUS_LABEL[et.status] || et.status) + '</span>';
  var prazoStr = isoToDD_MM(et.ini_iso) + ' → ' + isoToDD_MM_YY(et.fim_iso || null);
  // "Realizado": se DataRealizacao preenchida, mostra a data real exata;
  // caso contrário usa o índice de mês calculado (comportamento anterior).
  // "Realizado" só aparece quando DataRealizacao foi preenchida na planilha.
  // Etapas em andamento ou não iniciadas ficam sem esta linha.
  var realizadoInfo = periodoRealizadoEtapa_(et);
  var diasHtml   = (et.status === 'ok' && et.dias && et.dias > 0) ? '<div class="tt-row"><span class="tt-k">Atraso registrado</span><span class="tt-v bad">+' + et.dias + ' dia' + (et.dias > 1 ? 's' : '') + '</span></div>'
    : (et.status === 'ok' && et.adiantamento && et.adiantamento > 0) ? '<div class="tt-row"><span class="tt-k">Adiantamento</span><span class="tt-v ok">−' + et.adiantamento + ' dia' + (et.adiantamento > 1 ? 's' : '') + '</span></div>' : '';
  // Motivo só aparece se houver atraso real (et.dias > 0) — evita mostrar
  // motivos preenchidos manualmente em etapas que não atrasaram de fato.
  var motivoHtml = '';
  if (et.status === 'ok' && et.dias > 0) {
    if (motivoAtrasoValido_(et.motivo)) {
      motivoHtml = '<div class="tt-alert"><b>⚠ Motivo do atraso</b>' + esc(et.motivo) + '</div>';
    } else {
      motivoHtml = '<div class="tt-alert"><b>⚠ Motivo do atraso</b>A verificar</div>';
    }
  }

  // Contagem de dias até o prazo, calculada em tempo real a partir de et.fim_iso / et.ini_iso.
  // Regras por status (oculta totalmente para etapa CONCLUÍDA — 'ok'):
  //   - 'andamento':    Falta X dias / Vence hoje / Venceu há X dias
  //   - 'atrasado':     Venceu há X dias (cor bad) — reforça o atraso já registrado
  //   - 'pendente'/não iniciada: Começa em X dias / Começa hoje (cor muted)
  //   - 'ok' (concluída): nada, conforme solicitação do Samuel (23/04 noite → 24/04)
  var prazoRestanteHtml = '';
  if (et.status !== 'ok' && (et.fim_iso || et.ini_iso)) {
    var _hoje = new Date(); _hoje.setHours(0,0,0,0);
    var _diaMs = 86400000;
    if (et.status === 'andamento' || et.status === 'atrasado') {
      // Etapa em andamento: compara a data de término prevista com hoje
      if (et.fim_iso) {
        var _fim = new Date(et.fim_iso + 'T00:00:00');
        var _diff = Math.round((_fim.getTime() - _hoje.getTime()) / _diaMs);
        if (_diff > 0) {
          var _cor = _diff <= 7 ? 'warn' : 'ok';
          prazoRestanteHtml = '<div class="tt-row"><span class="tt-k">Prazo restante</span><span class="tt-v ' + _cor + '">Falta ' + _diff + ' dia' + (_diff > 1 ? 's' : '') + '</span></div>';
        } else if (_diff === 0) {
          prazoRestanteHtml = '<div class="tt-row"><span class="tt-k">Prazo restante</span><span class="tt-v warn">Vence hoje</span></div>';
        } else {
          prazoRestanteHtml = '<div class="tt-row"><span class="tt-k">Prazo restante</span><span class="tt-v bad">Venceu há ' + (-_diff) + ' dia' + (_diff < -1 ? 's' : '') + '</span></div>';
        }
      }
    } else {
      // Etapa ainda não iniciada — mostra quanto falta para começar (a partir de ini_iso em cascata).
      // "Atrasado há X dias" só faz sentido se o processo ainda está em curso;
      // processos concluídos (p.execucao===100 ou p.status==='ok') não devem
      // exibir aviso de atraso em etapas não iniciadas (eram etapas opcionais ou
      // fora do escopo que o sistema mantém como planejamento).
      if (et.ini_iso) {
        var _ini = new Date(et.ini_iso + 'T00:00:00');
        var _diffI = Math.round((_ini.getTime() - _hoje.getTime()) / _diaMs);
        if (_diffI > 0) {
          prazoRestanteHtml = '<div class="tt-row"><span class="tt-k">Início previsto</span><span class="tt-v" style="color:var(--muted)">Começa em ' + _diffI + ' dia' + (_diffI > 1 ? 's' : '') + '</span></div>';
        } else if (_diffI === 0) {
          prazoRestanteHtml = '<div class="tt-row"><span class="tt-k">Início previsto</span><span class="tt-v warn">Começa hoje</span></div>';
        } else if (p.execucao < 100 && p.status !== 'ok') {
          // Só mostra "Atrasado há X dias" se o processo ainda não foi concluído
          prazoRestanteHtml = '<div class="tt-row"><span class="tt-k">Início previsto</span><span class="tt-v bad">Atrasado há ' + (-_diffI) + ' dia' + (_diffI < -1 ? 's' : '') + '</span></div>';
        }
      }
    }
  }

  tt.innerHTML =
    '<div class="tt-head">' + esc(p.num) + ' · ' + esc(et.nome) + '</div>' +
    '<div class="tt-row"><span class="tt-k">Status</span>' + statusV + '</div>' +
    '<div class="tt-row"><span class="tt-k">Prazo 638/2026</span><span class="tt-v">' + prazoStr + '</span></div>' +
    (realizadoInfo ? '<div class="tt-row"><span class="tt-k">' + realizadoInfo.label + '</span><span class="tt-v">' + realizadoInfo.texto + '</span></div>' : '') +
    prazoRestanteHtml + diasHtml + motivoHtml;
  positionTT(e); tt.classList.add('show');
}

/*
 * positionTT(e) — calcula a posição ideal do tooltip para não sair da tela
 * Tenta posicionar abaixo-direita do cursor. Se não couber, inverte o eixo.
 * Garante margem mínima de 4px das bordas da viewport.
 */
function positionTT(e) {
  var m = 14;  // margem entre o cursor e a borda do tooltip
  // Mede o tooltip real após renderização
  tt.style.left = '0px'; tt.style.top = '0px';
  var w = tt.offsetWidth  || 280;
  var h = tt.offsetHeight || 200;
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  // Tenta abaixo-direita; se não couber, inverte o eixo
  var l = e.clientX + m;
  var t = e.clientY + m;
  if (l + w > vw - 4) l = e.clientX - w - m;
  if (t + h > vh - 4) t = e.clientY - h - m;
  if (l < 4) l = 4;
  if (t < 4) t = 4;
  tt.style.left = l + 'px';
  tt.style.top  = t + 'px';
}
// moveTT → reposiciona o tooltip quando o mouse se move (só se não estiver fixado)
//         + cancela um hide pendente (mouse voltou pra barra)
function moveTT(e) {
  if (_ttHideTimer) { clearTimeout(_ttHideTimer); _ttHideTimer = null; }
  if (tt.classList.contains('show') && !ttPinned) positionTT(e);
}
// hideTT → oculta o tooltip ao sair da barra (só se não estiver fixado)
//   Delay de ~150ms: tempo curto o bastante para não confundir com a barra
//   seguinte, mas longo o suficiente para evitar cintilação quando o mouse
//   passa por pequenos gaps entre as barras (ex: baseline / barra real).
//   Se o mouse entrar em outra barra durante o delay, moveTT cancela o hide
//   e o showXTT() substitui o conteúdo do tooltip sem piscar.
var _ttHideTimer = null;
function hideTT() {
  if (ttPinned) return;
  if (_ttHideTimer) clearTimeout(_ttHideTimer);
  _ttHideTimer = setTimeout(function() {
    tt.classList.remove('show');
    _ttHideTimer = null;
  }, 150);
}

/*
 * pinTT(e, p) — fixa ou libera o tooltip ao clicar na barra
 * Se já estava fixado: libera (remove pinned e show)
 * Se não estava fixado: exibe o tooltip de processo e marca como fixado
 */
function pinTT(e, p) {
  e.stopPropagation();
  if (ttPinned) { ttPinned = false; tt.classList.remove('pinned','show'); return; }
  showProcTT(e, p);
  ttPinned = true; tt.classList.add('pinned');
}
// Clicar fora do tooltip também o libera
document.addEventListener('click', function(e) {
  if (ttPinned && !tt.contains(e.target)) { ttPinned = false; tt.classList.remove('pinned','show'); }
});

// ════════════════════════════════════════════════════════════════
// FILTROS E KPIs
// ════════════════════════════════════════════════════════════════

/*
 * setStatusFilter(btn, s)
 * Ativa o botão de status clicado e atualiza a variável activeStatus.
 * s = '' (Todos) | 'andamento' | 'atrasado' | 'planejamento'
 * Em seguida chama applyFilters() para redesenhar o Gantt.
 */
function setStatusFilter(btn, s) {
  activeStatus = s;
  document.querySelectorAll('.status-btn').forEach(function(b) {
    b.className = 'status-btn';
    if (b.dataset.s === s) {
      var cls = {'':'active-all', andamento:'active-and', atrasado:'active-atra', planejamento:'active-plan'};
      b.classList.add(cls[s] || 'active-all');
    }
  });
  salvarFiltros();
  applyFilters();
}

/*
 * setEscala(btn, e)
 * Alterna a escala temporal do Gantt: 'mes' | 'trimestre'
 * Atualiza o botão ativo e redesenha o Gantt via applyFilters().
 */
/*
 * repositionTodayLine()
 * Calcula a posição X da linha "Hoje" em coordenadas de viewport (fixed),
 * levando em conta o scroll horizontal do gantt-outer e o LABEL_W atual.
 * Chamada no render() e a cada evento de scroll.
 */
function repositionTodayLine() {
  if (!_todayRange) return;
  var tl = document.getElementById('today-line');
  if (!tl) return;
  var grBody = document.getElementById('gr-panel-body');
  var grHdr  = document.getElementById('gr-panel-hdr');
  if (!grBody) return;
  var bodyRect = grBody.getBoundingClientRect();
  var hdrRect  = grHdr ? grHdr.getBoundingClientRect() : bodyRect;
  var tidx = todayIdx();
  var cw   = getCellW();
  // X da linha: posição do mês dentro da área de barras - scroll atual
  var tableX = (tidx - _todayRange.start) * cw + cw / 2;
  var viewX  = bodyRect.left + tableX - grBody.scrollLeft;
  var visible = viewX >= bodyRect.left && viewX <= bodyRect.right;
  tl.style.display = visible ? '' : 'none';
  if (visible) {
    // A linha se estende por todo o gr-panel-body (barras + filler),
    // igual às linhas verticais da grade — como uma planilha completa
    tl.style.left   = viewX + 'px';
    tl.style.top    = bodyRect.top + 'px';
    tl.style.height = bodyRect.height + 'px';
  }
}

function setEscala(btn, e) {
  escalaAtiva = e;
  document.querySelectorAll('.escala-btn').forEach(function(b) {
    b.classList.toggle('active-escala', b.dataset.e === e);
  });
  salvarFiltros();
  applyFilters();
}

// NOTA: salvarFiltros() / restaurarFiltros() estão definidos mais abaixo
// (versão via localStorage, que persiste busca, status, escala e ano).
// Uma versão antiga via sessionStorage existia aqui e foi removida — por ser
// declarada antes, era silenciosamente sobrescrita pela definição posterior.

/*
 * populateAnoSelect()
 * Lê os anos presentes nos dados e popula o <select> de filtro por ano.
 * Chamada uma única vez após carregar os dados.
 */
function populateAnoSelect() {
  // Varre início E fim de cada processo (e das etapas) para listar todos os
  // anos presentes nos dados. Sem limite superior — acompanha crescimento
  // natural do Gantt conforme processos se estendem para anos futuros.
  var anos = {};
  DATA.forEach(function(p) {
    if (p.inicio !== null && p.inicio !== undefined) {
      anos[ANO_BASE + Math.floor(p.inicio / 12)] = true;
    }
    if (p.fim !== null && p.fim !== undefined) {
      anos[ANO_BASE + Math.floor(p.fim / 12)] = true;
    }
  });
  var sel = document.getElementById('ano-select');
  if (!sel) return;
  // Limpa opções antigas (exceto "Todos")
  while (sel.options.length > 1) sel.remove(1);
  Object.keys(anos).sort().forEach(function(y) {
    var opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    sel.appendChild(opt);
  });
}

/*
 * setAnoFilter(val)
 * Atualiza activeAno e redesenha o Gantt.
 */
function setAnoFilter(val) {
  activeAno = val;
  salvarFiltros();
  applyFilters();
}

/*
 * isMobile()
 * Detecta se a tela atual é mobile (≤ 768px).
 */
function isMobile() {
  return window.innerWidth <= 768;
}

/* Estado do filtro de modalidade (mobile) */
var activeMobModal = '';

/*
 * setMobModal(btn, val)
 * Filtra os cards mobile por modalidade: '' = todos, 'pe', 'cd'.
 */
function setMobModal(btn, val) {
  activeMobModal = val;
  document.querySelectorAll('.mob-modal-btn').forEach(function(b) {
    b.className = 'mob-modal-btn';
  });
  btn.classList.add(val === 'pe' ? 'active-pe' : val === 'cd' ? 'active-cd' : 'active-all');
  applyFilters();
}

/*
 * toggleMobLinks() / closeMobLinks()
 * Abre/fecha o menu flutuante de links no mobile pequeno.
 */
function toggleMobLinks() {
  var menu = document.getElementById('mob-links-menu');
  if (menu) menu.classList.toggle('open');
}
function closeMobLinks() {
  var menu = document.getElementById('mob-links-menu');
  if (menu) menu.classList.remove('open');
}
// Fecha o menu ao clicar fora dele
document.addEventListener('click', function(e) {
  var btn = document.getElementById('mob-links-btn');
  var menu = document.getElementById('mob-links-menu');
  if (menu && btn && !menu.contains(e.target) && e.target !== btn) {
    menu.classList.remove('open');
  }
});

/*
 * statusLabel(status) / statusBadgeClass(status)
 * Retorna rótulo e classe CSS do badge de status para os cards mobile.
 */
function statusLabel(status, execucao) {
  if (status === 'ok' || execucao === 100) return 'Concluído';
  if (status === 'atrasado')    return 'Atrasado';
  if (status === 'aguardando')  return 'Aguardando';
  if (status === 'paralisado')  return 'Paralisado';
  if (status === 'andamento')   return 'Em andamento';
  if (status === 'fila')        return 'Em fila';
  if (status === 'planejamento') return 'A iniciar';
  return status;
}
function statusBadgeClass(status, execucao) {
  if (status === 'ok' || execucao === 100) return 'b-ok';
  if (status === 'atrasado')    return 'b-atrasado';
  if (status === 'aguardando')  return 'b-aguardando';
  if (status === 'paralisado')  return 'b-paralisado';
  if (status === 'andamento')   return 'b-andamento';
  return 'b-planejamento';
}

/*
 * etapaDotClass(statusEtapa)
 * Classe do ponto colorido de cada etapa no card expansível.
 */
function etapaDotClass(s) {
  if (!s) return 'c-plan';
  s = s.toLowerCase();
  if (s === 'ok' || s === 'concluída' || s === 'concluida') return 'c-ok';
  if (s === 'andamento' || s === 'em andamento') return 'c-and';
  if (s === 'atrasado')                       return 'c-atra';
  if (s.indexOf('aguardando') >= 0)            return 'c-agu';
  if (s === 'paralisado')                      return 'c-par';
  if (s === 'não se aplica' || s === 'nao se aplica') return 'c-na';
  if (s === 'atrasada' || s === 'atrasado')   return 'c-atra';
  return 'c-plan';
}

/*
 * renderMobileList(filtered)
 * Constrói a lista de cards de processo para visualização mobile.
 * Cada card mostra nome, badge de status e barra de progresso.
 * Ao tocar, expande a lista de etapas com status individual.
 */
function renderMobileList(filtered) {
  var container = document.getElementById('mobile-list');
  if (!container) return;
  container.innerHTML = '';

  // Aplicar filtro de modalidade (p.modalidade já vem como 'PE', 'CD' ou 'CC' do Codigo.gs)
  if (activeMobModal) {
    filtered = filtered.filter(function(p) {
      var m = (p.modalidade || '').toUpperCase();
      if (activeMobModal === 'pe') return m === 'PE' || m === 'CC';
      if (activeMobModal === 'cd') return m === 'CD';
      return true;
    });
  }

  if (!filtered.length) {
    var vazio = document.createElement('div');
    vazio.style.cssText = 'text-align:center;padding:40px 20px;color:var(--muted);font-size:14px;';
    vazio.textContent = 'Nenhum processo encontrado.';
    container.appendChild(vazio);
    return;
  }

  filtered.forEach(function(p) {
    var pct = p.execucao || 0;
    var isDone = p.status === 'ok' || pct === 100;
    var bc = statusBadgeClass(p.status, pct);
    var bl = statusLabel(p.status, pct);

    // Card wrapper
    var card = document.createElement('div');
    card.className = 'mob-card';

    // Header clicável
    var hdr = document.createElement('div');
    hdr.className = 'mob-card-header';
    hdr.setAttribute('role', 'button');
    hdr.setAttribute('aria-expanded', 'false');

    // Badge de status
    var badge = document.createElement('span');
    badge.className = 'mob-badge ' + bc;
    badge.textContent = bl;

    // Bloco de info (N° SUAP + nome + progresso)
    var info = document.createElement('div');
    info.className = 'mob-info';

    var num = document.createElement('div');
    num.className = 'mob-num';
    num.textContent = p.num || p.id || '';

    var nome = document.createElement('div');
    nome.className = 'mob-nome';
    nome.textContent = p.nome || '';

    var progWrap = document.createElement('div');
    progWrap.className = 'mob-prog-wrap';
    var pbar = document.createElement('div');
    pbar.className = 'mob-pbar';
    var fill = document.createElement('div');
    fill.className = 'mob-pbar-fill' + (isDone ? ' done' : '');
    fill.style.width = pct + '%';
    pbar.appendChild(fill);
    var pctEl = document.createElement('span');
    pctEl.className = 'mob-pct';
    pctEl.textContent = pct + '%';
    progWrap.appendChild(pbar);
    progWrap.appendChild(pctEl);

    info.appendChild(num);
    info.appendChild(nome);
    // Chip de modalidade — mesma identificação visual do tooltip do desktop.
    var chipHtml = _modalidadeChip_(p.modalidade, p.tipoCD);
    if (chipHtml) {
      var chipWrap = document.createElement('div');
      chipWrap.style.margin = '4px 0 2px';
      chipWrap.innerHTML = chipHtml;
      info.appendChild(chipWrap);
    }
    info.appendChild(progWrap);

    // Chevron
    var chev = document.createElement('div');
    chev.className = 'mob-chevron';
    chev.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

    hdr.appendChild(badge);
    hdr.appendChild(info);
    hdr.appendChild(chev);

    // Bloco de etapas (oculto por padrão)
    var etapasEl = document.createElement('div');
    etapasEl.className = 'mob-etapas';

    var etapas = p.etapas || [];
    if (etapas.length === 0) {
      var sem = document.createElement('div');
      sem.className = 'mob-etapa';
      sem.style.color = 'var(--muted)';
      sem.style.fontSize = '12px';
      sem.textContent = 'Sem etapas cadastradas.';
      etapasEl.appendChild(sem);
    } else {
      etapas.forEach(function(et) {
        var dotCls = etapaDotClass(et.status);
        var isConcluida = dotCls === 'c-ok';
        var isNA = dotCls === 'c-na';

        // Linha principal da etapa
        var linha = document.createElement('div');
        linha.className = 'mob-etapa';
        if (!isConcluida && !isNA) linha.style.cursor = 'pointer';

        // Ícone
        var dot = document.createElement('div');
        dot.className = 'mob-etapa-dot ' + dotCls;
        if (isConcluida) {
          dot.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        } else if (isNA) {
          dot.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
        } else {
          dot.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg>';
        }

        // Corpo
        var body = document.createElement('div');
        body.className = 'mob-etapa-body';

        // Nome — para concluída, adiciona ✓ inline em vez de linha separada de status
        var nomeWrap = document.createElement('div');
        nomeWrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
        var enome = document.createElement('span');
        enome.className = 'mob-etapa-nome';
        enome.textContent = et.nome || et.etapa || '';
        nomeWrap.appendChild(enome);
        if (!isConcluida && !isNA) {
          // Seta indicando que é expansível
          var chevEt = document.createElement('span');
          chevEt.style.cssText = 'color:var(--muted);font-size:10px;margin-left:auto;flex-shrink:0;transition:transform .2s;';
          chevEt.textContent = '›';
          nomeWrap.appendChild(chevEt);
        }
        body.appendChild(nomeWrap);

        // Status — só para não-concluídas e não-NA
        if (!isConcluida && !isNA) {
          var estat = document.createElement('div');
          estat.className = 'mob-etapa-status';
          estat.textContent = (STATUS_LABEL && STATUS_LABEL[et.status]) || et.status || 'Não iniciada';
          body.appendChild(estat);
        }
        // Motivo do atraso — visível apenas quando a etapa foi concluída com atraso.
        if (et.status === 'ok' && et.dias > 0 && motivoAtrasoValido_(et.motivo)) {
          var mot = document.createElement('div');
          mot.className = 'mob-etapa-motivo';
          mot.textContent = '⚠ ' + et.motivo.substring(0, 120) + (et.motivo.length > 120 ? '…' : '');
          body.appendChild(mot);
        }

        // Painel de detalhes (oculto por padrão) — expansível ao tocar
        var detalhe = null;
        if (!isConcluida && !isNA || (et.ini_iso && et.fim_iso)) {
          detalhe = document.createElement('div');
          detalhe.className = 'mob-etapa-detalhe';
          detalhe.style.cssText = 'display:none;margin-top:6px;padding:8px 10px;background:var(--s2);border-radius:8px;font-size:11px;';

          function addRow(label, value, color) {
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px solid var(--border);';
            var k = document.createElement('span');
            k.style.cssText = 'color:var(--muted);font-weight:600;';
            k.textContent = label;
            var v = document.createElement('span');
            v.style.cssText = 'font-family:var(--mono);font-weight:700;text-align:right;' + (color ? 'color:' + color + ';' : '');
            v.textContent = value;
            row.appendChild(k); row.appendChild(v);
            detalhe.appendChild(row);
          }

          // Status
          var stLabel = STATUS_LABEL ? (STATUS_LABEL[et.status] || et.status || 'Não iniciada') : (et.status || 'Não iniciada');
          addRow('Status', stLabel, isConcluida ? 'var(--success)' : (et.status === 'atrasado' ? 'var(--danger)' : null));

          // Prazo 638/2026
          if (et.ini_iso && et.fim_iso) {
            addRow('Prazo 638/2026', isoToDD_MM(et.ini_iso) + ' → ' + isoToDD_MM_YY(et.fim_iso), null);
          }

          // Realizado
          var realizadoInfoMob = periodoRealizadoEtapa_(et);
          if (realizadoInfoMob) {
            addRow(realizadoInfoMob.label, realizadoInfoMob.texto, null);
          }

          // Prazo restante — mesma lógica do tooltip desktop
          if (et.status !== 'ok' && (et.fim_iso || et.ini_iso)) {
            var _h = new Date(); _h.setHours(0,0,0,0);
            var _ms = 86400000;
            if (et.status === 'andamento' || et.status === 'atrasado') {
              if (et.fim_iso) {
                var _f = new Date(et.fim_iso + 'T00:00:00');
                var _d = Math.round((_f - _h) / _ms);
                if (_d > 0) {
                  addRow('Prazo restante', 'Falta ' + _d + ' dia' + (_d > 1 ? 's' : ''), _d <= 7 ? 'var(--warn,#c97a00)' : 'var(--success)');
                } else if (_d === 0) {
                  addRow('Prazo restante', 'Vence hoje', 'var(--warn,#c97a00)');
                } else {
                  addRow('Prazo restante', 'Venceu há ' + (-_d) + ' dia' + (_d < -1 ? 's' : ''), 'var(--danger)');
                }
              }
            } else {
              // Não iniciada — mostra quando começa
              if (et.ini_iso) {
                var _i = new Date(et.ini_iso + 'T00:00:00');
                var _di = Math.round((_i - _h) / _ms);
                if (_di > 0) {
                  addRow('Início previsto', 'Começa em ' + _di + ' dia' + (_di > 1 ? 's' : ''), 'var(--muted)');
                } else if (_di === 0) {
                  addRow('Início previsto', 'Começa hoje', 'var(--warn,#c97a00)');
                } else if (p.execucao < 100 && p.status !== 'ok') {
                  addRow('Início previsto', 'Atrasado há ' + (-_di) + ' dia' + (_di < -1 ? 's' : ''), 'var(--danger)');
                }
              }
            }
          }

          // Atraso / Adiantamento
          if (et.status === 'ok' && et.dias && et.dias > 0) {
            addRow('Atraso registrado', '+' + et.dias + ' dia' + (et.dias > 1 ? 's' : ''), 'var(--danger)');
            // Último item sem border-bottom
            detalhe.lastChild.style.borderBottom = 'none';
          } else if (et.status === 'ok' && et.adiantamento && et.adiantamento > 0) {
            addRow('Adiantamento', '−' + et.adiantamento + ' dia' + (et.adiantamento > 1 ? 's' : ''), 'var(--success)');
            detalhe.lastChild.style.borderBottom = 'none';
          } else {
            if (detalhe.lastChild) detalhe.lastChild.style.borderBottom = 'none';
          }

          body.appendChild(detalhe);

          // Toggle ao tocar
          (function(det, chv) {
            linha.addEventListener('click', function() {
              var open = det.style.display === 'none';
              det.style.display = open ? 'block' : 'none';
              if (chv) chv.style.transform = open ? 'rotate(90deg)' : '';
            });
          })(detalhe, chevEt || null);
        }

        linha.appendChild(dot);
        linha.appendChild(body);
        etapasEl.appendChild(linha);
      });
    }

    // Toggle ao tocar/clicar
    hdr.addEventListener('click', function() {
      var open = etapasEl.classList.toggle('open');
      chev.classList.toggle('open', open);
      hdr.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    card.appendChild(hdr);
    card.appendChild(etapasEl);
    container.appendChild(card);
  });

  updateKPIs(filtered);
}

/*
 * applyFilters()
 * Aplica os dois filtros ativos (texto + status) sobre DATA[]
 * e ordena os resultados antes de chamar render():
 *   Ordem: atrasados → andamento → planejamento → outros
 * Isso garante que os processos mais críticos apareçam no topo.
 */
/*
 * renderVazio()
 * Estado vazio: quando a unidade selecionada não possui nenhum processo
 * cadastrado, removemos o esqueleto (que ficaria animando para sempre) e
 * exibimos uma mensagem clara em vez de simular um carregamento infinito.
 */
function renderVazio() {
  var msg = 'Nenhum processo cadastrado para esta unidade.';
  var sub = 'Quando processos forem cadastrados, eles aparecerão aqui automaticamente.';

  // Limpa o cabeçalho de meses e o esqueleto dos dois painéis do Gantt
  var hdrEl = document.getElementById('gantt-header'); if (hdrEl) hdrEl.innerHTML = '';
  var namesEl = document.getElementById('gantt-names');
  var barsEl  = document.getElementById('gantt-bars');
  if (namesEl) {
    namesEl.innerHTML =
      '<div style="text-align:center;padding:48px 20px;color:var(--muted);font-size:14px;line-height:1.5">' +
        '<div style="font-size:32px;margin-bottom:10px">🗂️</div>' +
        '<div style="font-weight:600;color:var(--text,#1e293b)">' + msg + '</div>' +
        '<div style="margin-top:6px;font-size:12.5px">' + sub + '</div>' +
      '</div>';
  }
  if (barsEl) barsEl.innerHTML = '';

  // Estado vazio também na lista mobile
  var mob = document.getElementById('mobile-list');
  if (mob) {
    mob.innerHTML =
      '<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:14px;line-height:1.5">' +
        '<div style="font-size:32px;margin-bottom:10px">🗂️</div>' +
        '<div style="font-weight:600;color:var(--text,#1e293b)">' + msg + '</div>' +
        '<div style="margin-top:6px;font-size:12.5px">' + sub + '</div>' +
      '</div>';
  }

  // Zera os KPIs de contagem
  ['kv-tot','kv-and','kv-atra','kv-plan','kv-conc'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.textContent = '——';
  });
}

function applyFilters() {
  if (!DATA.length) { renderVazio(); return; }
  var q = document.getElementById('f-search').value.toLowerCase();
  var filtered = DATA.filter(function(p) {
    var matchQ = !q || (p.num + ' ' + p.nome).toLowerCase().indexOf(q) >= 0;
    var matchS;
    if (!activeStatus) {
      // "Todos" = em andamento + atrasados + concluidos; exclui a fila (a iniciar + retornados)
      matchS = p.status !== 'planejamento' && p.status !== 'fila';
    } else if (activeStatus === 'andamento') {
      // "Andamento" inclui processos em andamento E os atrasados ainda nao concluidos
      matchS = p.status === 'andamento' || p.status === 'aguardando' || p.status === 'paralisado' || (p.status === 'atrasado' && p.execucao < 100);
    } else if (activeStatus === 'atrasado') {
      // "Atrasado" mostra apenas os atrasados nao concluidos
      matchS = p.status === 'atrasado' && p.execucao < 100;
    } else if (activeStatus === 'planejamento') {
      // "Em fila" = processos nunca iniciados (planejamento) + devolvidos à fila (fila)
      matchS = p.status === 'planejamento' || p.status === 'fila';
    } else {
      matchS = p.status === activeStatus;
    }
    // Filtro por ano: verifica se o processo tem inicio OU fim dentro do ano selecionado
    var matchA = true;
    if (activeAno) {
      var anoInt = parseInt(activeAno);
      // indices de mes para Jan e Dez do ano selecionado
      var anoStart = (anoInt - ANO_BASE) * 12;
      var anoEnd   = anoStart + 11;
      matchA = (p.inicio <= anoEnd && p.fim >= anoStart);
    }
    return matchQ && matchS && matchA;
  });
  // Ordenar: atrasados em curso → andamento → atrasados concluídos (100%) →
  // planejamento → outros.
  // Atrasados concluídos perdem a prioridade de topo: como o processo já foi
  // entregue, o ícone de alerta some e ele não precisa mais chamar atenção —
  // mas ainda fica acima dos "planejamento" porque é um processo efetivo.
  function ordemStatus(p) {
    // Concluídos (100% ou status ok) sempre no final, independente do status
    if (p.execucao === 100 || p.status === 'ok') return 6;
    if (p.status === 'atrasado')     return 0; // atrasados em curso: topo
    if (p.status === 'aguardando')   return 1;
    if (p.status === 'paralisado')   return 2;
    if (p.status === 'andamento')    return 3;
    if (p.status === 'planejamento') return 4;
    return 5;
  }
  filtered.sort(function(a, b) {
    return ordemStatus(a) - ordemStatus(b);
  });
  if (isMobile()) {
    renderMobileList(filtered);
  } else {
    render(filtered);
  }
}

/*
 * updateKPIs(filtered)
 * Conta os processos por status no array filtrado e atualiza os
 * elementos de texto dos quatro cartões KPI na interface.
 * Chamada ao final de render() para refletir sempre o filtro atual.
 */
function updateKPIs(filtered) {
  // KPI "Total de Processos" = em andamento + atrasados (não concluídos) + concluídos
  // Exclui processos na fila (planejamento) — eles têm KPI própria
  function kpiVal(n) { return n > 0 ? n : '——'; }
  var concluidos = filtered.filter(function(p){ return p.status === 'ok' || p.execucao === 100; });
  var atrasadosAtivos = filtered.filter(function(p){ return p.status === 'atrasado' && p.execucao < 100; });
  var emAndamento = filtered.filter(function(p){ return p.status === 'andamento' || p.status === 'aguardando' || p.status === 'paralisado' || (p.status === 'atrasado' && p.execucao < 100); });
  var tot = concluidos.length + atrasadosAtivos.length +
    filtered.filter(function(p){ return p.status === 'andamento' || p.status === 'aguardando' || p.status === 'paralisado'; }).length;
  document.getElementById('kv-tot').textContent  = activeStatus ? '——' : kpiVal(tot);
  // "Em Andamento" exibe '——' quando o filtro Atrasado está ativo (contextos mutuamente exclusivos)
  document.getElementById('kv-and').textContent  = activeStatus === 'atrasado' ? '——' : kpiVal(emAndamento.length);
  // "Atrasados" exclui processos já concluídos (mesmo que tenham tido atraso)
  document.getElementById('kv-atra').textContent = kpiVal(atrasadosAtivos.length);
  var basePlan = activeStatus ? filtered : DATA;
  document.getElementById('kv-plan').textContent = kpiVal(basePlan.filter(function(p){ return p.status === 'planejamento' || p.status === 'fila'; }).length);
  document.getElementById('kv-conc').textContent = kpiVal(concluidos.length);
}

// ════════════════════════════════════════════════════════════════
// PERSISTÊNCIA DE FILTROS — localStorage (por máquina/navegador)
//
// Salva o estado atual dos filtros no localStorage do navegador.
// Cada usuário/máquina tem seu próprio estado — ao recarregar a
// página os filtros são restaurados automaticamente.
// ════════════════════════════════════════════════════════════════

var LS_KEY = 'sel_painel_filtros';

/*
 * salvarFiltros() — grava o estado atual no localStorage.
 * Chamada a cada interação com filtros (busca, status, escala, ano).
 */
function salvarFiltros() {
  try {
    var estado = {
      busca:  document.getElementById('f-search').value || '',
      status: activeStatus,
      escala: escalaAtiva,
      ano:    activeAno
    };
    localStorage.setItem(LS_KEY, JSON.stringify(estado));
  } catch(e) { /* localStorage indisponível — sem ação */ }
}

/*
 * restaurarFiltros() — lê o localStorage e restaura os filtros da última sessão.
 * Chamada após carregar os dados (carregarDados → applyFilters).
 * Em caso de dados corrompidos, simplesmente ignora.
 */
function restaurarFiltros() {
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    var estado = JSON.parse(raw);

    // Restaura campo de busca
    if (estado.busca) {
      document.getElementById('f-search').value = estado.busca;
    }

    // Restaura filtro de status
    if (estado.status !== undefined) {
      activeStatus = estado.status;
      document.querySelectorAll('.status-btn').forEach(function(b) {
        b.className = 'status-btn';
        if (b.dataset.s === activeStatus) {
          var cls = {'':'active-all', andamento:'active-and', atrasado:'active-atra', planejamento:'active-plan'};
          b.classList.add(cls[activeStatus] || 'active-all');
        }
      });
    }

    // Restaura escala temporal
    if (estado.escala) {
      escalaAtiva = estado.escala;
      document.querySelectorAll('.escala-btn').forEach(function(b) {
        b.classList.toggle('active-escala', b.dataset.e === escalaAtiva);
      });
    }

    // Restaura filtro de ano
    if (estado.ano !== undefined) {
      activeAno = estado.ano;
      var sel = document.getElementById('ano-select');
      if (sel) sel.value = activeAno;
    }
  } catch(e) { /* estado corrompido — ignora */ }
}

// ════════════════════════════════════════════════════════════════
// INICIALIZAÇÃO — dispara o carregamento quando a página abre
// ════════════════════════════════════════════════════════════════
// Inicializa o painel estatico publicado no GitHub Pages.
carregarDados();

// ════════════════════════════════════════════════════════════════
// SCROLL SYNC — sincroniza scroll vertical entre coluna de nomes e barras
// ════════════════════════════════════════════════════════════════
// O painel esquerdo (gl-panel-body) tem overflow:hidden e não rola sozinho.
// Quando o usuário roda o mouse sobre ele, propagamos o delta para o
// painel direito (gr-panel-body), que tem overflow:auto e faz o scroll real.
// O evento de scroll do gr-panel-body atualiza o scrollTop do gl-panel-body
// para que os nomes fiquem sempre alinhados às barras correspondentes.
(function() {
  var glBody = document.getElementById('gl-panel-body');
  var grBody = document.getElementById('gr-panel-body');
  if (!glBody || !grBody) return;

  // Scroll real ocorre no grBody; gl-panel-body espelha o scrollTop
  grBody.addEventListener('scroll', function() {
    glBody.scrollTop = grBody.scrollTop;
    repositionTodayLine();
  });

  // Roda do mouse sobre a coluna de nomes → propaga para grBody
  glBody.addEventListener('wheel', function(ev) {
    ev.preventDefault();
    grBody.scrollTop += ev.deltaY;
    grBody.scrollLeft += ev.deltaX;
  }, { passive: false });
})();
