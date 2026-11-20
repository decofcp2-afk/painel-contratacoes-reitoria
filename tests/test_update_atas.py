import datetime as dt
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.error import HTTPError

from scripts import update_atas
from scripts.update_atas import collect


class UpdateAtasTests(unittest.TestCase):
    def test_only_scheduled_429_can_keep_a_recent_valid_publication(self):
        now = dt.datetime.now(dt.timezone.utc)
        with TemporaryDirectory() as directory:
            output = Path(directory) / 'atas-data.json'
            valid = {
                'source': update_atas.ENDPOINT,
                'sources': [update_atas.ENDPOINT, update_atas.PNCP_BASE + 'atas'],
                'generatedAt': now.isoformat(),
                'items': [{'codigoUnidadeGerenciadora': update_atas.UASG}],
            }
            original = json.dumps(valid).encode()
            output.write_bytes(original)
            with (patch.object(update_atas, 'OUTPUT', output),
                  patch.object(update_atas, 'collect_combined', side_effect=update_atas.PncpRateLimitError) as gather,
                  patch.dict('os.environ', {'ALLOW_RECENT_ATAS_ON_PNCP_429': 'false'})):
                with self.assertRaises(update_atas.PncpRateLimitError):
                    update_atas.main()
                with patch.dict('os.environ', {'ALLOW_RECENT_ATAS_ON_PNCP_429': 'true'}):
                    stdout = StringIO()
                    with redirect_stdout(stdout):
                        update_atas.main()
                    self.assertIn('::warning::PNCP retornou HTTP 429', stdout.getvalue())
                    self.assertEqual(output.read_bytes(), original)

                    for invalid in (
                        dict(valid, generatedAt=(now - dt.timedelta(hours=49)).isoformat()),
                        dict(valid, items=[]),
                        dict(valid, items=[{'codigoUnidadeGerenciadora': 999}]),
                    ):
                        with self.subTest(publication=invalid):
                            output.write_text(json.dumps(invalid), encoding='utf-8')
                            with self.assertRaises(update_atas.PncpRateLimitError):
                                update_atas.main()

                    output.write_bytes(original)
                    with HTTPError(update_atas.ENDPOINT, 429, 'Too Many Requests', {}, None) as error:
                        gather.side_effect = error
                        with self.assertRaises(HTTPError):
                            update_atas.main()
                    self.assertEqual(output.read_bytes(), original)

    def test_paginated_fetch_deduplicates_and_rejects_other_uasg(self):
        calls = []

        def fetch(params):
            calls.append(params)
            if params['dataVigenciaInicialMin'] == '2021-01-01':
                return {'resultado': [{'codigoUnidadeGerenciadora': 153167,
                                       'numeroControlePncpAta': 'A', 'objeto': 'Livros'}],
                        'totalPaginas': 2} if params['pagina'] == 1 else {
                    'resultado': [{'codigoUnidadeGerenciadora': 153167,
                                   'numeroControlePncpAta': 'A', 'objeto': 'Livros atualizados'}],
                    'totalPaginas': 2}
            return {'resultado': [], 'totalPaginas': 0}

        result = collect(fetch, dt.datetime(2022, 1, 2, tzinfo=dt.timezone.utc))
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['items'][0]['objeto'], 'Livros atualizados')
        self.assertEqual(calls[0]['codigoUnidadeGerenciadora'], 153167)

        with self.assertRaises(ValueError):
            collect(lambda _: {'resultado': [{'codigoUnidadeGerenciadora': 999}], 'totalPaginas': 1},
                    dt.datetime(2021, 1, 2, tzinfo=dt.timezone.utc))


if __name__ == '__main__':
    unittest.main()
