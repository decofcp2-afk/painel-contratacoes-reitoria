/* Funções puras da consulta de atas; também usadas pelos testes Node. */
(function (root, factory) {
  const logic = factory();
  if (typeof module === 'object' && module.exports) module.exports = logic;
  else root.AtasLogic = logic;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalize(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function datePart(value) {
    const match = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
    if (!match) return '';
    const date = new Date(match[1] + 'T12:00:00Z');
    return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== match[1] ? '' : match[1];
  }

  function ataYear(ata) {
    const number = String(ata.numeroAtaRegistroPreco ?? '');
    const match = number.match(/(?:^|\/)\s*((?:19|20)\d{2})(?:\D|$)/);
    return match ? match[1] : datePart(ata.dataAssinatura).slice(0, 4);
  }

  function situation(ata, today) {
    const status = normalize(ata.statusAta);
    if (ata.ataExcluido === true || ata.ataExcluido === 1 || ata.ataExcluido === '1' ||
        /excluid|cancelad|encerrad|inativ|revogad|anulad/.test(status)) return 'nao-vigente';
    const start = datePart(ata.dataVigenciaInicial);
    const end = datePart(ata.dataVigenciaFinal);
    if (!start || !end) return 'indefinida';
    return start <= today && today <= end ? 'vigente' : 'nao-vigente';
  }

  function filterAtas(items, filters, today) {
    const objectTerms = normalize(filters.objeto).split(/\s+/).filter(Boolean);
    const number = normalize(filters.numero);
    const purchase = normalize(filters.compra);
    const result = items.filter(ata => {
      const status = situation(ata, today);
      return (filters.status === 'todos' || status === filters.status) &&
        objectTerms.every(term => normalize(ata.objeto).includes(term)) &&
        (!number || normalize(ata.numeroAtaRegistroPreco).includes(number)) &&
        (!filters.ano || ataYear(ata) === filters.ano) &&
        (!purchase || normalize([ata.numeroCompra, ata.anoCompra].filter(Boolean).join('/')).includes(purchase));
    });
    // O objeto é o primeiro critério de organização; as atas do mesmo objeto ficam juntas.
    return result.sort((a, b) => normalize(a.objeto).localeCompare(normalize(b.objeto), 'pt-BR') ||
      String(a.numeroAtaRegistroPreco ?? '').localeCompare(String(b.numeroAtaRegistroPreco ?? ''), 'pt-BR', {numeric:true}));
  }

  return {normalize, datePart, ataYear, situation, filterAtas};
});
