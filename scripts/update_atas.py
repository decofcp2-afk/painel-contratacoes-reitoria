#!/usr/bin/env python3
"""Atualiza a consulta pública de atas gerenciadas pelo CPII (UASG 153167)."""
import datetime as dt
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ENDPOINT = "https://dadosabertos.compras.gov.br/modulo-arp/1_consultarARP"
UASG = 153167
OUTPUT = Path(__file__).resolve().parents[1] / "atas-data.json"
FIELDS = (
    "numeroAtaRegistroPreco", "codigoUnidadeGerenciadora", "nomeUnidadeGerenciadora",
    "codigoOrgao", "nomeOrgao", "linkAtaPNCP", "linkCompraPNCP", "numeroCompra",
    "anoCompra", "dataAssinatura", "dataVigenciaInicial", "dataVigenciaFinal",
    "statusAta", "objeto", "ataExcluido", "numeroControlePncpAta", "idCompra",
)


def fetch_page(params):
    url = ENDPOINT + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "PainelContratacoesCPII/1.0 (consulta publica)"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                return json.load(response)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def collect(fetch=fetch_page, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    records = {}
    for year in range(2021, now.year + 1):
        params = {
            "codigoUnidadeGerenciadora": UASG,
            "dataVigenciaInicialMin": f"{year}-01-01",
            "dataVigenciaInicialMax": f"{year}-12-31",
            "tamanhoPagina": 500,
        }
        page = 1
        while True:
            response = fetch({**params, "pagina": page})
            if not isinstance(response, dict) or not isinstance(response.get("resultado"), list):
                raise ValueError(f"Resposta inesperada da API no ano {year}, página {page}")
            pages = response.get("totalPaginas")
            if not isinstance(pages, int) or pages < 0 or pages > 200:
                raise ValueError(f"Paginação inesperada no ano {year}: {pages}")
            for item in response["resultado"]:
                if not isinstance(item, dict) or str(item.get("codigoUnidadeGerenciadora")) != str(UASG):
                    raise ValueError(f"Registro com UASG incorreta no ano {year}")
                record = {field: item.get(field) for field in FIELDS}
                key = item.get("numeroControlePncpAta") or (
                    item.get("numeroAtaRegistroPreco"), item.get("numeroCompra"),
                    item.get("anoCompra"), item.get("codigoUnidadeGerenciadora"),
                )
                if not key or key == (None, None, None, UASG):
                    raise ValueError("Ata sem identificador para deduplicação")
                records[str(key)] = record
            if page >= pages:
                break
            page += 1
    if not records:
        raise ValueError("A API não retornou atas; arquivo anterior preservado")
    return {
        "source": ENDPOINT,
        "scope": "Atas gerenciadas pela UASG 153167 — Colégio Pedro II",
        "generatedAt": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "items": sorted(records.values(), key=lambda r: (str(r.get("objeto") or "").casefold(), str(r.get("numeroAtaRegistroPreco") or ""))),
    }


def main():
    payload = collect()
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, OUTPUT)
    print(f"Atualizadas {len(payload['items'])} atas da UASG {UASG}")


if __name__ == "__main__":
    main()
