import datetime as dt
import unittest
from scripts.update_atas_pncp import supplement


class DirectPncpTests(unittest.TestCase):
    def test_recent_pagination_purchase_identity_and_cancellation(self):
        purchase_id = '42414284000102-1-000168/2026'
        row = {'cnpjOrgao': '42414284000102', 'codigoUnidadeOrgao': '153167',
               'numeroControlePNCPAta': purchase_id + '-000001', 'numeroControlePNCPCompra': purchase_id,
               'numeroAtaRegistroPreco': '01312', 'anoAta': 2026, 'objetoContratacao': 'Vigilância',
               'vigenciaInicio': '2026-10-08', 'vigenciaFim': '2027-10-08'}
        calls = []
        def fetch(url):
            calls.append(url)
            if '/atas?' in url:
                return {'data': [dict(row, cancelado='pagina=2' in url)], 'totalPaginas': 2}
            self.assertTrue(url.endswith('/compras/2026/168'))
            return {'numeroControlePNCP': purchase_id, 'numeroCompra': '312', 'anoCompra': 2026,
                    'unidadeOrgao': {'codigoUnidade': '153167'}}
        result = supplement({'source': 'ARP', 'items': []}, fetch, dt.datetime(2026, 10, 8, tzinfo=dt.timezone.utc))
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['items'][0]['numeroCompra'], '312')
        self.assertEqual(result['items'][0]['numeroAtaRegistroPreco'], '01312/2026')
        self.assertTrue(result['items'][0]['ataExcluido'])
        self.assertEqual(len(calls), 3)

    def test_204_preserves_legacy_and_invalid_pagination_is_rejected(self):
        payload = {'source': 'ARP', 'items': [{'numeroAtaRegistroPreco': 'legada'}]}
        self.assertEqual(supplement(payload, lambda _: None)['items'], payload['items'])
        with self.assertRaises(ValueError):
            supplement(payload, lambda _: {'data': [], 'totalPaginas': 300})
