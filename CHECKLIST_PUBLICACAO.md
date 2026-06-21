# Checklist de Publicação — Painel de Contratações da Reitoria

Painel **público e somente leitura**. Toda alteração operacional acontece pelo App Gestão (AppSEL); este painel apenas exibe os dados consolidados. O backend é um Google Apps Script **vinculado à planilha** (container-bound), que lê os dados e os serve via JSONP.

---

## 1. Backend — Apps Script (vinculado à planilha)

- Abrir a planilha de origem dos dados e ir em `Extensões > Apps Script` (o script é vinculado à própria planilha — usa `SpreadsheetApp.getActiveSpreadsheet()`, sem ID configurável).
- Copiar/atualizar `apps-script/Code.gs` no editor.
- Conferir as propriedades do script (`Configurações do projeto > Propriedades do script`), todas opcionais com fallback no código:
  - `PAINEL_WEBAPP_URL` — URL pública do painel, se quiser sobrescrever o fallback.
  - `PAINEL_MUNICIPIO_CALENDARIO` — município dos feriados locais (padrão: `Rio de Janeiro`).
- Confirmar que `PAINEL_SOMENTE_LEITURA` permanece `true` no código (o painel nunca deve escrever na planilha).
- Salvar.
- Implantar como Web App:
  - Executar como: `Eu`.
  - Quem pode acessar: `Qualquer pessoa`.
- Autorizar as permissões solicitadas pelo Google.
- Copiar a URL final terminada em `/exec`.
- Em `Acionadores`, conferir os gatilhos esperados do painel: `atualizacaoDiaria` (atualização de cache) e `onEditAtraso` (recálculo ao editar). **Este painel não envia e-mail** — os avisos por e-mail são responsabilidade do App Gestão.

---

## 2. Frontend — GitHub Pages

- Colar a URL `/exec` em `config.js`, no campo `apiUrl`.
- Enviar os arquivos desta pasta para o repositório do painel.
- Configurar GitHub Pages:
  - Source: `Deploy from a branch`.
  - Branch: `main`.
  - Folder: `/(root)`.
- Deixar `Custom domain` vazio, salvo domínio institucional real com DNS configurado.

---

## 3. Testes obrigatórios

- Abrir o painel publicado no Chrome.
- Abrir o painel publicado no Edge.
- Testar em aba anônima (o painel **não** deve pedir login Google).
- Confirmar que carregam: Gantt/cronograma, KPIs, filtros (modalidade, setor, situação, período) e capacidade por servidor/fase.
- Confirmar que links públicos de processos abrem quando cadastrados.
- Forçar atualização e confirmar que os dados refletem a planilha atual.

---

## 4. Conferência de segurança

- Confirmar que o repositório **não** contém ID real da planilha.
- Confirmar que o repositório **não** contém e-mail pessoal.
- Confirmar que **não** há planilhas, PDFs ou documentos administrativos versionados.
- Confirmar que o painel é somente leitura (nunca escreve na planilha).
- Após a migração para o Firestore: confirmar que **nenhuma chave de conta de serviço** (`*.json`) foi versionada — elas ficam só nas propriedades do script / fora do Git (já cobertas pelo `.gitignore`).

---

## 5. Solução de problemas

- Painel não carrega dados: conferir se `config.js` tem a URL `/exec` correta.
- Funciona no Chrome e falha no Edge: testar em aba anônima e confirmar implantação como Web App acessível por `Qualquer pessoa`.
- Erro de CORS: confirmar que o painel usa JSONP (callback) e não `fetch` comum.
- GitHub Pages não atualiza: aguardar alguns minutos e conferir a aba `Actions`.
- Mudança no nome do repositório: atualizar links no README e atalhos salvos.

---

> **Nota de migração:** há um plano de mover a base de dados para o Firestore (ver `PLANO_ORGANIZACAO_E_MIGRACAO.md` no repositório do App Gestão). Quando isso ocorrer, este checklist será atualizado: a leitura passará a vir do Firestore, e o backend Apps Script deste painel poderá ser aposentado ou reduzido. O painel continuará público e somente leitura.
