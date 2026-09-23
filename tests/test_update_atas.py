import datetime as dt
import unittest

from scripts.update_atas import collect


class UpdateAtasTests(unittest.TestCase):
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
