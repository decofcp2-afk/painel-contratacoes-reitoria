# Firestore, Locaweb e KingHost

Análise em 09/10/2026. Não foi feita contratação nem migração.

**Decisão para esta entrega: manter Firestore e Apps Script.** A troca por SQL exige uma nova API e adaptação das leituras diretas dos dois aplicativos. Não há medição atual mostrando que as quotas gratuitas foram esgotadas; a falta de Firebase Storage foi resolvida com anexos temporários no Drive.

## Comparação

| Opção | O que oferece | Efeito no sistema atual |
|---|---|---|
| Firestore gratuito | 1 GiB de dados; 50 mil leituras e 20 mil gravações por dia; 10 GiB/mês de saída | Mantém o código, os listeners e o escopo por unidade. É preciso monitorar uso. [Fonte](https://firebase.google.com/docs/firestore/pricing) |
| Locaweb | Hospedagem com MySQL/PostgreSQL; documentação informa 30 conexões simultâneas por banco na hospedagem compartilhada | Exige API HTTPS, controle de sessões, isolamento por unidade, tarefas agendadas e adaptação do frontend. Confirmar recursos do plano específico. [Fonte](https://www.locaweb.com.br/ajuda/wiki/como-instalar-um-banco-de-dados-hospedagem-de-sites/) |
| KingHost | Hospedagem oferece MariaDB/MySQL e PostgreSQL, com limites de espaço conforme plano | Também exige API própria e adaptação. “Bancos ilimitados” não significa espaço ou processamento ilimitados. [Fonte](https://king.host/hospedagem-de-sites) |

A hospedagem comercial tem custo recorrente; não se equipara ao Spark sem cobrança. Antes de comparar preços, obter o plano já disponível ao CPII, renovação, espaço, CPU, conexões, agendador, retenção de backup e custo de restauração. Um serviço de migração de sites não garante reescrita de Firestore para SQL.

## Trabalho necessário para eventual mudança

1. Medir por trinta dias leituras, gravações, volume e usuários simultâneos. Inventariar unidades, processos, etapas, cargas, servidores, calendários, sessões, atas, alertas e solicitações.
2. Criar modelo SQL com `unidade_id`, chaves e transações. Anexos continuam fora do banco; salvar apenas metadados.
3. Implementar API autenticada: dados públicos separados dos privados, permissões equivalentes às atuais e credenciais apenas no servidor. Navegador nunca conecta diretamente ao SQL.
4. Substituir SDK/listeners do Firestore no App Gestão e no Painel, adaptar gravações do Apps Script ou mover estas rotinas, inclusive avisos e limpeza de anexos.
5. Exportar e reconciliar IDs, contagens e históricos em ambiente de teste. Validar isolamento por unidade, prazos, responsáveis, fase externa, arquivos e relatórios.
6. Ensaiar backup/restauração e um corte com janela curta, cópia consistente e retorno ao Firestore disponível. Retirar a origem somente após validação.

**Inferência técnica:** ambos os provedores podem atender uma API SQL de porte moderado; não há base para escolher um vencedor sem conhecer o plano institucional e medir a carga. Se o CPII já possui hospedagem gerenciada e suporte técnico, uma prova de conceito isolada é o próximo passo. Se a prioridade continua sendo custo zero e pouca administração, manter a arquitetura atual é a opção mais simples agora.
