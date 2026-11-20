import datetime as dt
import unittest
from email.message import Message
from urllib.error import HTTPError
from unittest.mock import MagicMock, call, patch

from scripts.update_atas_pncp import BASE, PncpRateLimitError, request_json, retry_after_seconds, supplement


class DirectPncpTests(unittest.TestCase):
    @patch('scripts.update_atas_pncp.time.sleep')
    @patch('scripts.update_atas_pncp.urllib.request.urlopen')
    def test_429_honors_retry_after_and_recovers(self, urlopen, sleep):
        url = BASE + 'atas'
        headers = Message()
        headers['Retry-After'] = '15'
        response = MagicMock()
        response.__enter__.return_value.status = 204
        urlopen.side_effect = [HTTPError(url, 429, 'Too Many Requests', headers, None), response]

        self.assertIsNone(request_json(url))
        self.assertEqual(sleep.call_args_list, [call(1), call(15)])

    @patch('scripts.update_atas_pncp.time.sleep')
    @patch('scripts.update_atas_pncp.urllib.request.urlopen')
    def test_429_stops_when_wait_exceeds_budget_or_retries_run_out(self, urlopen, sleep):
        url = BASE + 'atas'
        headers = Message()
        headers['Retry-After'] = '90'
        urlopen.side_effect = HTTPError(url, 429, 'Too Many Requests', headers, None)

        with self.assertRaises(PncpRateLimitError):
            request_json(url)
        self.assertEqual(urlopen.call_count, 2)
        self.assertEqual(sleep.call_args_list, [call(1), call(90)])

        del headers['Retry-After']
        urlopen.reset_mock()
        sleep.reset_mock()
        with self.assertRaises(PncpRateLimitError):
            request_json(url)
        self.assertEqual(urlopen.call_count, 4)
        self.assertEqual(sleep.call_args_list, [call(1), call(10), call(20), call(40)])

    def test_retry_after_accepts_http_date_and_ignores_invalid_values(self):
        with patch('scripts.update_atas_pncp.dt.datetime', wraps=dt.datetime) as clock:
            clock.now.return_value = dt.datetime(2026, 11, 20, 14, 0, tzinfo=dt.timezone.utc)
            self.assertEqual(retry_after_seconds('Fri, 20 Nov 2026 14:01:00 GMT'), 60)
            self.assertEqual(retry_after_seconds('Fri, 20 Nov 2026 13:59:00 GMT'), 0)
        self.assertEqual(retry_after_seconds(None), 0)
        self.assertEqual(retry_after_seconds('invalid'), 0)

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
