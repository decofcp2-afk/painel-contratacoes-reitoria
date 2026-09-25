"""Diagnóstico pontual dos dados públicos de adesão por variação do identificador."""
import concurrent.futures
import json
import time
import urllib.parse
import urllib.request

BASE = "https://dadosabertos.compras.gov.br/modulo-arp/3_consultarUnidadesItem?"
CASES = [
    ("ano-e-1", {"numeroAta":"19901/2025","unidadeGerenciadora":"153167","numeroItem":"1"}),
    ("ano-e-00004", {"numeroAta":"19901/2025","unidadeGerenciadora":"153167","numeroItem":"00004"}),
    ("numero-e-4", {"numeroAta":"19901","unidadeGerenciadora":"153167","numeroItem":"4"}),
    ("numero-e-00004", {"numeroAta":"19901","unidadeGerenciadora":"153167","numeroItem":"00004"}),
]

def probe(name, args):
    url = BASE + urllib.parse.urlencode(args)
    start = time.monotonic()
    try:
        request = urllib.request.Request(url, headers={"Accept":"application/json", "User-Agent":"PainelContratacoesCPII/1.0"})
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.load(response)
            rows = data.get("resultado", [])
            sample = [{key:row.get(key) for key in ("numeroAta","unidadeGerenciadora","numeroItem","saldoAdesao","qtdLimiteAdesao")} for row in rows[:2]]
            return name, round(time.monotonic()-start,1), response.status, data.get("totalRegistros"), sample
    except Exception as exc:
        return name, round(time.monotonic()-start,1), type(exc).__name__, str(exc)[:150]

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for result in pool.map(lambda item: probe(*item), CASES):
        print(result, flush=True)
