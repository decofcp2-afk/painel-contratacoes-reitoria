"""Diagnóstico pontual da disponibilidade dos dados públicos de adesão."""
import json
import urllib.parse
import urllib.request

base = "https://dadosabertos.compras.gov.br/modulo-arp/"
checks = [
    ("itens", "2_consultarARPItem", dict(
        codigoUnidadeGerenciadora="153167", numeroCompra="00199",
        dataVigenciaInicialMin="2025-11-13", dataVigenciaInicialMax="2025-11-13",
        pagina="1", tamanhoPagina="10")),
    ("saldos", "3_consultarUnidadesItem", dict(
        numeroAta="19901/2025", unidadeGerenciadora="153167",
        numeroItem="1", pagina="1", tamanhoPagina="10"))
]
for name, endpoint, args in checks:
    url = base + endpoint + "?" + urllib.parse.urlencode(args)
    try:
        req = urllib.request.Request(url, headers={"Accept":"application/json",
            "User-Agent":"PainelContratacoesCPII/1.0 (consulta publica)"})
        with urllib.request.urlopen(req, timeout=25) as response:
            payload = json.load(response)
            records = payload.get("resultado", [])
            print(name, "HTTP", response.status, "total", payload.get("totalRegistros"),
                "pages", payload.get("totalPaginas"), "rows", len(records))
            if records:
                first = records[0]
                print(name, "fields", sorted(first.keys()))
                print(name, "sample", {key:first.get(key) for key in (
                    "numeroAta", "numeroAtaRegistroPreco", "unidadeGerenciadora",
                    "numeroItem", "saldoAdesao", "qtdLimiteAdesao")})
    except Exception as exc:
        print(name, type(exc).__name__, str(exc)[:250])
