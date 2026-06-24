# Plano de Segurança — Camada de Abstração

> **Objetivo:** introduzir uma camada de abstração entre as telas e os recursos
> sensíveis (backend, dados, sessão, renderização) para elevar a segurança do
> sistema sem reescrever tudo de uma vez. Cada fase é incremental e mantém o
> comportamento atual funcionando.

Aplicável a **painel-contratacoes-reitoria** e, em paralelo, ao
**app_gestao-reitoria** (que compartilha o mesmo padrão de arquitetura).

---

## 1. Diagnóstico do estado atual

| Aspecto | Situação hoje | Risco |
|---|---|---|
| Frontend | `index.html` monolítico com lógica, dados e UI misturados | Difícil auditar; superfície de erro grande |
| Acesso a dados | `fetch()` ao Apps Script + leituras diretas do Firestore (`painel-firestore.js`) espalhadas | Sem ponto único de controle/validação |
| Autenticação | Fluxo de sessão herdado do Apps Script | Endpoints precisam de checagem de token consistente |
| Renderização | ~28 usos de `innerHTML` sem sanitização central | Risco de XSS |
| Cabeçalhos | Sem Content-Security-Policy; scripts externos sem SRI | XSS / script externo adulterado |
| Firestore | Leitura pública, escrita só via service account | OK no modelo escolhido, mas cliente acessa direto |

**Conclusão:** a "camada de abstração de segurança" consiste em **centralizar
acesso a dados, autenticação, validação e renderização** em módulos com
fronteiras claras, substituindo as chamadas dispersas.

---

## 2. Princípios

1. **Ponto único de entrada** para cada recurso sensível (dados, sessão, DOM).
2. **Cliente nunca é confiável** — toda validação do cliente é revalidada no Apps Script.
3. **Incremental** — nenhuma fase quebra o que já funciona; rollout com *report-only* antes de *enforce*.
4. **Reuso entre os dois repos** — os módulos nascem genéricos para virarem base comum.

---

## 3. Fases

### Fase 0 — Fundação e baseline (sem mudar comportamento)
- [x] **CSP** via `<meta http-equiv="Content-Security-Policy">` no `index.html`. (Report-only **não** é suportado por `<meta>` e o site é estático no GitHub Pages, então a CSP é enforcing e permissiva — `'unsafe-inline'` para script/style — para não quebrar. **Verificar em navegador** antes de tirar o PR de draft.)
- [x] Meta `referrer` = `strict-origin-when-cross-origin`.
- [ ] **SRI** (`integrity` + `crossorigin`) nos scripts externos (`firebase-app-compat`, `firebase-firestore-compat`). **Bloqueado neste ambiente**: o egress nega `www.gstatic.com`, impedindo o cálculo do hash `sha384`. Calcular num ambiente com acesso e fixar a versão.
- [ ] Criar pasta `src/` (ou `js/`) para iniciar a quebra do `index.html`.
- [ ] Inventariar todas as chamadas: cada `fetch()`, cada leitura Firestore, cada `innerHTML`.

### Fase 1 — Camada de Acesso a Dados (`data-gateway.js`)
Único módulo autorizado a falar com o backend.

**Estado em 2026-06-23:** o painel é um **dashboard somente leitura** (sem
escrita e sem login/token), então a Fase 1 aqui é mais simples que no
`app_gestao-reitoria`. A leitura já está concentrada **inline** no `index.html`
(`chamarApiPainel_`/`chamarApiPainelJsonp_`/`montarUrlApiPainel_`, ~linhas
1160–1268) e isolada em `painel-firestore.js` (`PainelFirestore.carregar*`). O
despacho Firestore-first com fallback ao Apps Script vive em
`obterDadosPainel_()`. Falta apenas **extrair** para módulo próprio.

- [x] `api.read(route, params)` — leitura encapsulada em `PainelFirestore` (Firestore) com fallback ao Apps Script via `chamarApiPainel_`; despacho em `obterDadosPainel_()`.
- [N/A] `api.write` / **token automático** — não se aplica: o painel não escreve nem autentica (rota pública somente leitura).
- [x] Centraliza timeout (30 s) e tratamento de erro com fallback JSONP em `chamarApiPainel_`.
- [x] Gateway **extraído** para `data-gateway.js` (2026-06-23): transporte (`chamarApiPainel_`/`montarUrlApiPainel_`/`chamarApiPainelJsonp_`) + despacho de leitura Firestore-first (`obterDadosPainel_`/`obterCapacidade_`). Expõe `PainelGateway.lerDados`/`lerCapacidade`; aliases globais mantidos por compat. **Verificado no navegador** (carrega 13 processos + capacidade, sem erros).

**Fase 1 concluída para o painel** — por ser somente leitura, não há `api.write`/token a padronizar. Próxima: Fase 3 (sanitização/anti-XSS, ~28 `innerHTML`).

### Fase 2 — Camada de Autenticação/Sessão (`auth.js` + endurecimento no `Code.gs`)
- [ ] Cliente: guardião de sessão (armazenamento, expiração, renovação, logout automático em 401).
- [ ] Servidor: revisar credenciais e forçar troca de senha inicial onde houver login.
- [ ] Expiração/rotação de token; checagem de token aplicada de forma consistente em **todos** os endpoints de escrita.
- [ ] Verificar que nenhuma rota sensível responde sem token válido.

### Fase 3 — Camada de Sanitização/Renderização (anti-XSS)
**Estado em 2026-06-24:** auditoria dos ~28 `innerHTML` concluída. A grande maioria
já era segura: usa o helper `esc()` (escaper HTML completo — `&<>"'`, def. ~L1070)
nos dados do backend, ou injeta apenas markup/SVG estático e constantes. Foram
encontrados e corrigidos **2 pontos** que injetavam dado do backend cru:
- [x] `atualizarRodapeUnidade` (~L2793): `emailInstitucional` → agora `esc(d.emailInstitucional)`.
- [x] `abrirTrocaUnidade` (~L2810): `u.id`/`u.nome` no `<option>` → agora `esc(u.id)`/`esc(u.nome||u.id)`.
- [x] Regra geral atendida: nenhum dado do backend entra mais via `innerHTML` cru.
- [ ] (Opcional/futuro) Extrair helpers `dom.text`/`dom.html` formais substituindo `esc()` + `innerHTML`.
- [x] **Migrados os ~22 handlers inline (`onclick=`/`oninput=`/`onchange=`) para `addEventListener`** (fiação `wireEvents()` no fim do `painel-ui.js`, via id/classe/`data-*`). Zero handlers inline restantes (verificado: `[onclick],[oninput],[onchange]` = 0).
- [x] **Os 2 blocos `<script>` inline foram externalizados** para `painel-core.js` (~73 KB, lógica/render) e `painel-ui.js` (~6 KB, modais/handlers), carregados após `data-gateway.js` na mesma ordem.
- [x] **CSP `script-src` SEM `'unsafe-inline'`** (enforce) — só `'self'` + gstatic/script.google(usercontent). `style-src` mantém `'unsafe-inline'` (estilos dinâmicos do Gantt; risco baixo). **Verificado no preview**: 13 processos carregam, filtro de status e modal de unidades funcionam, sem violações de CSP no console.
- [ ] (Futuro, baixa prioridade) Endurecer `style-src` exigiria refatorar ~46 estilos inline (inclusive larguras dinâmicas) — ganho marginal, deixado fora.

### Fase 4 — Camada de Validação de Entrada (`validators.js`)
- [ ] Regras de validação compartilhadas (datas, status, identificadores, etc.).
- [ ] Validação no cliente (UX) **e** revalidação no Apps Script (segurança real).

### Fase 5 — Consolidação / biblioteca compartilhada
- [ ] Extrair `data-gateway`, `auth`, `dom`, `validators` para base comum entre os dois repos.
- [ ] Testes cobrindo gateway e validadores.

### Fase 6 — Auditoria e rollout
- [ ] Revisão de segurança da branch (`/security-review`).
- [ ] Publicar regras Firestore revisadas; CSP em *enforce*; atualizar `CHECKLIST_PUBLICACAO.md`.

---

## 4. Ordem sugerida de execução

```
Fase 0 → Fase 1 → Fase 2 → Fase 3 → Fase 4 → Fase 5 → Fase 6
```

As Fases 0–2 entregam o maior ganho de segurança com o menor risco e devem vir
primeiro. As Fases 3–4 reduzem a superfície de XSS e entrada inválida. As Fases
5–6 consolidam e auditam.

## 5. Critérios de aceite

- Nenhuma tela faz `fetch`/acesso Firestore fora do `data-gateway`.
- Nenhum endpoint de escrita responde sem token válido.
- CSP em *enforce* sem violações; scripts externos com SRI.
- Dados do backend nunca renderizados via `innerHTML` cru.
- Testes verdes cobrindo gateway e validadores.
