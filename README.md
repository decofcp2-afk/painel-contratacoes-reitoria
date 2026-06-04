# Painel de Contratacoes da Reitoria

Painel publico de consulta do cronograma de contratacoes da Reitoria do Colegio Pedro II. Esta versao foi preparada para GitHub Pages e usa um Google Apps Script proprio como backend somente de leitura da planilha.

Site publicado:

```text
https://decofcp2-afk.github.io/painel-contratacoes-reitoria/
```

## O que este painel mostra

O painel transforma os dados operacionais da planilha em uma visao publica para acompanhamento:

- Gantt e cronograma dos processos.
- KPIs de quantidade, andamento, atrasos e conclusao.
- Capacidade da equipe por servidor e por fase.
- Filtros por modalidade, setor, situacao e periodo.
- Links publicos cadastrados, quando existirem.

Ele nao altera a planilha. A unica funcao dele e ler os dados consolidados e apresentar a informacao de forma mais rapida e estavel fora do Apps Script.

## Como ele se conecta ao App Gestao

```text
Google Sheets da unidade
  |
  | recebe atualizacoes do App Gestao
  | - novos processos
  | - etapas
  | - D0
  | - status
  | - responsaveis
  | - capacidade
  v
App Gestao / AppSEL
  |
  | escreve e organiza os dados internos
  v
Mesma planilha Google Sheets
  |
  | leitura publica somente leitura
  v
Apps Script do Painel
  |
  | JSONP publico
  v
Painel de Contratacoes no GitHub Pages
```

Na pratica:

- O App Gestao e o sistema interno da equipe. Ele tem login e pode escrever na planilha.
- O Painel e o site publico. Ele so consulta a planilha e nao tem funcoes de escrita.
- Os dois sistemas podem usar a mesma planilha, mas devem ter repositorios e Apps Scripts separados.
- A separacao evita misturar permissoes: o painel fica publico e somente leitura; o app fica protegido por login e token.

## Estrutura do projeto

```text
.
|-- index.html              pagina estatica publicada no GitHub Pages
|-- config.js               URL publica do Apps Script do painel
|-- README.md               documentacao do projeto
|-- .gitignore              bloqueia arquivos sensiveis
|-- LICENSE
`-- apps-script/
    `-- Code.gs             backend somente leitura para copiar no Apps Script
```

## Configuracao

O arquivo `config.js` guarda apenas a URL publica da implantacao do Apps Script:

```js
window.PAINEL_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/SEU_DEPLOY/exec"
};
```

Nao coloque ID real de planilha, e-mail pessoal, PDF assinado, planilha exportada ou documento administrativo neste repositorio.

## Rotas do backend

O painel usa apenas rotas publicas de leitura:

- `?route=painel.dados`
- `?route=painel.capacidade`

Para funcionar no GitHub Pages, o painel chama o Apps Script por JSONP:

```text
?route=painel.dados&callback=nomeDaFuncao
```

## Como publicar no GitHub Pages

1. Use um repositorio separado para o painel, por exemplo `painel-contratacoes-reitoria`.
2. Mantenha `index.html`, `config.js`, `README.md` e `apps-script/` na raiz do repositorio.
3. No Apps Script da conta institucional, cole o conteudo de `apps-script/Code.gs`.
4. Configure no Apps Script o ID real da planilha, preferencialmente em propriedades do script.
   - `PAINEL_MUNICIPIO_CALENDARIO`: municipio usado nos feriados locais, por exemplo `Rio de Janeiro`.
5. Implante o Apps Script como Web App.
6. Copie a URL final terminada em `/exec`.
7. Cole essa URL em `config.js`, no campo `apiUrl`.
8. No GitHub, va em `Settings > Pages`.
9. Use `Deploy from a branch`, branch `main` e pasta `/(root)`.
10. Aguarde o GitHub gerar o link publico.

O campo `Custom domain` deve ficar vazio enquanto nao houver um dominio institucional real com DNS configurado pela TI. Trocar o nome do repositorio ja muda o caminho do GitHub Pages, sem precisar cadastrar dominio proprio.

## Calendario de feriados oficiais

O painel calcula prazos, atrasos, Gantt e capacidade usando dias uteis. A regra atual considera:

- sabados e domingos;
- feriados nacionais fixos;
- feriados oficiais cadastrados na aba `Calendario`.

A aba `Calendario` deve ter:

```text
Data | Nome | Tipo | Municipio | AfetaPrazo | Fonte | Observacao
```

Use `Tipo` contendo `Feriado` e `AfetaPrazo = Sim`. Pontos facultativos nao entram nesta versao, mesmo que sejam cadastrados por engano como `Ponto facultativo`.

Use `Municipio = TODOS` para feriados nacionais e estaduais do RJ. Use o municipio especifico para feriados locais da unidade, como `Rio de Janeiro`, `Niteroi` ou `Duque de Caxias`.

Fontes recomendadas:

- Feriados nacionais: Gov.br / MGI.
- Feriados estaduais do RJ: ALERJ / Lei RJ 5.645/2010.
- Feriados municipais: prefeitura ou diario oficial do municipio.

Se a aba `Calendario` ainda nao existir, o painel continua funcionando com o fallback de feriados nacionais fixos.

## Como adaptar para outro campus

Para outro campus usar o mesmo modelo, o caminho recomendado nesta fase e manter uma instalacao isolada por unidade:

1. Copiar a planilha modelo e revisar as abas obrigatorias.
2. Criar um Apps Script proprio para o App Gestao do campus.
3. Criar um Apps Script proprio para o Painel do campus.
4. Configurar cada script com o ID da planilha daquele campus.
5. Criar dois repositorios separados:
   - um para o App Gestao;
   - outro para o Painel.
6. Publicar os dois no GitHub Pages, cada um com seu `config.js`.
7. Ajustar nomes de setor, equipe, modalidades, calendario, municipio e responsaveis na planilha/configuracao.
8. Testar primeiro com dados ficticios antes de usar processos reais.

Evite unir o backend do painel com o backend do app quando houver muitas funcoes. Separar deixa mais facil auditar permissoes, atualizar com calma e reduzir risco de quebrar o sistema interno.

## Ideia futura: modelo multicampus / multitenant

Depois de validar a Reitoria por 1 ou 2 meses, o projeto pode evoluir para um modelo multicampus. A ideia nao e misturar os dados dos campi em uma unica planilha, e sim permitir que uma mesma base visual do Painel seja reaproveitada por varias unidades com configuracoes diferentes.

### Modelo atual recomendado

```text
Campus A
  |-- Planilha A
  |-- Apps Script do App Gestao A
  |-- Apps Script do Painel A
  |-- GitHub Pages do App A
  `-- GitHub Pages do Painel A

Campus B
  |-- Planilha B
  |-- Apps Script do App Gestao B
  |-- Apps Script do Painel B
  |-- GitHub Pages do App B
  `-- GitHub Pages do Painel B
```

Esse modelo e mais seguro para a fase de piloto porque cada campus fica isolado. Se uma unidade precisar alterar equipe, municipio, calendario ou regras internas, isso nao interfere nas demais.

### Evolucao possivel do Painel

Uma evolucao natural seria criar um Painel multicampus com um arquivo de configuracao de unidades, por exemplo `campi.js` ou `tenants.js`:

```js
window.PAINEL_TENANTS = {
  reitoria: {
    nome: "Reitoria",
    campus: "Reitoria",
    apiUrl: "https://script.google.com/macros/s/DEPLOY_REITORIA/exec"
  },
  humaita: {
    nome: "Humaita",
    campus: "Humaita",
    apiUrl: "https://script.google.com/macros/s/DEPLOY_HUMAITA/exec"
  }
};
```

Com isso, o mesmo `index.html` poderia abrir um campus especifico por parametro:

```text
https://.../painel-contratacoes-cpii/?campus=reitoria
https://.../painel-contratacoes-cpii/?campus=humaita
```

O frontend escolheria a `apiUrl` conforme o campus selecionado. Cada `apiUrl` continuaria apontando para um Apps Script separado e somente leitura, conectado a planilha daquele campus.

### Opcoes de expansao

1. **Conservadora:** manter um repositorio/site por campus. E o melhor caminho para o piloto e para os primeiros testes com outras unidades.
2. **Portal multicampus:** criar uma pagina inicial com links para os paineis de cada campus, sem alterar a arquitetura atual.
3. **Painel multitenant:** usar um unico frontend do Painel com seletor de campus e um arquivo `tenants.js` apontando para os Apps Scripts publicos de cada unidade.
4. **App Gestao multitenant:** deixar como possibilidade futura, mas nao recomendada agora. O App Gestao tem login, escrita, tokens, equipe, e-mails e acionadores; por isso exige muito mais cuidado do que o Painel publico.

### Cuidados antes de virar multitenant

- Padronizar as abas obrigatorias da planilha em todos os campi.
- Garantir que `Processos`, `Etapas`, `Capacidade` e `Calendario` tenham os mesmos cabecalhos.
- Definir um calendario por municipio/unidade.
- Manter o Painel sempre somente leitura.
- Evitar colocar ID real de planilha no repositorio publico.
- Versionar com cuidado alteracoes no Apps Script de cada campus.
- Ter um checklist minimo de homologacao antes de incluir uma nova unidade.

### Principio de seguranca

Mesmo em um modelo multicampus, a separacao de responsabilidades deve continuar:

```text
App Gestao do campus
  escreve na planilha do campus

Apps Script do Painel do campus
  le a planilha do campus

Painel publico
  exibe dados consolidados, sem escrita
```

Assim, o Painel pode crescer para varios campi sem transformar o site publico em uma porta de escrita ou administracao interna.

## Checklist de validacao

- Abrir o painel publicado em Chrome.
- Abrir o painel publicado em Edge.
- Testar em aba anonima.
- Confirmar que Gantt, KPIs, filtros e capacidade carregam.
- Confirmar que o painel nao pede login Google.
- Confirmar que o repositorio nao contem ID real de planilha.
- Confirmar que o repositorio nao contem e-mail pessoal.
- Confirmar que nao ha PDFs, planilhas reais ou documentos administrativos na pasta.

## Solucao de problemas

- Se o painel nao carregar dados, confira se `config.js` tem a URL `/exec` correta.
- Se funcionar no Chrome e falhar no Edge, teste em aba anonima e confirme se o Apps Script foi implantado como Web App acessivel por `Qualquer pessoa`.
- Se aparecer erro de CORS, confirme se o painel esta usando JSONP e nao `fetch` comum.
- Se o GitHub Pages nao atualizar, aguarde alguns minutos e confira a aba `Actions` do repositorio.
- Se mudar o nome do repositorio, atualize tambem links do README e qualquer atalho salvo no navegador.
