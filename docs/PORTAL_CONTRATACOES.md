# Portal de contratações — especificação e entrega

Plano aprovado pelo usuário em 09/10/2026. A página inicial centraliza serviços do CPII. O Painel continua disponível em `painel.html`; a consulta de atas mantém `atas.html`. Links com `?u=` mantêm a unidade na navegação. Links internos do App Gestão passam a apontar diretamente para o Painel.

## Experiência e direção visual

Página inicial com o brasão institucional já utilizado no sistema, azul-marinho `#0b1f3d`, azul `#1e4e8c`, dourado `#c9a22a` e fundo claro `#f4f6fa`. Tipografia do sistema, coluna central de links, descrições curtas e foco visível. Botões sem setas decorativas; Manuais e Fluxos usa um indicador discreto de expansão. Não há imagens geradas ou novas marcas.

Destinos: Painel, Atas, Contratos no SUAP, Notas Técnicas e Portarias, Manuais e Fluxos. O acesso administrativo é discreto no rodapé. No Painel, os atalhos superiores foram substituídos por “Página inicial”, mantendo o seletor de unidade e os controles da consulta.

## Biblioteca e pedidos

`documentos.html` pesquisa por título, número e assunto, com filtro de categoria. `documentos.json` preserva os links das portarias que já estavam no menu. A lista é complementada por documentos explicitamente publicados pelo administrador no App Gestão. Ausência de notas técnicas tem mensagem própria; a interface não inventa documentos.

`solicitar.html` incorpora o formulário público do Apps Script. Até cinco arquivos PDF/JPG/PNG, até 5 MB cada e 10 MB no total. O administrador recebe avisos em `decof@cp2.g12.br`. Anexos privados ficam temporariamente no Drive e são excluídos ao atender; protocolo, resposta e histórico permanecem. Sem Firebase Storage. A ativação depende da autorização do Drive na conta proprietária e da configuração pelo administrador.

## Consulta de atas

Orientação permanente acima dos filtros: fontes da consulta, verificação de condições e disponibilidade na origem, alcance do indicador de adesão e encaminhamento de atas de interesse à Pró-Reitoria responsável ou à Direção da unidade.

## Etapas de implementação e conferência

- [x] Página inicial, brasão, navegação e manuais expansíveis.
- [x] Painel preservado em endereço próprio e cabeçalho simplificado.
- [x] Orientação permanente na consulta de atas.
- [x] Biblioteca pública, pesquisa e formulário incorporado.
- [x] Backend e tela administrativa no repositório App Gestão.
- [x] Análise de banco separada da implantação.
- [x] Autorização do Drive, ativação e conferência operacional na conta institucional.

Validar testes de ambos os repositórios, console e navegação no navegador, largura móvel e implantação do GitHub Pages. O backend é publicado pelo workflow do App Gestão, preservando a URL existente.

Validação concluída: 220 testes do App Gestão, 62 testes JavaScript do Painel e 11 testes Python. Publicações confirmadas no GitHub Pages e no Apps Script (versão 114). Formulário ativo, biblioteca carregada e navegação conferida em largura móvel. E-mail configurado para `decof@cp2.g12.br`; não foi enviado um pedido fictício de teste.
