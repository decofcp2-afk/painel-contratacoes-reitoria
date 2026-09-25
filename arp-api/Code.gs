/** Ponte pública, somente leitura, para as rotas de ARP do Compras.gov.br. */
var ARP_SOURCE_ = 'https://dadosabertos.compras.gov.br/modulo-arp/';

function doGet(e) {
  var p = e && e.parameter || {};
  var callback = String(p.callback || '');
  if (callback && !/^[A-Za-z_$][\w$]*$/.test(callback)) {
    return arpOutput_({ok:false, erro:'Callback inválido.'}, '');
  }
  try {
    if (p.route !== 'arp.proxy') throw new Error('Rota não encontrada.');
    return arpOutput_(arpProxy_(p), callback);
  } catch (error) {
    return arpOutput_({ok:false, erro:String(error.message || error)}, callback);
  }
}

function arpOutput_(data, callback) {
  var body = JSON.stringify(data);
  return ContentService.createTextOutput(callback ? callback + '(' + body + ');' : body)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

function arpProxy_(p) {
  var endpoint = String(p.endpoint || '');
  var query = {pagina:arpInteger_(p.pagina, 1, 1, 20), tamanhoPagina:arpInteger_(p.tamanhoPagina, 100, 1, 500)};
  if (endpoint === 'itens') {
    var uasg = String(p.codigoUnidadeGerenciadora || '');
    var cnpj = String(p.niFornecedor || '');
    var min = String(p.dataVigenciaInicialMin || '');
    var max = String(p.dataVigenciaInicialMax || '');
    if (uasg && !/^\d{5,6}$/.test(uasg)) throw new Error('UASG inválida.');
    if (cnpj && !/^\d{14}$/.test(cnpj)) throw new Error('Informe o CNPJ com 14 dígitos.');
    if (!uasg && !cnpj) throw new Error('Informe uma UASG ou CNPJ.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(min) || !/^\d{4}-\d{2}-\d{2}$/.test(max) ||
        min > max || min.slice(0, 4) !== max.slice(0, 4)) throw new Error('Informe um intervalo válido no mesmo ano.');
    query.dataVigenciaInicialMin = min;
    query.dataVigenciaInicialMax = max;
    if (uasg) query.codigoUnidadeGerenciadora = uasg;
    if (cnpj) query.niFornecedor = cnpj;
    if (p.numeroCompra) {
      if (!/^\d{1,6}$/.test(String(p.numeroCompra))) throw new Error('Número da compra inválido.');
      query.numeroCompra = String(p.numeroCompra);
    }
    endpoint = '2_consultarARPItem';
  } else if (endpoint === 'saldo' || endpoint === 'adesoes') {
    var ata = String(p.numeroAta || '');
    var gerenciadora = String(p.unidadeGerenciadora || '');
    var item = String(p.numeroItem || '');
    if (!/^\d{1,7}[/-]\d{4}$/.test(ata) || !/^\d{5,6}$/.test(gerenciadora) || !/^\d{1,7}$/.test(item)) {
      throw new Error('Ata, UASG ou item inválido.');
    }
    query.numeroAta = ata;
    query.unidadeGerenciadora = gerenciadora;
    query.numeroItem = item;
    endpoint = endpoint === 'saldo' ? '3_consultarUnidadesItem' : '5_consultarAdesoesItem';
  } else {
    throw new Error('Consulta de ARP não permitida.');
  }
  var parts = [];
  Object.keys(query).forEach(function(key) {
    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(query[key])));
  });
  var url = ARP_SOURCE_ + endpoint + '?' + parts.join('&');
  var response = UrlFetchApp.fetch(url, {muteHttpExceptions:true, followRedirects:true,
    headers:{Accept:'application/json'}});
  if (response.getResponseCode() !== 200) throw new Error('A API oficial não respondeu (HTTP ' + response.getResponseCode() + ').');
  var payload = JSON.parse(response.getContentText());
  if (!payload || !Array.isArray(payload.resultado) || !Number.isInteger(payload.totalPaginas) ||
      payload.totalPaginas < 0 || payload.totalPaginas > 200) throw new Error('Resposta inesperada da API oficial.');
  return {ok:true, resultado:payload.resultado, totalPaginas:payload.totalPaginas,
    totalRegistros:payload.totalRegistros, consultadoEm:new Date().toISOString()};
}

function arpInteger_(value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  var number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error('Parâmetro de paginação inválido.');
  return number;
}

/** Execute uma vez no editor, como proprietario, para conceder o escopo de consulta externa. */
function autorizarConsulta() {
  var response = UrlFetchApp.fetch('https://dadosabertos.compras.gov.br/', {muteHttpExceptions:true});
  Logger.log('Consulta externa autorizada. HTTP ' + response.getResponseCode());
}
