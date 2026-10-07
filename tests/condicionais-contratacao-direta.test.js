'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { construirProcessos } = require('../painel-firestore.js');

function cenario(tipoCD, statusExterna = 'Não iniciada') {
  const processos = [{ id: 'P1', modalidade: 'Contratação Direta', tipoCD, d0: '2026-01-02', temIrp: false }];
  const etapas = [
    { processoId: 'P1', ordem: 7, etapa: 'Envio ao SEL/SEPMA', fase: 'Interna', status: 'Concluída', prazoDias: 3, dataRealizacao: '2026-01-07' },
    { processoId: 'P1', ordem: 8, etapa: 'Fase externa — Contratação Direta', fase: 'Externa', status: statusExterna, prazoDias: 30 }
  ];
  return { processos, etapas };
}

test('Inexigibilidade com externa pendente gravada termina em 100%, sem alerta de atraso histórico', () => {
  const { processos, etapas } = cenario('Inexigibilidade');
  const p = construirProcessos(processos, etapas).processos[0];
  assert.equal(p.execucao, 100);
  assert.equal(p.status, 'ok');
  assert.equal(p.etapas.length, 1);
  assert.equal(p.fim_iso, '2026-01-07');
  assert.equal(etapas[1].status, 'Não iniciada');
  assert.equal(p.etapas[0].dias, 2); // histórico de atraso permanece
});

for (const tipo of ['Dispensa com disputa', 'Dispensa sem disputa']) {
  for (const status of ['Não iniciada', 'Não se aplica']) {
    test(`${tipo} mantém externa inclusive com status antigo ${status}`, () => {
      const { processos, etapas } = cenario(tipo, status);
      const p = construirProcessos(processos, etapas).processos[0];
      assert.equal(p.etapas.length, 2);
      assert.equal(p.execucao, 50);
      assert.notEqual(p.status, 'ok');
      assert.equal(p.fim_iso, '2026-02-06');
    });
  }
}

test('Adesão deriva as etapas não aplicáveis e preserva etapas concluídas', () => {
  const { processos, etapas } = cenario('Adesão');
  processos[0].temIrp = true;
  ['Minuta do Termo de Referência', 'IRP', 'Versão final do TR'].forEach((etapa, i) => {
    etapas.push({ processoId: 'P1', ordem: i + 3, etapa, status: 'Não iniciada', prazoDias: 15 });
  });
  const p = construirProcessos(processos, etapas).processos[0];
  assert.equal(p.execucao, 100);
  assert.equal(p.etapas.length, 1);
  etapas[1].status = 'Concluída';
  assert.equal(construirProcessos(processos, etapas).processos[0].etapas.length, 2);
});

test('Marcador de retorno permanece visível mesmo em etapa não aplicável', () => {
  const { processos, etapas } = cenario('Inexigibilidade', 'Não se aplica');
  etapas[1].motivoAtraso = 'RETORNO PARA FILA: corrigir documentos';
  const p = construirProcessos(processos, etapas).processos[0];
  assert.equal(p.status, 'fila');
  assert.equal(p.etapas.length, 2);
});

test('Pregão e concorrência mantêm a fase externa', () => {
  for (const modalidade of ['Pregão Eletrônico', 'Concorrência']) {
    const { processos, etapas } = cenario('');
    processos[0].modalidade = modalidade;
    const p = construirProcessos(processos, etapas).processos[0];
    assert.equal(p.etapas.length, 2);
    assert.equal(p.execucao, 50);
  }
});
