(function () {
  'use strict';
  const logic = window.AtasLogic;
  const adesao = window.AtasAdesao;
  const $ = id => document.getElementById(id);
  const fields = ['objeto', 'numero', 'ano', 'compra'];
  const nationalFields = ['uf', 'esfera', 'poder'];
  const labels = {objeto:'Objeto', numero:'Ata', ano:'Ano da ata', compra:'Compra', uf:'Estado', esfera:'Esfera', poder:'Poder', orgao:'Órgão'};
  const statusLabels = {vigente:'Vigente', 'nao-vigente':'Não vigente', indefinida:'Situação a conferir'};
  let items = [];
  let loaded = false;
  let visible = 10;
  const openGroups = new Set();
  const DEFAULT_UNIT = '153167';
  const ALL_UNITS = '*';
  const allUnits = {codigo:ALL_UNITS, nome:'Todas as UASGs · busca nacional'};
  const PAGE_SIZE = 20;
  const MAX_NATIONAL_RESULTS = 10000; // O PNCP limita paginação profunda da busca.
  let nationalPage = 1;
  let nationalTotal = 0;
  let nationalTimer;
  const API = 'https://dadosabertos.compras.gov.br/modulo-arp/1_consultarARP';
  const REPO_RAW = 'https://raw.githubusercontent.com/decofcp2-afk/painel-contratacoes-reitoria/main/';
  const knownUnits = [
    {codigo:'153167', nome:'Colégio Pedro II · Reitoria', orgao:'26201'},
    {codigo:'155624', nome:'Colégio Pedro II · Campus Humaitá I', orgao:'26201'},
    {codigo:'155625', nome:'Colégio Pedro II · Campus Niterói', orgao:'26201'},
    {codigo:'155627', nome:'Colégio Pedro II · Campus Realengo II', orgao:'26201'},
    {codigo:'155628', nome:'Colégio Pedro II · Campus Centro', orgao:'26201'},
    {codigo:'155629', nome:'Colégio Pedro II · Campus Humaitá II', orgao:'26201'},
    {codigo:'155630', nome:'Colégio Pedro II · Campus São Cristóvão I', orgao:'26201'},
    {codigo:'155636', nome:'Colégio Pedro II · Campus Engenho Novo II', orgao:'26201'},
    {codigo:'155637', nome:'Colégio Pedro II · Campus Duque de Caxias', orgao:'26201'},
  ];
  let units = knownUnits;
  let selectedUnit = knownUnits[0];
  let currentRequest;
  const unitCache = new Map();
  let selectedOrgan = null;
  const organOptions = new Map();
  let organTimer;
  let organCatalog;
  let organCatalogRequest;
  let arpItems = [];
  let arpQuery;
  let arpRequest;
  let arpMode = false;
  let arpVisible = 20;
  let unitUpdateLabel = '';
  const ITEMS_PER_STEP = 5;

  function todayInBrazil() {
    const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const part = type => parts.find(p => p.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  function formatDate(value) {
    const date = logic.datePart(value);
    return date ? date.slice(8,10) + '/' + date.slice(5,7) + '/' + date.slice(0,4) : 'Não informada';
  }

  function filters() {
    const checked = document.querySelector('input[name="status"]:checked');
    return {...Object.fromEntries(fields.map(id => [id, $(id).value.trim()])),
      ...Object.fromEntries(nationalFields.map(id => [id, $(id).value])),
      orgao:selectedOrgan?.id || '', status:checked ? checked.value : 'todos'};
  }

  function safePNCP(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && (url.hostname === 'pncp.gov.br' || url.hostname.endsWith('.pncp.gov.br')) ? url.href : '';
    } catch { return ''; }
  }

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function isCPII(unit) {
    return unit.orgao === '26201' || unit.cnpjOrgao === '42414284000102' ||
      logic.normalize(unit.nome).includes('colegio pedro ii');
  }

  function displayUnit(unit) {
    if (unit.codigo === ALL_UNITS) return 'Todas as UASGs';
    return unit.nome === `UASG ${unit.codigo}` ? unit.nome : `${unit.nome} — UASG ${unit.codigo}`;
  }

  function renderUnitOptions() {
    const term = logic.normalize($('unit-search').value);
    const words = term.split(/\s+/).filter(Boolean);
    const matches = units.filter(unit => (!term ? isCPII(unit) : words.every(word =>
      logic.normalize([unit.nome, unit.nomeOrgao, unit.codigo].join(' ')).includes(word))));
    matches.sort((a, b) => Number(isCPII(b)) - Number(isCPII(a)) ||
      logic.normalize(a.nome).localeCompare(logic.normalize(b.nome), 'pt-BR'));
    const box = $('unit-options');
    box.replaceChildren();
    let previousGroup = '';
    if (!term) {
      const all = element('button', 'unit-option', 'Todas as UASGs');
      all.type = 'button';
      all.append(element('small', '', 'Busca nacional por objeto neste painel'));
      if (selectedUnit.codigo === ALL_UNITS) all.setAttribute('aria-current', 'true');
      all.addEventListener('click', () => chooseUnit(allUnits));
      box.append(all);
    }
    matches.slice(0, 60).forEach(unit => {
      const group = isCPII(unit) ? 'Colégio Pedro II' : 'Outros órgãos';
      if (group !== previousGroup) box.append(element('div', 'unit-group-title', group));
      previousGroup = group;
      const button = element('button', 'unit-option', unit.nome);
      button.type = 'button';
      button.append(element('small', '', `UASG ${unit.codigo}${unit.nomeOrgao ? ' · ' + unit.nomeOrgao : ''}`));
      if (unit.codigo === selectedUnit.codigo) button.setAttribute('aria-current', 'true');
      button.addEventListener('click', () => chooseUnit(unit));
      box.append(button);
    });
    if (!matches.length) box.append(element('p', 'unit-empty', 'Nenhuma UASG encontrada neste catálogo.'));
    if (/^\d{6}$/.test(term) && !units.some(unit => unit.codigo === term)) {
      const button = element('button', 'unit-option', `Consultar UASG ${term}`);
      button.type = 'button';
      button.addEventListener('click', () => chooseUnit({codigo:term, nome:`UASG ${term}`}));
      box.append(button);
    }
    $('unit-help').textContent = units.length === knownUnits.length
      ? 'Catálogo completo indisponível no momento. As unidades conhecidas do CPII estão listadas; também é possível consultar pelo código de seis dígitos.'
      : !term ? 'Digite parte do nome do órgão ou da unidade para buscar em outras UASGs.'
        : matches.length > 60 ? `Exibindo 60 de ${matches.length} unidades. Refine a busca pelo nome ou número.` : '';
  }

  async function loadOrganCatalog() {
    if (organCatalog) return organCatalog;
    if (!organCatalogRequest) {
      organCatalogRequest = fetch('https://pncp.gov.br/api/search/filters?tipos_documento=ata')
        .then(response => {if (!response.ok) throw new Error('Catálogo indisponível'); return response.json();})
        .then(data => {
          if (!Array.isArray(data.filters?.orgaos)) throw new Error('Catálogo inválido');
          organCatalog = data.filters.orgaos.filter(org => /^\d+$/.test(String(org.id)) && org.nome);
          return organCatalog;
        })
        .finally(() => {organCatalogRequest = null;});
    }
    return organCatalogRequest;
  }

  async function renderOrganOptions() {
    const input = $('orgao-search');
    const term = logic.normalize(input.value);
    const box = $('orgao-options');
    box.replaceChildren();
    organOptions.clear();
    if (selectedUnit.codigo !== ALL_UNITS || term.length < 3) {
      $('orgao-help').textContent = 'Digite pelo menos três caracteres e selecione uma sugestão.';
      return;
    }
    $('orgao-help').textContent = 'Carregando órgãos do PNCP…';
    try {
      const orgs = await loadOrganCatalog();
      if (logic.normalize(input.value) !== term || selectedUnit.codigo !== ALL_UNITS) return;
      const words = term.split(/\s+/).filter(Boolean);
      const matches = orgs.filter(org => words.every(word =>
        logic.normalize(`${org.nome} ${org.cnpj || ''}`).includes(word))).slice(0, 40);
      matches.forEach(org => {
        const name = String(org.nome).trim();
        const label = `${name} — ${org.cnpj || 'ID ' + org.id}`;
        const option = element('option');
        option.value = label;
        box.append(option);
        organOptions.set(label, {id:String(org.id), name});
      });
      $('orgao-help').textContent = matches.length
        ? 'Selecione um órgão da lista para filtrar todas as páginas. Refine o nome para mais resultados.'
        : 'Nenhum órgão encontrado. Tente parte do nome ou CNPJ.';
    } catch {
      if (logic.normalize(input.value) === term)
        $('orgao-help').textContent = 'Não foi possível carregar órgãos agora. Tente digitar novamente.';
    }
  }

  function handleOrganInput() {
    clearTimeout(organTimer);
    const chosen = organOptions.get($('orgao-search').value) || null;
    const previousId = selectedOrgan?.id;
    selectedOrgan = chosen;
    if (previousId !== selectedOrgan?.id && selectedUnit.codigo === ALL_UNITS) scheduleNationalSearch();
    if (!chosen) organTimer = setTimeout(renderOrganOptions, 200);
    else $('orgao-help').textContent = `Filtrando todas as páginas por ${chosen.name}.`;
  }

  async function loadUnitCatalog() {
    try {
      let response;
      try {
        response = await fetch(REPO_RAW + 'uasg-catalog.json', {cache:'no-cache'});
        if (!response.ok) throw new Error('Catálogo remoto indisponível');
      } catch { response = await fetch('uasg-catalog.json', {cache:'no-cache'}); }
      if (!response.ok) return;
      const data = await response.json();
      if (!Array.isArray(data.items) || !data.items.length) return;
      const byCode = new Map(data.items.filter(unit => /^\d{6}$/.test(String(unit.codigo)) && unit.nome)
        .map(unit => [String(unit.codigo), {...unit, codigo:String(unit.codigo), orgao:String(unit.orgao || '')}]));
      // Nomes legíveis conhecidos ficam disponíveis inclusive se a fonte oficial oscilar.
      knownUnits.forEach(unit => byCode.set(unit.codigo, {...byCode.get(unit.codigo), ...unit}));
      units = [...byCode.values()];
      renderUnitOptions();
    } catch { /* O campo de código e as unidades conhecidas permanecem disponíveis. */ }
  }

  function chooseUnit(unit) {
    if (selectedUnit.codigo === unit.codigo) { $('unit-picker').open = false; return; }
    exitArpMode();
    clearTimeout(nationalTimer);
    if (currentRequest) currentRequest.abort();
    selectedUnit = unit;
    nationalPage = 1;
    nationalTotal = 0;
    $('selected-unit').textContent = displayUnit(unit);
    $('coverage-text').textContent = unit.codigo === ALL_UNITS
      ? 'Busca nacional do PNCP por objeto, situação, estado, esfera, poder e órgão, agrupada por objeto. Número da ata, ano e compra filtram somente a página exibida.'
      : `Atas gerenciadas pela UASG ${unit.codigo}. Participações e adesões a atas de outros órgãos não estão incluídas. A unidade selecionada no painel não altera esta consulta.`;
    $('national-filters').hidden = unit.codigo !== ALL_UNITS;
    $('national-search').hidden = true;
    $('national-pagination').hidden = true;
    $('unit-picker').open = false;
    $('unit-search').value = '';
    renderUnitOptions();
    visible = 10;
    openGroups.clear();
    load();
  }

  function addLink(parent, urlValue, number) {
    const url = safePNCP(urlValue);
    if (!url) {
      parent.append(element('span', 'missing-link', 'Documentos indisponíveis no PNCP'));
      return;
    }
    const a = element('a', 'document-link', 'Ver ata e documentos ↗');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', `Ver ata ${number || 'sem número'} e documentos no PNCP`);
    parent.append(a);
  }

  function renderBalance(target, rows) {
    target.replaceChildren();
    if (!rows.length) {
      target.append(element('p', 'adhesion-note', 'Não há saldo de adesão publicado para este item. Confira a ata no Compras.gov.br.'));
      return;
    }
    const qty = value => value === null ? 'não informado' : value.toLocaleString('pt-BR');
    rows.forEach(row => {
      const entry = element('div', 'adhesion-balance');
      const heading = target.closest('.supplier-item') ? null : element('strong', '', row.descricao || 'Item consultado');
      const meta = element('span', '', [row.fornecedor && 'Fornecedor: ' + row.fornecedor,
        row.unidade && 'Unidade: ' + row.unidade,
        row.unidades > 1 && `saldo não somado entre ${row.unidades} unidades`].filter(Boolean).join(' · '));
      const invalid = row.saldo !== null && row.limite !== null && row.saldo > row.limite;
      const value = invalid
        ? 'Saldo: ' + qty(row.saldo) + ' · limite: ' + qty(row.limite) + ' · dados divergentes; confira na origem'
        : row.percentual === null
        ? 'Saldo para adesão: ' + qty(row.saldo) + ' · percentual não disponível'
        : qty(row.saldo) + ' de ' + qty(row.limite) + ' unidades · ' +
          row.percentual.toLocaleString('pt-BR', {maximumFractionDigits:1}) + '% do limite de adesão disponível';
      if (heading) entry.append(heading);
      entry.append(meta, element('b', 'adhesion-value', value));
      if (row.registrado !== null) entry.append(element('small', '', 'Quantidade registrada na unidade: ' + qty(row.registrado)));
      if (row.limiteCompra !== null && row.limiteCompra !== row.limite)
        entry.append(element('small', '', 'Limite informado na compra: ' + qty(row.limiteCompra)));
      if (row.codigoItem) entry.append(element('small', '', 'Código PDM: ' + row.codigoItem));
      if (!row.aceitaAdesao) entry.append(element('small', '', 'A origem informa que este item não aceita adesão.'));
      if (row.divergente) entry.append(element('small', '', 'Há saldos diferentes entre unidades; confira na origem.'));
      if (row.atualizadoEm) {
        const date = new Date(row.atualizadoEm);
        if (!Number.isNaN(date.getTime())) entry.append(element('small', '', 'Dados atualizados na origem em ' +
          new Intl.DateTimeFormat('pt-BR', {timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(date)));
      }
      target.append(entry);
    });
  }

  function setAvailability(article, state, cnpj = '') {
    const badge = article.querySelector('.adhesion-status');
    if (!badge) return;
    const labels = {
      unverified:'Saldo a consultar',
      loading:'Consultando saldo…',
      pending:'Demais itens a consultar',
      available:'Adesão: há saldo',
      unavailable:'Adesão: sem saldo',
      unknown:'Saldo não confirmado'
    };
    badge.className = `adhesion-status ${state}`;
    badge.textContent = labels[state];
    badge.title = state === 'available'
      ? `Há saldo positivo em pelo menos um item que aceita adesão${cnpj ? ' para o fornecedor pesquisado' : ''}. Confira a vigência e as condições do pedido.`
      : state === 'unavailable'
      ? `Todos os itens foram consultados e nenhum apresentou saldo positivo para adesão${cnpj ? ' para o fornecedor pesquisado' : ''}.`
      : 'Abra a consulta dos itens para verificar o saldo na fonte oficial.';
    article.dataset.adhesionAvailability = state;
  }

  function availabilityBadge() {
    return element('span', 'adhesion-status unverified', 'Saldo a consultar');
  }

  function renderArpResults() {
    const target = $('arp-results');
    const f = filters();
    const groups = new Map();
    arpItems.forEach(row => {
      const key = [row.codigoUnidadeGerenciadora, row.numeroAtaRegistroPreco,
        row.numeroCompra, row.anoCompra].join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    target.replaceChildren();
    let displayed = 0;
    groups.forEach(records => {
      const ata = records[0];
      const purchase = [ata.numeroCompra, ata.anoCompra].filter(Boolean).join('/');
      if ((f.numero && !logic.normalize(ata.numeroAtaRegistroPreco).includes(logic.normalize(f.numero))) ||
          (f.compra && !logic.normalize(purchase).includes(logic.normalize(f.compra))) ||
          (f.objeto && !records.some(row => logic.normalize(row.descricaoItem).includes(logic.normalize(f.objeto)))) ||
          (f.status !== 'todos' && logic.situation(ata, todayInBrazil()) !== f.status)) return;
      displayed++;
      if (displayed > arpVisible) return;
      const suppliers = new Set(records.map(row => String(row.niFornecedor || '')).filter(Boolean));
      const itemCount = new Set(records.map(row => row.numeroItem)).size;
      const box = element('article', 'supplier-ata');
      const heading = element('div', 'supplier-heading');
      heading.append(element('h3', '', `Ata ${ata.numeroAtaRegistroPreco} · UASG ${ata.codigoUnidadeGerenciadora}`), availabilityBadge());
      box.append(heading,
        element('small', '', `Compra ${ata.numeroCompra || 'não informada'}/${ata.anoCompra || '—'} · Vigência ${formatDate(ata.dataVigenciaInicial)} a ${formatDate(ata.dataVigenciaFinal)} · ${itemCount} ${itemCount === 1 ? 'item' : 'itens'}${suppliers.size > 1 ? ' · ' + suppliers.size + ' fornecedores' : ata.nomeRazaoSocialFornecedor ? ' · ' + ata.nomeRazaoSocialFornecedor : ''}`));
      const button = element('button', 'adhesion-open', 'Ver saldo de adesão por item');
      button.type = 'button';
      button.setAttribute('aria-expanded', 'false');
      button.addEventListener('click', () => openBalance(ata, box, button, records, arpQuery.cnpj));
      box.append(button);
      target.append(box);
    });
    $('result-count').textContent = displayed
      ? `${displayed} ${displayed === 1 ? 'ata' : 'atas'} · ${arpItems.length} ${arpItems.length === 1 ? 'item' : 'itens'} localizados`
      : 'Nenhuma ata encontrada';
    $('arp-status').textContent = displayed
      ? 'Abra uma ata para consultar o saldo dos itens.'
      : 'Nenhuma ata corresponde aos filtros. Ajuste os campos e busque novamente.';
    $('show-more').hidden = displayed <= arpVisible;
    $('show-more').textContent = `Mostrar mais atas (${displayed - arpVisible} restantes)`;
  }

  function exitArpMode() {
    if (arpRequest) arpRequest.abort();
    arpMode = false;
    $('arp-results').hidden = true;
    $('result-list').hidden = false;
    $('arp-status').textContent = '';
    $('updated-at').textContent = unitUpdateLabel;
    $('coverage-text').textContent = selectedUnit.codigo === ALL_UNITS
      ? 'Busca nacional do PNCP por objeto, situação, estado, esfera, poder e órgão, agrupada por objeto. Número da ata, ano e compra filtram somente a página exibida.'
      : `Atas gerenciadas pela UASG ${selectedUnit.codigo}. Participações e adesões a atas de outros órgãos não estão incluídas. A unidade selecionada no painel não altera esta consulta.`;
    render();
    renderPagination();
  }

  async function loadArp() {
    const cnpj = $('arp-cnpj').value.replace(/\D/g, '');
    const uasg = $('arp-uasg').value.replace(/\D/g, '');
    const year = $('ano').value;
    if (!cnpj && !uasg) { $('arp-status').textContent = 'Informe o CNPJ do fornecedor ou a UASG gerenciadora.'; return; }
    if (cnpj && !/^\d{14}$/.test(cnpj)) { $('arp-status').textContent = 'Informe um CNPJ com 14 dígitos.'; return; }
    if (uasg && !/^\d{5,6}$/.test(uasg)) { $('arp-status').textContent = 'Informe uma UASG com 5 ou 6 dígitos.'; return; }
    if (!/^\d{4}$/.test(year)) { $('arp-status').textContent = 'Selecione o ano da ata antes de buscar.'; $('ano').focus(); return; }
    if (arpRequest) arpRequest.abort();
    arpMode = true;
    $('result-list').hidden = true;
    $('show-more').hidden = true;
    $('national-pagination').hidden = true;
    $('arp-results').hidden = false;
    $('coverage-text').textContent = 'Itens registrados no Compras.gov.br para o CNPJ e/ou a UASG informados. Os saldos são consultados ao abrir cada ata e dependem da fonte oficial.';
    arpItems = [];
    arpVisible = 20;
    $('arp-results').replaceChildren();
    $('updated-at').textContent = '';
    arpQuery = {cnpj, uasg, year};
    const request = new AbortController();
    arpRequest = request;
    $('arp-status').textContent = 'Buscando atas e itens registrados…';
    $('result-count').textContent = 'Buscando atas…';
    try {
      const known = new Set();
      for (let page = 1; page <= 20; page++) {
        $('arp-status').textContent = `Buscando atas e itens registrados · página ${page}…`;
        const data = await window.PainelGateway.chamarApi('arp.proxy', {
          endpoint:'itens', ...(cnpj ? {niFornecedor:cnpj} : {}), ...(uasg ? {codigoUnidadeGerenciadora:uasg} : {}), dataVigenciaInicialMin:`${year}-01-01`,
          dataVigenciaInicialMax:`${year}-12-31`, pagina:page, tamanhoPagina:500
        }, {signal:request.signal});
        if (!data.ok) throw new Error(data.erro || 'Consulta indisponível.');
        if (!Array.isArray(data.resultado) || !Number.isInteger(data.totalPaginas) || data.totalPaginas > 20)
          throw new Error('Resposta inesperada da consulta.');
        if (arpRequest !== request || !arpMode) return;
        data.resultado.filter(row => row && !row.itemExcluido && (!cnpj || String(row.niFornecedor) === cnpj) && (!uasg || String(row.codigoUnidadeGerenciadora) === uasg))
          .forEach(row => {
            const key = [row.codigoUnidadeGerenciadora, row.numeroAtaRegistroPreco,
              row.numeroCompra, row.anoCompra, row.numeroItem, row.niFornecedor].join('|');
            if (!known.has(key)) { known.add(key); arpItems.push(row); }
          });
        if (page >= data.totalPaginas) break;
      }
      renderArpResults();
      $('updated-at').textContent = 'Consulta pública realizada agora';
    } catch (error) {
      if (arpRequest !== request || !arpMode) return;
      $('result-count').textContent = 'Consulta indisponível';
      $('arp-status').textContent = `Não foi possível concluir a busca: ${error.message}. Tente novamente.`;
    }
  }

  async function openBalance(ata, article, button, knownRecords, cnpj) {
    const current = article.querySelector('.ata-adhesion');
    if (current) {
      current.remove();
      button.setAttribute('aria-expanded', 'false');
      if (['loading', 'pending'].includes(article.dataset.adhesionAvailability))
        setAvailability(article, 'unverified', cnpj);
      return;
    }
    setAvailability(article, 'loading', cnpj);
    const panel = element('section', 'ata-adhesion');
    panel.setAttribute('aria-label', 'Saldo para adesão por item');
    const intro = element('p', 'adhesion-note',
      'O saldo é por item e corresponde ao limite informado no Compras.gov.br. A adesão depende da vigência da ata e da análise do pedido para sua unidade.');
    const official = element('a', 'document-link', 'Consultar os itens no Contratos.gov.br ↗');
    official.href = 'https://contratos.sistema.gov.br/arp/adesao/create';
    official.target = '_blank';
    official.rel = 'noopener noreferrer';
    official.setAttribute('aria-label', 'Abrir consulta oficial de itens para adesão no Contratos.gov.br; pode exigir acesso gov.br');
    const status = element('p', 'adhesion-note', 'Buscando itens da ata…');
    status.setAttribute('role', 'status');
    const result = element('div', 'adhesion-results');
    const more = element('button', 'adhesion-retry item-more', 'Ver mais itens');
    more.type = 'button';
    more.hidden = true;
    panel.append(intro, status, result, more, official);
    article.append(panel);
    button.setAttribute('aria-expanded', 'true');
    let allItems;
    try {
      const source = knownRecords || await adesao.withDeadline(signal => adesao.listItems(ata, adesao.proxyFetch, signal), 65000);
      const byItem = new Map();
      source.filter(row => /^\d+$/.test(String(row.numeroItem || ''))).forEach(row => {
        const key = String(row.numeroItem);
        if (!byItem.has(key)) byItem.set(key, {...row, suppliers:new Set([String(row.niFornecedor || '')])});
        else byItem.get(key).suppliers.add(String(row.niFornecedor || ''));
      });
      allItems = [...byItem.values()].sort((a, b) => Number(a.numeroItem) - Number(b.numeroItem));
    } catch {
      if (panel.isConnected) status.textContent = 'Não foi possível carregar os itens. Feche e abra a ata para tentar novamente ou consulte o Contratos.gov.br.';
      if (panel.isConnected) setAvailability(article, 'unknown', cnpj);
      return;
    }
    if (!panel.isConnected) return;
    if (!allItems.length) { status.textContent = 'Nenhum item localizado nesta ata na base pública.'; setAvailability(article, 'unknown', cnpj); return; }
    let shown = 0;
    let checked = 0;
    let failed = 0;
    let missing = 0;
    const balances = [];
    async function showNext() {
      more.hidden = true;
      if (article.dataset.adhesionAvailability !== 'available') setAvailability(article, 'loading', cnpj);
      const batch = allItems.slice(shown, shown + ITEMS_PER_STEP);
      shown += batch.length;
      const slots = batch.map(row => {
        const item = element('div', 'supplier-item');
        item.append(element('strong', '', `Item ${row.numeroItem} · ${row.descricaoItem || row.descricao || 'Descrição não informada'}`));
        if (row.suppliers.size > 1)
          item.append(element('small', '', `${row.suppliers.size} fornecedores registrados neste item; saldos separados abaixo.`));
        else if (row.quantidadeHomologadaVencedor != null || row.maximoAdesao != null)
          item.append(element('small', '', [row.quantidadeHomologadaVencedor != null && `Quantidade homologada: ${Number(row.quantidadeHomologadaVencedor).toLocaleString('pt-BR')}`,
            row.maximoAdesao != null && `Máximo de adesão informado na ata: ${Number(row.maximoAdesao).toLocaleString('pt-BR')}`].filter(Boolean).join(' · ')));
        if (row.codigoItem) item.append(element('small', '', 'Código do item: ' + row.codigoItem));
        if (row.suppliers.size <= 1 && row.valorUnitario != null && Number.isFinite(Number(row.valorUnitario)))
          item.append(element('small', '', 'Valor unitário registrado: ' + Number(row.valorUnitario).toLocaleString('pt-BR', {style:'currency', currency:'BRL'})));
        const balance = element('div', 'adhesion-results');
        balance.append(element('p', 'adhesion-note', 'Consultando saldo na fonte oficial…'));
        item.append(balance);
        result.append(item);
        return {row, balance};
      });
      status.textContent = `Consultando ${shown} de ${allItems.length} itens desta ata…`;
      for (let start = 0; start < slots.length; start += 3) {
        await Promise.all(slots.slice(start, start + 3).map(async ({row, balance}) => {
          const [saldo, approvals] = await Promise.allSettled([
            adesao.withDeadline(signal => adesao.getBalance(ata, row.numeroItem, adesao.proxyFetch, signal), 65000),
            adesao.withDeadline(signal => adesao.getApprovals(ata, row.numeroItem, adesao.proxyFetch, signal), 65000)
          ]);
          if (!panel.isConnected) return;
          if (saldo.status === 'fulfilled') {
            const matching = cnpj ? saldo.value.filter(entry => entry.fornecedor.replace(/\D/g, '').startsWith(cnpj)) : saldo.value;
            renderBalance(balance, matching);
            balances.push(...matching);
            if (!matching.length) missing++;
          } else {
            failed++;
            balance.replaceChildren(element('p', 'adhesion-note', 'Saldo indisponível agora. Confira este item no Contratos.gov.br.'));
          }
          checked++;
          setAvailability(article, adesao.availability({balances, checked, total:allItems.length, failed, missing}), cnpj);
          if (approvals.status === 'fulfilled')
            balance.append(element('small', 'adhesion-approvals', 'Adesões aprovadas globalmente para o item: ' + approvals.value.total.toLocaleString('pt-BR')));
          else balance.append(element('small', 'adhesion-approvals', 'Detalhamento de adesões aprovadas indisponível nesta consulta.'));
        }));
      }
      if (!panel.isConnected) return;
      status.textContent = `${shown} de ${allItems.length} itens exibidos · saldos consultados agora na fonte pública.`;
      setAvailability(article, adesao.availability({balances, checked, total:allItems.length, failed, missing}), cnpj);
      more.hidden = shown >= allItems.length;
      more.textContent = `Ver mais itens (${allItems.length - shown} restantes)`;
    }
    more.addEventListener('click', showNext);
    await showNext();
  }

  function card(ata, today) {
    const article = element('article', 'ata-row');
    const number = element('div', 'ata-number');
    number.append(element('span', 'cell-label', 'Ata'), element('strong', '', ata.numeroAtaRegistroPreco || 'Sem número'));
    if (adesao.context(ata)) number.append(availabilityBadge());
    if (selectedUnit.codigo === ALL_UNITS) {
      const code = String(ata.codigoUnidadeGerenciadora || '');
      number.append(element('small', 'ata-unit',
        `${ata.nomeOrgao || ata.nomeUnidadeGerenciadora || 'Órgão não informado'}${code ? ' · ' + (/^\d{6}$/.test(code) ? 'UASG ' : 'Unidade ') + code : ''}`));
    }
    const validity = element('div', 'ata-validity');
    validity.append(element('span', 'cell-label', 'Vigência'),
      element('span', 'date-range', `${formatDate(ata.dataVigenciaInicial)} a ${formatDate(ata.dataVigenciaFinal)}`));
    const status = logic.situation(ata, today);
    validity.append(element('span', `badge ${status}`, statusLabels[status]));
    const purchase = element('div', 'ata-purchase');
    purchase.append(element('span', 'cell-label', 'Compra'),
      element('span', '', [ata.numeroCompra, ata.anoCompra].filter(Boolean).join('/') || 'Não informada'));
    const links = element('div', 'ata-action');
    links.append(element('span', 'cell-label', 'Documentos'));
    addLink(links, ata.linkAtaPNCP, ata.numeroAtaRegistroPreco);
    if (adesao.context(ata)) {
      const button = element('button', 'adhesion-open', 'Ver saldo de adesão por item');
      button.type = 'button';
      button.setAttribute('aria-expanded', 'false');
      button.addEventListener('click', () => openBalance(ata, article, button));
      links.append(button);
    }
    article.append(number, validity, purchase, links);
    return article;
  }

  function objectGroup(key, value, records, today, expand) {
    const heading = element('details', 'object-group');
    heading.open = expand || openGroups.has(key);
    heading.addEventListener('toggle', () => {
      if (heading.open) openGroups.add(key);
      else openGroups.delete(key);
    });
    const description = String(value || 'Objeto não informado').replace(/\s+/g, ' ').trim();
    const title = description.replace(/^A presente Ata tem por objeto o registro de preços para (?:a eventual )?/i, '');
    const summary = element('summary', 'object-heading');
    summary.append(element('span', 'object-title', title),
      element('span', 'object-count', `${records.length} ${records.length === 1 ? 'ata' : 'atas'}`));
    heading.append(summary);
    if (title !== description || description.length > 230) {
      heading.append(element('p', 'object-full', description));
    }
    const rows = element('div', 'object-rows');
    const header = element('div', 'row-head');
    header.setAttribute('aria-hidden', 'true');
    ['Ata', 'Vigência', 'Compra', 'Documentos'].forEach(label => header.append(element('span', '', label)));
    rows.append(header);
    records.forEach(ata => rows.append(card(ata, today)));
    heading.append(rows);
    return heading;
  }

  function renderChips(f) {
    const box = $('active-filters');
    box.replaceChildren();
    const active = fields.filter(key => f[key]).map(key => [key, `${labels[key]}: ${f[key]}`]);
    if ($('arp-cnpj').value.trim()) active.push(['arp-cnpj', `Fornecedor: ${$('arp-cnpj').value.trim()}`]);
    if ($('arp-uasg').value.trim()) active.push(['arp-uasg', `UASG: ${$('arp-uasg').value.trim()}`]);
    if (selectedUnit.codigo === ALL_UNITS) {
      nationalFields.filter(key => f[key]).forEach(key => active.push([key,
        `${labels[key]}: ${$(key).selectedOptions[0].textContent}`]));
      if (selectedOrgan) active.push(['orgao', `Órgão: ${selectedOrgan.name}`]);
    }
    active.forEach(([key, label]) => {
      const button = element('button', 'filter-chip', `${label} ×`);
      button.type = 'button';
      button.setAttribute('aria-label', `Remover filtro ${label}`);
      button.addEventListener('click', () => {
        if (key === 'orgao') {selectedOrgan = null; $('orgao-search').value = '';}
        else $(key).value = '';
        if (arpMode && (key === 'arp-cnpj' || key === 'arp-uasg')) { exitArpMode(); return; }
        visible = 10;
        if ((key === 'objeto' || nationalFields.includes(key) || key === 'orgao') && selectedUnit.codigo === ALL_UNITS) scheduleNationalSearch();
        else render();
      });
      box.append(button);
    });
    const hasFiltersToClear = active.length > 0 || f.status === 'nao-vigente';
    $('clear-filters').hidden = !hasFiltersToClear;
    box.parentElement.hidden = !hasFiltersToClear;
  }

  function empty(message, title) {
    const box = element('div', 'empty-state');
    if (title) box.append(element('strong', '', title));
    box.append(document.createTextNode(message));
    $('result-list').replaceChildren(box);
    $('show-more').hidden = true;
  }

  function updateNationalSearch(f) {
    const link = $('national-search');
    const query = new URLSearchParams({pagina:'1', q:f.objeto});
    if (f.status === 'vigente') query.set('status', 'vigente');
    else if (f.status === 'nao-vigente') query.set('status', 'nao_vigente');
    else query.set('status', 'todos');
    if (f.uf) query.set('ufs', f.uf);
    if (f.esfera) query.set('esferas', f.esfera);
    if (f.poder) query.set('poderes', f.poder);
    if (f.orgao) query.set('orgaos', f.orgao);
    link.href = 'https://pncp.gov.br/app/atas?' + query;
    link.textContent = f.orgao ? 'Abrir esta busca no PNCP ↗' : f.objeto
      ? 'Buscar “' + f.objeto + '” em todos os órgãos no PNCP ↗'
      : 'Buscar em todos os órgãos no PNCP ↗';
  }

  function render() {
    const f = filters();
    renderChips(f);
    updateNationalSearch(f);
    if (arpMode) { renderArpResults(); return; }
    if (!loaded) return;
    const today = todayInBrazil();
    const result = logic.filterAtas(items, f, today);
    const groups = new Map();
    result.forEach(ata => {
      const key = logic.normalize(ata.objeto);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ata);
    });
    $('result-count').textContent = `${result.length} ${result.length === 1 ? 'ata' : 'atas'} em ${groups.size} ${groups.size === 1 ? 'objeto' : 'objetos'}${selectedUnit.codigo === ALL_UNITS ? ' nesta página' : ''}`;
    if (selectedUnit.codigo === ALL_UNITS) {
      $('updated-at').textContent = `${nationalTotal.toLocaleString('pt-BR')} atas encontradas no PNCP · página ${nationalPage}${nationalTotal > MAX_NATIONAL_RESULTS ? ' · refine os filtros para consultar além das primeiras 10.000' : ''}`;
    }
    if (!result.length) {
      empty(selectedUnit.codigo === ALL_UNITS
        ? 'Nenhuma ata desta página corresponde aos filtros. Avance ou refine o objeto pesquisado.'
        : 'Tente mudar o status, usar menos palavras ou limpar os filtros.', 'Nenhuma ata encontrada');
      return;
    }
    const output = document.createDocumentFragment();
    const expand = Boolean(f.objeto || f.numero || f.ano || f.compra) || groups.size <= 3;
    [...groups].slice(0, selectedUnit.codigo === ALL_UNITS ? groups.size : visible).forEach(([key, records], index) => {
      output.append(objectGroup(key, records[0].objeto, records, today, expand || index === 0));
    });
    $('result-list').replaceChildren(output);
    $('show-more').hidden = selectedUnit.codigo === ALL_UNITS || groups.size <= visible;
    $('show-more').textContent = `Mostrar mais objetos (${groups.size - visible} restantes)`;
  }

  function loadYears() {
    const previous = $('ano').value;
    $('ano').replaceChildren(element('option', '', 'Todos os anos'));
    $('ano').firstChild.value = '';
    const years = [...new Set([
      ...Array.from({length:new Date().getFullYear() - 2020}, (_, i) => String(new Date().getFullYear() - i)),
      ...items.map(logic.ataYear).filter(Boolean)
    ])].sort().reverse();
    years.forEach(year => {
      const option = element('option', '', year);
      option.value = year;
      $('ano').append(option);
    });
    if (years.includes(previous)) $('ano').value = previous;
  }

  async function loadDefault(signal) {
    // O workflow publica no GitHub mesmo quando o Pages não recompila o site.
    let response;
    try {
      response = await fetch(REPO_RAW + 'atas-data.json', {cache:'no-cache', signal});
      if (!response.ok) throw new Error('Arquivo remoto indisponível');
    } catch (error) {
      if (signal.aborted) throw error;
      response = await fetch('atas-data.json', {cache:'no-cache', signal});
    }
    if (!response.ok) throw new Error('Arquivo de atas indisponível');
    const payload = await response.json();
    if (!payload.generatedAt || !Array.isArray(payload.items)) {
      throw new Error('A primeira atualização dos dados ainda não foi concluída');
    }
    return {items:payload.items.filter(ata => ata && String(ata.codigoUnidadeGerenciadora) === DEFAULT_UNIT), generatedAt:payload.generatedAt, cached:true};
  }

  async function loadCPII(code, signal) {
    let response;
    try {
      response = await fetch(REPO_RAW + 'atas-cpii-data.json', {cache:'no-cache', signal});
      if (!response.ok) throw new Error('Base do CPII indisponível');
    } catch (error) {
      if (signal.aborted) throw error;
      response = await fetch('atas-cpii-data.json', {cache:'no-cache', signal});
    }
    if (!response.ok) throw new Error('Base dos campi indisponível');
    const payload = await response.json();
    if (!payload.generatedAt || !Array.isArray(payload.items) || !payload.units?.includes(code)) {
      throw new Error('A unidade ainda não está na base atualizada do CPII');
    }
    return {items:payload.items.filter(ata => String(ata.codigoUnidadeGerenciadora) === code), generatedAt:payload.generatedAt, cached:true};
  }

  async function loadNational(f, page, signal) {
    const url = logic.nationalSearchUrl(f, page, PAGE_SIZE);
    let response;
    try {
      response = await fetch(url, {signal});
    } catch (error) {
      if (signal.aborted) throw error;
      await new Promise(resolve => setTimeout(resolve, 400));
      response = await fetch(url, {signal});
    }
    if (!response.ok) throw new Error(`Busca nacional indisponível (${response.status})`);
    const data = await response.json();
    if (!Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total < 0 ||
        data.items.length > PAGE_SIZE) throw new Error('Resposta inesperada do PNCP');
    return {items:data.items.filter(record => record && record.document_type === 'ata').map(logic.mapPNCPRecord),
      total:data.total, generatedAt:new Date().toISOString(), cached:false};
  }

  async function loadFromCompras(code, signal) {
    const years = Array.from({length:new Date().getFullYear() - 2021 + 1}, (_, index) => 2021 + index);
    const fetchYear = async year => {
      const records = [];
      for (let page = 1; ; page++) {
        const query = new URLSearchParams({codigoUnidadeGerenciadora:code,
          dataVigenciaInicialMin:`${year}-01-01`, dataVigenciaInicialMax:`${year}-12-31`,
          tamanhoPagina:'500', pagina:String(page)});
        const response = await fetch(API + '?' + query, {signal});
        if (!response.ok) throw new Error(`Consulta oficial indisponível (${response.status})`);
        const payload = await response.json();
        if (!Array.isArray(payload.resultado) || !Number.isInteger(payload.totalPaginas) ||
            payload.totalPaginas < 0 || payload.totalPaginas > 100) throw new Error('Paginação inesperada na API oficial');
        records.push(...payload.resultado.filter(ata => ata && String(ata.codigoUnidadeGerenciadora) === code));
        if (page >= payload.totalPaginas) return records;
      }
    };
    // Verifica uma página antes de consultar os outros anos; evita repetir erros de acesso.
    const firstYear = years.pop();
    const firstBatch = await fetchYear(firstYear);
    const batches = [firstBatch, ...await Promise.all(years.map(fetchYear))];
    const unique = new Map();
    batches.flat().forEach(ata => {
      const key = ata.numeroControlePncpAta || [code, ata.numeroAtaRegistroPreco, ata.numeroCompra, ata.anoCompra].join('|');
      unique.set(key, ata);
    });
    return {items:[...unique.values()], generatedAt:new Date().toISOString(), cached:false};
  }

  function renderPagination() {
    const nav = $('national-pagination');
    nav.hidden = selectedUnit.codigo !== ALL_UNITS || !loaded || nationalTotal === 0;
    if (nav.hidden) return;
    $('page-label').textContent = `Página ${nationalPage} de ${Math.ceil(Math.min(nationalTotal, MAX_NATIONAL_RESULTS) / PAGE_SIZE).toLocaleString('pt-BR')}`;
    $('previous-page').disabled = nationalPage <= 1;
    $('next-page').disabled = nationalPage * PAGE_SIZE >= Math.min(nationalTotal, MAX_NATIONAL_RESULTS);
  }

  function scheduleNationalSearch() {
    if (currentRequest) currentRequest.abort();
    currentRequest = undefined;
    clearTimeout(nationalTimer);
    loaded = false;
    render();
    nationalTimer = setTimeout(() => {nationalPage = 1; load();}, 350);
  }

  async function load() {
    const unit = selectedUnit;
    if (currentRequest) currentRequest.abort();
    const request = new AbortController();
    currentRequest = request;
    loaded = false;
    items = [];
    $('national-pagination').hidden = true;
    $('national-search').hidden = true;
    $('result-count').textContent = unit.codigo === ALL_UNITS
      ? 'Buscando atas em todos os órgãos…' : `Consultando UASG ${unit.codigo}…`;
    $('updated-at').textContent = '';
    empty(unit.codigo === ALL_UNITS ? 'Buscando atas pelo objeto no PNCP…' : 'Buscando atas da unidade selecionada…');
    const timeout = setTimeout(() => request.abort(), unit.codigo === ALL_UNITS ? 30000 : 90000);
    try {
      const f = filters();
      const payload = unit.codigo === ALL_UNITS ? await loadNational(f, nationalPage, request.signal) :
        unitCache.get(unit.codigo) ||
        (unit.codigo === DEFAULT_UNIT ? await loadDefault(request.signal) :
          isCPII(unit) ? await loadCPII(unit.codigo, request.signal) :
            await loadFromCompras(unit.codigo, request.signal));
      if (currentRequest !== request) return;
      if (unit.codigo === ALL_UNITS) nationalTotal = payload.total;
      else {
        unitCache.set(unit.codigo, payload);
        if (unitCache.size > 4) unitCache.delete(unitCache.keys().next().value);
      }
      items = payload.items;
      loadYears();
      loaded = true;
      if (unit.codigo !== ALL_UNITS) {
        const stamp = new Intl.DateTimeFormat('pt-BR',
          {timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(payload.generatedAt));
        const delayed = Date.now() - new Date(payload.generatedAt).valueOf() > 48 * 60 * 60 * 1000;
        $('updated-at').textContent = `${payload.cached ? 'Dados atualizados' : 'Consulta realizada'} em ${stamp} (horário de Brasília)${delayed ? ' · Confira a ata no PNCP' : ''}`;
        unitUpdateLabel = $('updated-at').textContent;
      }
      render();
      renderPagination();
    } catch {
      if (currentRequest !== request) return;
      $('result-count').textContent = 'Consulta indisponível';
      empty(unit.codigo === ALL_UNITS
        ? 'A busca nacional não respondeu agora. Tente novamente ou abra a mesma pesquisa no PNCP.'
        : isCPII(unit)
        ? 'Não foi possível carregar as atas deste campus agora. Selecione outra unidade ou tente novamente.'
        : 'A API pública bloqueou a consulta direta desta UASG. No PNCP, pesquise pelo objeto e selecione o órgão ou a unidade.',
      'Consulta temporariamente indisponível');
      const retry = element('button', 'show-more', 'Tentar novamente');
      retry.type = 'button';
      retry.addEventListener('click', load);
      $('result-list').append(retry);
      if (unit.codigo === ALL_UNITS) {
        updateNationalSearch(filters());
        $('national-search').hidden = false;
      } else {
        const source = element('a', 'source-fallback', 'Consultar atas no PNCP ↗');
        const query = new URLSearchParams({pagina:'1', q:filters().objeto});
        query.set('status', filters().status === 'nao-vigente' ? 'nao_vigente' : filters().status);
        source.href = 'https://pncp.gov.br/app/atas?' + query;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        $('result-list').append(source);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  for (const id of fields) $(id).addEventListener(id === 'ano' ? 'change' : 'input', () => {
    visible = 10;
    if (arpMode && id === 'ano') { exitArpMode(); return; }
    if (arpMode) { render(); return; }
    if (id === 'objeto' && selectedUnit.codigo === ALL_UNITS) scheduleNationalSearch();
    else render();
  });
  document.querySelectorAll('input[name="status"]').forEach(radio => radio.addEventListener('change', () => {
    visible = 10;
    if (arpMode) { render(); return; }
    if (selectedUnit.codigo === ALL_UNITS) scheduleNationalSearch();
    else render();
  }));
  $('clear-filters').addEventListener('click', () => {
    fields.forEach(id => {$(id).value = '';});
    $('arp-cnpj').value = '';
    $('arp-uasg').value = '';
    nationalFields.forEach(id => {$(id).value = '';});
    selectedOrgan = null;
    $('orgao-search').value = '';
    document.querySelector('input[name="status"][value="todos"]').checked = true;
    visible = 10;
    if (arpMode) { exitArpMode(); return; }
    if (selectedUnit.codigo === ALL_UNITS) scheduleNationalSearch();
    else render();
  });
  $('show-more').addEventListener('click', () => {
    if (arpMode) {arpVisible += 20; renderArpResults();}
    else {visible += 10; render();}
  });
  $('previous-page').addEventListener('click', () => {if (nationalPage > 1) {nationalPage--; load();}});
  $('next-page').addEventListener('click', () => {
    if (nationalPage * PAGE_SIZE < Math.min(nationalTotal, MAX_NATIONAL_RESULTS)) {nationalPage++; load();}
  });
  nationalFields.forEach(id => $(id).addEventListener('change', () => {
    if (selectedUnit.codigo === ALL_UNITS) scheduleNationalSearch();
  }));
  $('orgao-search').addEventListener('input', handleOrganInput);
  $('orgao-search').addEventListener('change', handleOrganInput);
  $('unit-search').addEventListener('input', renderUnitOptions);
  $('unit-picker').addEventListener('toggle', () => { if ($('unit-picker').open) $('unit-search').focus(); });
  $('unit-picker').addEventListener('keydown', event => { if (event.key === 'Escape') $('unit-picker').open = false; });
  document.addEventListener('click', event => { if (!$('unit-picker').contains(event.target)) $('unit-picker').open = false; });
  $('arp-form').addEventListener('submit', event => { event.preventDefault(); loadArp(); });
  ['arp-cnpj', 'arp-uasg'].forEach(id => $(id).addEventListener('input', () => {
    if (arpMode) exitArpMode();
    renderChips(filters());
  }));
  renderUnitOptions();
  loadUnitCatalog();
  renderChips(filters());
  load();
})();
