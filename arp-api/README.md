# Ponte de consulta de itens e saldos de ARP (legada)

O painel estático usa este Apps Script somente como ponte de leitura para os
endpoints públicos `2_consultarARPItem`, `3_consultarUnidadesItem` e
`5_consultarAdesoesItem` do módulo
ARP do Compras.gov.br. O navegador chama o serviço com JSONP porque a API de
Dados Abertos não envia cabeçalho CORS para o domínio do painel.

O painel não chama mais esta ponte nem exibe saldos. Cada ata oferece um link
para consultar a adesão no Contratos.gov.br. A tag "Permite adesão" usa o
indicador `permite_adesao` publicado pelo PNCP, atualizado diariamente em
`atas-adesao-pncp.json` para as atas do Colégio Pedro II. Ausência do indicador
aparece como "Adesão não informada". A permissão da ata não informa saldo nem
garante autorização da unidade gerenciadora.

A ponte permanece no repositório apenas para compatibilidade técnica com o
projeto Apps Script já publicado; seus resultados não aparecem na interface.

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
