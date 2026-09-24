(function () {
  'use strict';
  const logic = window.AtasLogic;
  const $ = id => document.getElementById(id);
  const fields = ['objeto', 'numero', 'ano', 'compra'];
  const labels = {objeto:'Objeto', numero:'Ata', ano:'Ano da ata', compra:'Compra'};
  const statusLabels = {vigente:'Vigente', 'nao-vigente':'Não vigente', indefinida:'Situação a conferir'};
  let items = [];
  let loaded = false;
  let visible = 10;
  const openGroups = new Set();
  const DEFAULT_UNIT = '153167';
  const ALL_UNITS = '*';
  const allUnits = {codigo:ALL_UNITS, nome:'Todas as UASGs · busca nacional'};
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
    return {...Object.fromEntries(fields.map(id => [id, $(id).value.trim()])), status:checked ? checked.value : 'todos'};
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
      all.append(element('small', '', 'CPII no painel · todos os órgãos no PNCP'));
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
    if (currentRequest) currentRequest.abort();
    selectedUnit = unit;
    $('selected-unit').textContent = displayUnit(unit);
    $('coverage-text').textContent = unit.codigo === ALL_UNITS
      ? 'Resultados desta página: atas gerenciadas pelas UASGs do Colégio Pedro II. Para consultar atas de qualquer órgão, abra a busca nacional do PNCP com o objeto informado.'
      : `Atas gerenciadas pela UASG ${unit.codigo}. Participações e adesões a atas de outros órgãos não estão incluídas. A unidade selecionada no painel não altera esta consulta.`;
    $('national-search').hidden = unit.codigo !== ALL_UNITS;
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

  function card(ata, today) {
    const article = element('article', 'ata-row');
    const number = element('div', 'ata-number');
    number.append(element('span', 'cell-label', 'Ata'), element('strong', '', ata.numeroAtaRegistroPreco || 'Sem número'));
    if (selectedUnit.codigo === ALL_UNITS) number.append(element('small', 'ata-unit',
      `${ata.nomeUnidadeGerenciadora || 'Unidade do CPII'} · UASG ${ata.codigoUnidadeGerenciadora}`));
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
    active.forEach(([key, label]) => {
      const button = element('button', 'filter-chip', `${label} ×`);
      button.type = 'button';
      button.setAttribute('aria-label', `Remover filtro ${label}`);
      button.addEventListener('click', () => {
        $(key).value = '';
        visible = 10;
        render();
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
    // O PNCP não tem filtro de UASG aqui; mantemos a busca nacional sem restrição.
    link.href = 'https://pncp.gov.br/app/atas?' + query;
    link.textContent = f.objeto
      ? 'Buscar “' + f.objeto + '” em todos os órgãos no PNCP ↗'
      : 'Buscar em todos os órgãos no PNCP ↗';
  }

  function render() {
    const f = filters();
    renderChips(f);
    updateNationalSearch(f);
    if (!loaded) return;
    const today = todayInBrazil();
    const result = logic.filterAtas(items, f, today);
    const groups = new Map();
    result.forEach(ata => {
      const key = logic.normalize(ata.objeto);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ata);
    });
    $('result-count').textContent = `${result.length} ${result.length === 1 ? 'ata' : 'atas'}${selectedUnit.codigo === ALL_UNITS ? ' do CPII' : ''} em ${groups.size} ${groups.size === 1 ? 'objeto' : 'objetos'}`;
    if (!result.length) {
      empty('Tente mudar o status, usar menos palavras ou limpar os filtros.', 'Nenhuma ata encontrada');
      return;
    }
    const output = document.createDocumentFragment();
    const expand = Boolean(f.objeto || f.numero || f.ano || f.compra) || groups.size <= 3;
    [...groups].slice(0, visible).forEach(([key, records], index) => {
      output.append(objectGroup(key, records[0].objeto, records, today, expand || index === 0));
    });
    $('result-list').replaceChildren(output);
    $('show-more').hidden = groups.size <= visible;
    $('show-more').textContent = `Mostrar mais objetos (${groups.size - visible} restantes)`;
  }

  function loadYears() {
    $('ano').replaceChildren(element('option', '', 'Todos os anos'));
    $('ano').firstChild.value = '';
    const years = [...new Set(items.map(logic.ataYear).filter(Boolean))].sort().reverse();
    years.forEach(year => {
      const option = element('option', '', year);
      option.value = year;
      $('ano').append(option);
    });
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
    if (!payload.generatedAt || !Array.isArray(payload.items) || (code !== ALL_UNITS && !payload.units?.includes(code))) {
      throw new Error('A unidade ainda não está na base atualizada do CPII');
    }
    return {items:payload.items.filter(ata => code === ALL_UNITS || String(ata.codigoUnidadeGerenciadora) === code), generatedAt:payload.generatedAt, cached:true};
  }

  async function loadAllCPII(signal) {
    const [reitoria, campi] = await Promise.all([loadDefault(signal), loadCPII(ALL_UNITS, signal)]);
    const unique = new Map();
    [...reitoria.items, ...campi.items].forEach(ata => {
      const key = ata.numeroControlePncpAta ||
        [ata.codigoUnidadeGerenciadora, ata.numeroAtaRegistroPreco, ata.numeroCompra, ata.anoCompra].join('|');
      unique.set(key, ata);
    });
    return {items:[...unique.values()],
      generatedAt:new Date(Math.min(Date.parse(reitoria.generatedAt), Date.parse(campi.generatedAt))).toISOString(),
      cached:true};
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

  async function load() {
    const unit = selectedUnit;
    const request = new AbortController();
    currentRequest = request;
    loaded = false;
    items = [];
    $('result-count').textContent = unit.codigo === ALL_UNITS ? 'Consultando UASGs do CPII…' : `Consultando UASG ${unit.codigo}…`;
    $('updated-at').textContent = '';
    empty('Buscando atas da unidade selecionada…');
    const timeout = setTimeout(() => request.abort(), 90000);
    try {
      const payload = unitCache.get(unit.codigo) ||
        (unit.codigo === ALL_UNITS ? await loadAllCPII(request.signal) :
          unit.codigo === DEFAULT_UNIT ? await loadDefault(request.signal) :
          isCPII(unit) ? await loadCPII(unit.codigo, request.signal) :
            await loadFromCompras(unit.codigo, request.signal));
      if (currentRequest !== request) return;
      unitCache.set(unit.codigo, payload);
      if (unitCache.size > 4) unitCache.delete(unitCache.keys().next().value);
      items = payload.items;
      loadYears();
      renderChips(filters());
      const stamp = new Intl.DateTimeFormat('pt-BR', {timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(payload.generatedAt));
      const delayed = Date.now() - new Date(payload.generatedAt).valueOf() > 48 * 60 * 60 * 1000;
      $('updated-at').textContent = `${payload.cached ? 'Dados atualizados' : 'Consulta realizada'} em ${stamp} (horário de Brasília)${delayed ? ' · Confira a ata no PNCP' : ''}`;
      loaded = true;
      render();
    } catch {
      if (currentRequest !== request) return;
      $('result-count').textContent = 'Consulta indisponível';
      empty(unit.codigo === ALL_UNITS
        ? 'Não foi possível carregar todas as unidades do CPII agora. Você ainda pode buscar o objeto em todos os órgãos no PNCP.'
        : isCPII(unit)
        ? 'Não foi possível carregar as atas deste campus agora. Selecione outra unidade ou tente novamente.'
        : 'A API pública bloqueou a consulta direta desta UASG. No PNCP, pesquise pelo objeto e selecione o órgão ou a unidade.',
      'Consulta temporariamente indisponível');
      const retry = element('button', 'show-more', 'Tentar novamente');
      retry.type = 'button';
      retry.addEventListener('click', load);
      $('result-list').append(retry);
      const source = element('a', 'source-fallback', 'Consultar atas no PNCP ↗');
      const query = new URLSearchParams({pagina:'1', q:filters().objeto});
      if (filters().status === 'vigente') query.set('status', 'vigente');
      if (filters().status === 'todos') query.set('status', 'todos');
      if (filters().status === 'nao-vigente') query.set('status', 'nao_vigente');
      source.href = 'https://pncp.gov.br/app/atas?' + query;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      $('result-list').append(source);
    } finally {
      clearTimeout(timeout);
    }
  }

  for (const id of fields) $(id).addEventListener(id === 'ano' ? 'change' : 'input', () => {visible = 10; render();});
  document.querySelectorAll('input[name="status"]').forEach(radio => radio.addEventListener('change', () => {visible = 10; render();}));
  $('clear-filters').addEventListener('click', () => {
    fields.forEach(id => {$(id).value = '';});
    document.querySelector('input[name="status"][value="todos"]').checked = true;
    visible = 10;
    render();
  });
  $('show-more').addEventListener('click', () => {visible += 10; render();});
  $('unit-search').addEventListener('input', renderUnitOptions);
  $('unit-picker').addEventListener('toggle', () => { if ($('unit-picker').open) $('unit-search').focus(); });
  $('unit-picker').addEventListener('keydown', event => { if (event.key === 'Escape') $('unit-picker').open = false; });
  document.addEventListener('click', event => { if (!$('unit-picker').contains(event.target)) $('unit-picker').open = false; });
  renderUnitOptions();
  loadUnitCatalog();
  renderChips(filters());
  load();
})();
