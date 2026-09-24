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

  function addDetail(parent, label, value) {
    const div = element('div');
    div.append(element('dt', '', label), element('dd', '', value || 'Não informado'));
    parent.append(div);
  }

  function addLink(parent, urlValue, label) {
    const url = safePNCP(urlValue);
    if (!url) {
      parent.append(element('span', 'missing-link', `${label} indisponível no PNCP`));
      return;
    }
    const a = element('a', '', `${label} ↗`);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    parent.append(a);
  }

  function card(ata, today) {
    const article = element('article', 'ata-card');
    const top = element('div', 'card-top');
    const title = element('strong', 'card-identity', `Ata ${ata.numeroAtaRegistroPreco || 'sem número'}`);
    const status = logic.situation(ata, today);
    top.append(title, element('span', `badge ${status}`, statusLabels[status]));
    const details = element('dl', 'card-details');
    addDetail(details, 'COMPRA', [ata.numeroCompra, ata.anoCompra].filter(Boolean).join('/'));
    addDetail(details, 'VIGÊNCIA', `${formatDate(ata.dataVigenciaInicial)} a ${formatDate(ata.dataVigenciaFinal)}`);
    const links = element('div', 'card-links');
    addLink(links, ata.linkAtaPNCP, 'Ver ata e documentos');
    addLink(links, ata.linkCompraPNCP, 'Ver compra');
    article.append(top, details, links);
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
    const summary = element('summary', 'object-heading');
    summary.append(element('span', 'object-title', description),
      element('span', 'object-count', `${records.length} ${records.length === 1 ? 'ata' : 'atas'} deste objeto`));
    heading.append(summary);
    if (description.length > 230) {
      heading.append(element('p', 'object-full', description));
    }
    const rows = element('div', 'object-rows');
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

  function render() {
    const f = filters();
    renderChips(f);
    if (!loaded) return;
    const today = todayInBrazil();
    const result = logic.filterAtas(items, f, today);
    const groups = new Map();
    result.forEach(ata => {
      const key = logic.normalize(ata.objeto);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ata);
    });
    $('result-count').textContent = `${result.length} ${result.length === 1 ? 'ata' : 'atas'} em ${groups.size} ${groups.size === 1 ? 'objeto' : 'objetos'}`;
    if (!result.length) {
      empty('Tente mudar o status, usar menos palavras ou limpar os filtros.', 'Nenhuma ata encontrada');
      return;
    }
    const output = document.createDocumentFragment();
    const expand = Boolean(f.objeto || f.numero || f.ano || f.compra) || groups.size <= 3;
    [...groups].slice(0, visible).forEach(([key, records]) => {
      output.append(objectGroup(key, records[0].objeto, records, today, expand));
    });
    $('result-list').replaceChildren(output);
    $('show-more').hidden = groups.size <= visible;
    $('show-more').textContent = `Mostrar mais objetos (${groups.size - visible} restantes)`;
  }

  function loadYears() {
    const years = [...new Set(items.map(logic.ataYear).filter(Boolean))].sort().reverse();
    years.forEach(year => {
      const option = element('option', '', year);
      option.value = year;
      $('ano').append(option);
    });
  }

  async function load() {
    try {
      // O workflow atualiza o arquivo no GitHub. O Pages hospedado por branch
      // pode não recompilar após commits feitos pelo GITHUB_TOKEN.
      let response;
      try {
        response = await fetch('https://raw.githubusercontent.com/decofcp2-afk/painel-contratacoes-reitoria/main/atas-data.json', {cache:'no-cache'});
        if (!response.ok) throw new Error('Arquivo no GitHub indisponível');
      } catch {
        response = await fetch('atas-data.json', {cache:'no-cache'});
      }
      if (!response.ok) throw new Error('Falha ao carregar arquivo de atas');
      const payload = await response.json();
      if (!payload.generatedAt || !Array.isArray(payload.items)) {
        $('result-count').textContent = 'Aguardando dados';
        empty('A primeira atualização do Compras.gov.br ainda não foi concluída. Volte em breve.', 'Consulta em preparação');
        return;
      }
      items = payload.items.filter(ata => ata && typeof ata === 'object' && String(ata.codigoUnidadeGerenciadora) === '153167');
      const generated = new Date(payload.generatedAt);
      if (!Number.isNaN(generated.valueOf())) {
        const stamp = new Intl.DateTimeFormat('pt-BR', {timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(generated);
        const delayed = Date.now() - generated.valueOf() > 48 * 60 * 60 * 1000;
        $('updated-at').textContent = `Dados atualizados em ${stamp} (horário de Brasília)${delayed ? ' · Atualização atrasada; confira a ata no PNCP' : ''}`;
      }
      loaded = true;
      loadYears();
      render();
    } catch {
      $('result-count').textContent = 'Indisponível';
      empty('Não foi possível carregar as atas agora. Tente novamente mais tarde ou consulte o PNCP.', 'Consulta temporariamente indisponível');
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
  renderChips(filters());
  load();
})();
