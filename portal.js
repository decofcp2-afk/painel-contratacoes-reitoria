'use strict';
// Mantém a unidade selecionada ao transitar entre as páginas públicas.
document.querySelectorAll('a[data-unidade]').forEach(function(a){var atual=new URL(location.href),u=atual.searchParams.get('u');if(u&&/^[a-z0-9-]+$/.test(u)){var dest=new URL(a.href);dest.searchParams.set('u',u);a.href=dest.href;}});
