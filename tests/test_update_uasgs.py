import datetime as dt
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("update_uasgs", ROOT / "scripts" / "update_uasgs.py")
uasgs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uasgs)


class CatalogTests(unittest.TestCase):
    def test_paginates_deduplicates_and_keeps_searchable_names(self):
        calls = []

        def fetch(page):
            calls.append(page)
            return {"totalPaginas": 2, "resultado": [
                {"codigoUasg": "153167", "nomeUasg": "Colégio Pedro II", "codigoOrgao": 26201}
                if page == 1 else
                {"codigoUasg": "200005", "nomeUasg": "Outro órgão", "codigoOrgao": 123},
                {"codigoUasg": "153167", "nomeUasg": "Colégio Pedro II", "codigoOrgao": 26201},
            ]}

        payload = uasgs.collect(fetch, dt.datetime(2026, 9, 24, tzinfo=dt.timezone.utc))
        self.assertEqual(calls, [1, 2])
        self.assertEqual(len(payload["items"]), 2)
        self.assertEqual({x["codigo"] for x in payload["items"]}, {"153167", "200005"})
        self.assertEqual(payload["generatedAt"], "2026-09-24T00:00:00Z")

    def test_rejects_incomplete_response_before_publishing(self):
        with self.assertRaises(ValueError):
            uasgs.collect(lambda _: {"resultado": []})


if __name__ == "__main__":
    unittest.main()
