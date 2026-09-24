import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from update_atas_cpii import build, cpii_units


class CpiiAtasTests(unittest.TestCase):
    def test_restricts_units_and_does_not_repeat_reitoria(self):
        catalog = {"items": [
            {"codigo": "155625", "orgao": "26201"},
            {"codigo": "153167", "orgao": "26201"},
            {"codigo": "201057", "orgao": "99999"},
        ]}
        calls = []

        def gather(**kwargs):
            calls.append(kwargs["uasg"])
            return {"items": [{"codigoUnidadeGerenciadora": kwargs["uasg"]}]}

        result = build(catalog, gather, dt.datetime(2026, 9, 24, tzinfo=dt.timezone.utc))
        self.assertEqual(calls, [155625])
        self.assertEqual(result["units"], ["153167", "155625"])
        self.assertEqual(len(result["items"]), 1)

    def test_rejects_missing_cpii_catalog(self):
        with self.assertRaises(ValueError):
            cpii_units({"items": [{"codigo": "201057", "orgao": "99999"}]})


if __name__ == "__main__":
    unittest.main()
