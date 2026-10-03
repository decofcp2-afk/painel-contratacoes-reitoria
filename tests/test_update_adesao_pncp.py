import http.client
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import update_adesao_pncp as updater


class AdesaoRequestTests(unittest.TestCase):
    def test_retries_disconnection_then_returns_json(self):
        with patch.object(updater.urllib.request, "urlopen", side_effect=[
            http.client.RemoteDisconnected("connection closed"),
            io.BytesIO(b'{"items": []}'),
        ]) as open_url, patch.object(updater.time, "sleep") as sleep:
            self.assertEqual(updater.request_json("https://pncp.gov.br/api/search/"), {"items": []})
        self.assertEqual(open_url.call_count, 2)
        sleep.assert_called_once_with(1)

    def test_exhausted_retries_keep_previous_file(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "atas-adesao-pncp.json"
            original = '{"items":{"existing":true}}\n'
            output.write_text(original, encoding="utf-8")
            with patch.object(updater, "OUTPUT", output), patch.object(
                updater.urllib.request, "urlopen",
                side_effect=http.client.RemoteDisconnected("connection closed"),
            ) as open_url, patch.object(updater.time, "sleep") as sleep:
                with self.assertRaises(http.client.RemoteDisconnected):
                    updater.main()
            self.assertEqual(open_url.call_count, 4)
            self.assertEqual([call.args[0] for call in sleep.call_args_list], [1, 2, 4])
            self.assertEqual(output.read_text(encoding="utf-8"), original)
            self.assertFalse(output.with_suffix(".json.tmp").exists())


if __name__ == "__main__":
    unittest.main()
