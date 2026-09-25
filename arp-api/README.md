# Consulta pública de itens e saldos de ARP

O painel estático usa este Apps Script somente como ponte de leitura para os
endpoints públicos `2_consultarARPItem`, `3_consultarUnidadesItem` e
`5_consultarAdesoesItem` do módulo
ARP do Compras.gov.br. O navegador chama o serviço com JSONP porque a API de
Dados Abertos não envia cabeçalho CORS para o domínio do painel.

O serviço aceita a busca de atas pelo **CNPJ** do fornecedor, pela **UASG**
gerenciadora ou por ambos, com o ano de início da vigência. O painel agrupa os
itens por ata e consulta os saldos dos primeiros cinco itens ao abrir a ata;
"Ver mais itens" carrega os demais em grupos de cinco. O saldo é consultado
para cada ata, UASG e item. A resposta
da API pode repetir o mesmo saldo para diferentes unidades; a interface não
soma esses registros. O resultado é informativo e deve ser conferido na origem
antes de solicitar adesão.
O total de adesões aprovadas vem do endpoint 5. O saldo individual da unidade
solicitante, exibido na simulação autenticada do Contratos.gov.br, não é
calculado pelo painel.

## Publicação

1. Execute `clasp push --force` na raiz do repositório.
2. Atualize o deployment existente com
   `clasp deploy -i AKfycbxzeV93Auc2PfEW5FNk6I71kuSpklKLR0jEJY496rDq53YItCYZQdeQX4BpVje25AaAYg`.
3. Na conta proprietária `decof.cp2@gmail.com`, abra o projeto Apps Script,
   execute `autorizarConsulta` uma vez e conceda o escopo de consulta externa.
4. Verifique a URL `/exec` de `config.js` sem login, com uma busca de itens
   conhecida, antes de publicar alterações no painel.

O serviço não recebe credenciais do Compras.gov.br e não consulta dados
privados da conta do usuário. O script ID em `.clasp.json` identifica o projeto,
mas não concede acesso à conta.
