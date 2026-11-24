import unittest

from tests import helpers  # noqa: F401
from topiclib import contracts, fields


class Parse(unittest.TestCase):
    def test_documented_forms_are_equivalent(self):
        # The three spellings the YouTube getting-started guide gives for one selection.
        a = fields.parse("items(id,snippet/title,snippet/position)")
        b = fields.parse("items(id,snippet(title,position))")
        self.assertEqual(a, b)
        self.assertEqual(a, {"items": {"id": None, "snippet": {"title": None, "position": None}}})

    def test_every_selector_the_client_sends_parses(self):
        for key, expr in contracts.FIELDS.items():
            with self.subTest(key=key):
                tree = fields.parse(expr)
                self.assertIn("items", tree)

    def test_malformed_selectors_fail(self):
        for bad in ("", "items(id", "items(id))", "items(,id)", "a//b", "items()"):
            with self.subTest(expr=bad), self.assertRaises(fields.FieldsError):
                fields.parse(bad)


class Apply(unittest.TestCase):
    def test_apply_filters_dicts_and_lists(self):
        body = {"kind": "x", "nextPageToken": "t", "items": [{"id": "1", "snippet": {"title": "a", "description": "d"}, "statistics": {"viewCount": "5"}}]}
        out = fields.apply(fields.parse("nextPageToken,items(id,snippet(title))"), body)
        self.assertEqual(out, {"nextPageToken": "t", "items": [{"id": "1", "snippet": {"title": "a"}}]})

    def test_missing_fields_stay_missing(self):
        out = fields.apply(fields.parse("items(statistics(likeCount))"), {"items": [{"statistics": {"viewCount": "1"}}]})
        self.assertEqual(out, {"items": [{"statistics": {}}]})

    def test_wildcard_keeps_everything(self):
        body = {"a": 1, "b": {"c": 2}}
        self.assertEqual(fields.apply(fields.parse("*"), body), body)


if __name__ == "__main__":
    unittest.main()
