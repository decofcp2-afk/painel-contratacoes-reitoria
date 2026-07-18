'use strict';
// ════════════════════════════════════════════════════════════════════════
// Testes da lógica pura do Painel (painel-logic.js) — a MESMA que o
// navegador usa para filtrar o Gantt, montar os KPIs e o chip de modalidade.
// Vários cenários aqui fixam regressões de bugs reais já corrigidos.
//
// Rodar: npm test   (ou: node --test tests/)
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../painel-logic.js');

// Builder de processo no shape que o backend entrega ao painel.
function proc(o) {
  return Object.assign({
    num: '23040.000001/2026-11', nome: 'Objeto', status: 'andamento',
    execucao: 10, modalidade: 'PE', inicio: 0, fim: 5, tipoCD: ''
  }, o);
}

// ── Subtipo da Contratação Direta ───────────────────────────────────────
test('subtipoCDLabel reconhece os 4 subtipos do app de gestão', () => {
  assert.equal(L.subtipoCDLabel('Adesão'), 'Adesão (carona)');
  assert.equal(L.subtipoCDLabel('Dispensa com disputa'), 'Dispensa c/ disputa');
  assert.equal(L.subtipoCDLabel('Dispensa sem disputa'), 'Dispensa s/ disputa');
  assert.equal(L.subtipoCDLabel('Inexigibilidade'), 'Inexigibilidade');
});

test('subtipoCDLabel: vazio → ""; valor livre passa como veio; acentos tolerados', () => {
  assert.equal(L.subtipoCDLabel(''), '');
  assert.equal(L.subtipoCDLabel(undefined), '');
  assert.equal(L.subtipoCDLabel('adesao'), 'Adesão (carona)'); // sem acento
  assert.equal(L.subtipoCDLabel('Dispensa'), 'Dispensa');
  assert.equal(L.subtipoCDLabel('Outro Tipo'), 'Outro Tipo');
});

// ── Chip de modalidade ──────────────────────────────────────────────────
test('modalidadeChip monta o rótulo certo por modalidade', () => {
  assert.match(L.modalidadeChip('PE'), /Pregão Eletrônico/);
  assert.match(L.modalidadeChip('CC'), /Concorrência/);
  assert.match(L.modalidadeChip('CD'), /Contratação Direta/);
});

test('modalidadeChip: CD com subtipo → "Contratação Direta · <subtipo>"; sem subtipo fica só o tipo central', () => {
  assert.match(L.modalidadeChip('CD', 'Adesão'), /Contratação Direta · Adesão \(carona\)/);
  const semSub = L.modalidadeChip('CD', '');
  assert.match(semSub, /Contratação Direta/);
  assert.doesNotMatch(semSub, /·/);
});

test('modalidadeChip: subtipo só se aplica a CD; modalidade desconhecida → ""', () => {
  assert.doesNotMatch(L.modalidadeChip('PE', 'Adesão'), /Adesão/);
  assert.equal(L.modalidadeChip(''), '');
  assert.equal(L.modalidadeChip('XX'), '');
});

test('modalidadeChip escapa HTML vindo da planilha (anti-XSS)', () => {
  const chip = L.modalidadeChip('CD', '<script>alert(1)</script>');
  assert.doesNotMatch(chip, /<script>/);
  assert.match(chip, /&lt;script&gt;/);
});

// ── Filtro: semântica dos botões de status ──────────────────────────────
const BASE = [
  proc({ num: 'P-AND',  status: 'andamento',    execucao: 40 }),
  proc({ num: 'P-ATR',  status: 'atrasado',     execucao: 60 }),
  proc({ num: 'P-ATRC', status: 'atrasado',     execucao: 100 }), // atrasado já concluído
  proc({ num: 'P-AGU',  status: 'aguardando',   execucao: 30 }),
  proc({ num: 'P-PAR',  status: 'paralisado',   execucao: 20 }),
  proc({ num: 'P-OK',   status: 'ok',           execucao: 100 }),
  proc({ num: 'P-PLA',  status: 'planejamento', execucao: 0 }),
  proc({ num: 'P-FIL',  status: 'fila',         execucao: 0 })
];
function nums(lista) { return lista.map(p => p.num); }

test('"Todos" mostra andamento+atrasados+concluídos e exclui a fila', () => {
  const r = L.filtrarProcessos(BASE, { status: '' });
  assert.deepEqual(nums(r).sort(), ['P-AGU', 'P-AND', 'P-ATR', 'P-ATRC', 'P-OK', 'P-PAR']);
});

test('"Andamento" inclui aguardando/paralisado e atrasado não concluído', () => {
  const r = L.filtrarProcessos(BASE, { status: 'andamento' });
  assert.deepEqual(nums(r).sort(), ['P-AGU', 'P-AND', 'P-ATR', 'P-PAR']);
});

test('"Atrasado" exclui atrasados já 100% concluídos', () => {
  const r = L.filtrarProcessos(BASE, { status: 'atrasado' });
  assert.deepEqual(nums(r), ['P-ATR']);
});

test('"Em fila" junta planejamento e devolvidos à fila', () => {
  const r = L.filtrarProcessos(BASE, { status: 'planejamento' });
  assert.deepEqual(nums(r).sort(), ['P-FIL', 'P-PLA']);
});

// ── Filtro: busca e ano ─────────────────────────────────────────────────
test('busca é case-insensitive e casa em número OU objeto', () => {
  const dados = [
    proc({ num: '23040.002820/2026-11', nome: 'Agenciamento de Viagem' }),
    proc({ num: '23040.999999/2026-11', nome: 'Material de Limpeza' })
  ];
  assert.equal(L.filtrarProcessos(dados, { q: 'VIAGEM' }).length, 1);
  assert.equal(L.filtrarProcessos(dados, { q: '2820' }).length, 1);
  assert.equal(L.filtrarProcessos(dados, { q: 'nada' }).length, 0);
});

test('filtro de ano casa por sobreposição de meses (anoBase)', () => {
  const dados = [
    proc({ num: 'P-26', inicio: 0,  fim: 11 }),  // 2026 inteiro
    proc({ num: 'P-27', inicio: 12, fim: 20 }),  // só 2027
    proc({ num: 'P-26-27', inicio: 10, fim: 14 }) // vira o ano
  ];
  assert.deepEqual(nums(L.filtrarProcessos(dados, { ano: '2026', anoBase: 2026 })).sort(), ['P-26', 'P-26-27']);
  assert.deepEqual(nums(L.filtrarProcessos(dados, { ano: '2027', anoBase: 2026 })).sort(), ['P-26-27', 'P-27']);
});

// ── Filtro: modalidade (legenda) e o vazamento para o mobile ────────────
test('legenda filtra por modalidade no desktop (case-insensitive)', () => {
  const dados = [proc({ num: 'A', modalidade: 'CD' }), proc({ num: 'B', modalidade: 'PE' }), proc({ num: 'C', modalidade: 'cc' })];
  assert.deepEqual(nums(L.filtrarProcessos(dados, { modal: 'CD' })), ['A']);
  assert.deepEqual(nums(L.filtrarProcessos(dados, { modal: 'CC' })), ['C']);
});

test('REGRESSÃO: filtro da legenda NÃO vaza para o mobile (mobile:true ignora modal)', () => {
  const dados = [proc({ num: 'A', modalidade: 'CD' }), proc({ num: 'B', modalidade: 'PE' })];
  assert.equal(L.filtrarProcessos(dados, { modal: 'CD', mobile: true }).length, 2);
  assert.equal(L.filtrarProcessos(dados, { modal: 'CD', mobile: false }).length, 1);
});

// ── Ordenação ───────────────────────────────────────────────────────────
test('ordenação: atrasado em curso no topo; concluídos sempre no fim', () => {
  const r = L.ordenarProcessos([
    proc({ num: 'OK',  status: 'ok', execucao: 100 }),
    proc({ num: 'AND', status: 'andamento' }),
    proc({ num: 'ATRC', status: 'atrasado', execucao: 100 }),
    proc({ num: 'ATR', status: 'atrasado', execucao: 50 }),
    proc({ num: 'PLA', status: 'planejamento' })
  ]);
  assert.equal(r[0].num, 'ATR', 'atrasado em curso primeiro');
  assert.deepEqual(nums(r).slice(-2).sort(), ['ATRC', 'OK'], 'concluídos (mesmo atrasados) por último');
  // Não muta o array original
  assert.equal(L.ordenarProcessos(Object.freeze([proc({})])).length, 1);
});

// ── KPIs ────────────────────────────────────────────────────────────────
test('KPIs contam por status: total exclui fila; atrasado-concluído vira concluído', () => {
  const filtered = L.filtrarProcessos(BASE, { status: '' });
  const k = L.calcularKPIs(filtered, BASE, { status: '' });
  assert.equal(k.concluidos, 2, 'P-OK + P-ATRC (atrasado 100%)');
  assert.equal(k.atrasados, 1, 'só P-ATR segue atrasado');
  assert.equal(k.andamento, 4, 'AND+AGU+PAR+ATR');
  assert.equal(k.tot, 6, 'todos menos a fila');
  assert.equal(k.fila, 2, 'P-PLA + P-FIL');
});

test('REGRESSÃO: KPI "Em fila" respeita o filtro de modalidade da legenda', () => {
  const dados = [
    proc({ num: 'A', status: 'planejamento', modalidade: 'CD' }),
    proc({ num: 'B', status: 'planejamento', modalidade: 'PE' }),
    proc({ num: 'C', status: 'andamento', modalidade: 'CD' })
  ];
  const filtered = L.filtrarProcessos(dados, { status: '', modal: 'CD' });
  assert.equal(L.calcularKPIs(filtered, dados, { status: '', modal: 'CD' }).fila, 1, 'desktop: só a fila CD');
  assert.equal(L.calcularKPIs(filtered, dados, { status: '', modal: 'CD', mobile: true }).fila, 2, 'mobile ignora a legenda');
});

test('KPI "Em fila" com filtro de status ativo usa o próprio array filtrado', () => {
  const filtered = L.filtrarProcessos(BASE, { status: 'planejamento' });
  assert.equal(L.calcularKPIs(filtered, BASE, { status: 'planejamento' }).fila, 2);
});
