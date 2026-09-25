#!/usr/bin/env python3
"""Guarda o indicador público de adesão das atas do Colégio Pedro II."""
import datetime as dt
import gzip
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "atas-adesao-pncp.json"
BASE = "https://pncp.gov.br/api/search/"
CNPJ = "42414284000102"


def request_json(url):
    request = urllib.request.Request(url, headers={
        "Accept": "application/json", "User-Agent": "Mozilla/5.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                body = response.read()
                return json.loads(gzip.decompress(body) if body.startswith(b"\x1f\x8b") else body)
        except (urllib.error.HTTPError, urllib.error.URLError, OSError):
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def collect(fetch=request_json, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    filters = fetch(BASE + "filters?tipos_documento=ata")
    orgs = filters.get("filters", {}).get("orgaos", [])
    ids = [str(org["id"]) for org in orgs if isinstance(org, dict) and org.get("cnpj") == CNPJ]
    if len(ids) != 1:
        raise ValueError("Órgão do Colégio Pedro II não identificado no PNCP")
    values = {}
    conflicts = set()
    for status in ("vigente", "nao_vigente"):
        page = 1
        while True:
            query = urllib.parse.urlencode({
                "tipos_documento": "ata", "q": "", "status": status,
                "pagina": page, "tam_pagina": 20, "orgaos": ids[0]})
            response = fetch(BASE + "?" + query)
            rows = response.get("items")
            total = response.get("total")
            if not isinstance(rows, list) or not isinstance(total, int) or total < 0 or total > 10000:
                raise ValueError("Paginação inesperada na busca de atas do PNCP")
            for row in rows:
                if not isinstance(row, dict) or row.get("orgao_cnpj") != CNPJ:
                    raise ValueError("Ata de outro órgão na resposta do PNCP")
                identifier = row.get("numero_controle_pncp")
                permission = row.get("permite_adesao")
                if not isinstance(identifier, str) or not isinstance(permission, bool):
                    continue
                if identifier in values and values[identifier] != permission:
                    conflicts.add(identifier)
                else:
                    values[identifier] = permission
            if page * 20 >= total:
                break
            if not rows:
                raise ValueError("Página vazia antes do fim da busca do PNCP")
            page += 1
    for identifier in conflicts:
        values.pop(identifier, None)
    if not values:
        raise ValueError("PNCP não retornou indicadores de adesão; arquivo anterior preservado")
    return {"source": BASE, "generatedAt": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
            "items": dict(sorted(values.items()))}


def main():
    payload = collect()
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(temporary, OUTPUT)
    print(f"Atualizados {len(payload['items'])} indicadores de adesão do PNCP")


if __name__ == "__main__":
    main()
