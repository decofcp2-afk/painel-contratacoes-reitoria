"""Complementa a base ARP com a API direta do PNCP (sem índice de busca)."""
import datetime as dt
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://pncp.gov.br/api/consulta/v1/"
CNPJ = "42414284000102"


def request_json(url):
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as response:
                return None if response.status == 204 else json.load(response)
        except (urllib.error.URLError, OSError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def purchase_path(identifier):
    match = re.fullmatch(r"(\d{14})-1-(\d+)/(\d{4})", str(identifier or ""))
    if not match:
        raise ValueError("Identificador de compra PNCP inválido")
    cnpj, sequence, year = match.groups()
    return f"orgaos/{cnpj}/compras/{year}/{int(sequence)}"


def supplement(payload, fetch=request_json, now=None, uasg=153167):
    now = now or dt.datetime.now(dt.timezone.utc)
    records = {row["numeroControlePncpAta"]: dict(row) for row in payload["items"]
               if row.get("numeroControlePncpAta")}
    # Não confundir o sequencial PNCP com o número do pregão/compra.
    purchases = {}
    for row in payload["items"]:
        identifier = str(row.get("numeroControlePncpAta") or "").rsplit("-", 1)[0]
        if row.get("numeroCompra"):
            purchases[identifier] = row
    page = 1
    while True:
        query = urllib.parse.urlencode({"cnpj": CNPJ, "codigoUnidadeAdministrativa": uasg,
            "dataInicial": f"{now.year}0101", "dataFinal": f"{now.year}1231",
            "pagina": page, "tamanhoPagina": 500})
        data = fetch(BASE + "atas?" + query)
        if data is None:  # HTTP 204 é uma consulta válida sem registros.
            break
        rows, pages = data.get("data"), data.get("totalPaginas")
        if not isinstance(rows, list) or type(pages) is not int or not 0 <= pages <= 200:
            raise ValueError("Resposta ou paginação inesperada do PNCP")
        for row in rows:
            if str(row.get("codigoUnidadeOrgao")) != str(uasg) or row.get("cnpjOrgao") != CNPJ:
                raise ValueError("Ata PNCP de outra UASG ou órgão")
            identifier = row.get("numeroControlePNCPAta")
            purchase_id = row.get("numeroControlePNCPCompra")
            path = purchase_path(purchase_id)
            if not isinstance(identifier, str) or not identifier.startswith(purchase_id + "-"):
                raise ValueError("Ata PNCP sem identidade válida")
            if purchase_id not in purchases:
                purchase = fetch(BASE + path)
                if (not isinstance(purchase, dict) or purchase.get("numeroControlePNCP") != purchase_id
                        or str(purchase.get("unidadeOrgao", {}).get("codigoUnidade")) != str(uasg)
                        or not purchase.get("numeroCompra")):
                    raise ValueError("Compra PNCP não corresponde à ata")
                purchases[purchase_id] = purchase
            purchase = purchases[purchase_id]
            number = str(row.get("numeroAtaRegistroPreco") or "")
            if "/" not in number:
                number += "/" + str(row["anoAta"])
            record = records.get(identifier, {})
            record.update({
                "numeroAtaRegistroPreco": number, "codigoUnidadeGerenciadora": str(uasg),
                "nomeUnidadeGerenciadora": row.get("nomeUnidadeOrgao"),
                "nomeOrgao": row.get("nomeOrgao"), "codigoOrgao": 26201,
                "objeto": row.get("objetoContratacao"), "dataAssinatura": row.get("dataAssinatura"),
                "dataVigenciaInicial": row.get("vigenciaInicio"), "dataVigenciaFinal": row.get("vigenciaFim"),
                "ataExcluido": row.get("cancelado") is True,
                "statusAta": "Cancelada" if row.get("cancelado") is True else "Ata de Registro de Preços",
                "numeroControlePncpAta": identifier, "possibilidadeAdesao": row.get("possibilidadeAdesao"),
                "numeroCompra": str(purchase["numeroCompra"]), "anoCompra": str(purchase["anoCompra"]),
                "numeroProcesso": purchase.get("processo") or purchase.get("numeroProcesso"),
                "linkCompraPNCP": "https://pncp.gov.br/app/editais/" + path.replace("orgaos/", "").replace("/compras", ""),
                "linkAtaPNCP": "https://pncp.gov.br/app/atas/" + path.replace("orgaos/", "").replace("/compras", "") + "/" + str(int(identifier.rsplit("-", 1)[1])),
                "fonteOficial": "pncp", "dataAtualizacaoPncp": row.get("dataAtualizacaoGlobal"),
            })
            records[identifier] = record
        if page >= pages:
            break
        if not rows:
            raise ValueError("Página PNCP vazia antes do fim da consulta")
        page += 1
    # Mantém também registros legados sem identificador PNCP.
    legacy = [row for row in payload["items"] if not row.get("numeroControlePncpAta")]
    return {**payload, "sources": [payload["source"], BASE + "atas"],
            "generatedAt": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
            "items": sorted([*records.values(), *legacy], key=lambda r: (str(r.get("objeto") or "").casefold(), str(r.get("numeroAtaRegistroPreco") or "")))}
