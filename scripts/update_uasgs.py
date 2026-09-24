#!/usr/bin/env python3
"""Gera um catálogo compacto e pesquisável de UASGs ativas do Compras.gov.br."""
import datetime as dt
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

ENDPOINT = "https://dadosabertos.compras.gov.br/modulo-uasg/1_consultarUasg"
OUTPUT = Path(__file__).resolve().parents[1] / "uasg-catalog.json"
MAX_PAGES = 2000


def fetch_page(page, endpoint=ENDPOINT):
    query = urllib.parse.urlencode({"pagina": page, "tamanhoPagina": 500, "statusUasg": "true"})
    request = urllib.request.Request(
        endpoint + "?" + query,
        headers={"Accept": "application/json", "User-Agent": "PainelContratacoesCPII/1.0 (catalogo publico)"},
    )
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.load(response)


def collect(fetch=fetch_page, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    units = {}
    page = 1
    while True:
        data = fetch(page)
        pages = data.get("totalPaginas") if isinstance(data, dict) else None
        results = data.get("resultado") if isinstance(data, dict) else None
        if not isinstance(pages, int) or not 1 <= pages <= MAX_PAGES or not isinstance(results, list):
            raise ValueError("Paginação ou resposta inesperada da API de UASGs")
        if page > pages:
            raise ValueError("Número de páginas mudou durante a consulta")
        for item in results:
            if not isinstance(item, dict):
                raise ValueError("UASG inválida na API")
            code = str(item.get("codigoUasg") or "").strip()
            name = str(item.get("nomeUasg") or "").strip()
            if not code.isdigit() or not name:
                continue
            units[code] = {
                "codigo": code,
                "nome": name,
                "orgao": str(item.get("codigoOrgao") or ""),
                "nomeOrgao": str(item.get("nomeOrgao") or "").strip(),
                "cnpjOrgao": str(item.get("cnpjCpfOrgao") or ""),
            }
        if page == pages:
            break
        page += 1
    if not units:
        raise ValueError("Catálogo vazio; arquivo anterior preservado")
    return {
        "source": ENDPOINT,
        "generatedAt": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "items": sorted(units.values(), key=lambda item: (item["nome"].casefold(), item["codigo"])),
    }


def main():
    payload = collect()
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(temporary, OUTPUT)
    print(f"Catálogo atualizado: {len(payload['items'])} UASGs")


if __name__ == "__main__":
    main()
