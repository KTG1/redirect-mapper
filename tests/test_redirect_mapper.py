import tempfile
import unittest
from pathlib import Path

from url_redirect_mapper import Page, best_matches, load_pages, normalized_parts


class RedirectMapperTests(unittest.TestCase):
    def test_normalization_ignores_tracking(self):
        _, path, _, words = normalized_parts("https://www.example.com/Blog/Blue-Shoes/?utm_source=x&q=summer")
        self.assertEqual(path, "blog/blue-shoes")
        self.assertIn("summer", words)
        self.assertNotIn("x", words)

    def test_best_semantic_path_wins(self):
        result = best_matches(
            [Page("https://shop.test/mens/running-shoes")],
            [Page("https://shop.test/women/dresses"), Page("https://shop.test/men/running-shoe-guide")],
        )[0]
        self.assertEqual(result.destination_url, "https://shop.test/men/running-shoe-guide")
        self.assertGreater(result.score, 60)

    def test_csv_requires_url(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.csv"
            path.write_text("address\nhttps://example.com\n")
            with self.assertRaises(ValueError):
                load_pages(path)


if __name__ == "__main__":
    unittest.main()
