# Consulta pública de itens e saldos de ARP

O painel estático usa este Apps Script somente como ponte de leitura para os
endpoints públicos `2_consultarARPItem` e `3_consultarUnidadesItem` do módulo
ARP do Compras.gov.br. O navegador chama o serviço com JSONP porque a API de
Dados Abertos não envia cabeçalho CORS para o domínio do painel.

O serviço aceita a busca de atas pelo **CNPJ** do fornecedor e pelo ano de
início da vigência. O saldo é consultado para cada ata, UASG e item. A resposta
da API pode repetir o mesmo saldo para diferentes unidades; a interface não
soma esses registros. O resultado é informativo e deve ser conferido na origem
antes de solicitar adesão.

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
