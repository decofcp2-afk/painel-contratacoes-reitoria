#!/usr/bin/env python3
"""Publica as atas gerenciadas pelas UASGs ativas do Colégio Pedro II."""
import datetime as dt
import json
import os
from pathlib import Path

from update_atas import ENDPOINT, collect

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "uasg-catalog.json"
OUTPUT = ROOT / "atas-cpii-data.json"


def cpii_units(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise ValueError("Catálogo de UASGs indisponível")
    codes = {"153167"}
    for unit in payload["items"]:
        if not isinstance(unit, dict):
            continue
        if str(unit.get("orgao")) == "26201" or str(unit.get("cnpjOrgao")) == "42414284000102":
            code = str(unit.get("codigo") or "")
            if code.isdigit() and len(code) == 6:
                codes.add(code)
    if len(codes) < 2:
        raise ValueError("O catálogo não retornou outras UASGs do CPII")
    return sorted(codes)


def build(catalog, gather=collect, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    items = []
    codes = cpii_units(catalog)
    for code in codes:
        # A Reitoria mantém seu arquivo diário próprio, usado como padrão na página.
        if code != "153167":
            try:
                items.extend(gather(now=now, uasg=int(code))["items"])
            except ValueError as error:
                if "não retornou atas" not in str(error):
                    raise
    return {
        "source": ENDPOINT,
        "scope": "Atas gerenciadas pelas UASGs do Colégio Pedro II, exceto Reitoria",
        "generatedAt": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "units": codes,
        "items": items,
    }


def main():
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    payload = build(catalog)
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(temporary, OUTPUT)
    print(f"Atualizadas {len(payload['items'])} atas de {len(payload['units']) - 1} UASGs do CPII")


if __name__ == "__main__":
    main()
