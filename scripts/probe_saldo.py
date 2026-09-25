"""Diagnóstico pontual: itens reais da ata e saldo publicado em cada um."""
import concurrent.futures
import json
import urllib.parse
import urllib.request

BASE = "https://dadosabertos.compras.gov.br/modulo-arp/"
def fetch(endpoint, args):
    request = urllib.request.Request(BASE + endpoint + "?" + urllib.parse.urlencode(args),
        headers={"Accept":"application/json","User-Agent":"PainelContratacoesCPII/1.0"})
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.load(response)

item_payload = fetch("2_consultarARPItem", dict(codigoUnidadeGerenciadora="153167",
    numeroCompra="00199", dataVigenciaInicialMin="2025-11-13",
    dataVigenciaInicialMax="2025-11-13", pagina="1", tamanhoPagina="10"))
items = sorted(set(row["numeroItem"] for row in item_payload["resultado"]
    if row["numeroAtaRegistroPreco"] == "19901/2025"))
print("items",items,flush=True)

def inspect(item):
    try:
        payload=fetch("3_consultarUnidadesItem",dict(numeroAta="19901/2025",
            unidadeGerenciadora="153167",numeroItem=item,pagina="1",tamanhoPagina="50"))
        return (item,payload.get("totalRegistros"),[
            {k:row.get(k) for k in ("unidadeGerenciadora","numeroItem","unidade",
                "quantidadeRegistrada","saldoAdesao","qtdLimiteAdesao","excluida","dataHoraAtualizacao")}
            for row in payload.get("resultado",[])[:5]])
    except Exception as exc:
        return (item,type(exc).__name__,str(exc)[:120])

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for result in pool.map(inspect,items):
        print(result,flush=True)
