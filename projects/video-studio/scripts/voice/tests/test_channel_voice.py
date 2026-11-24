"""Zoo's default voice comes from content/<channel>/channel.json (owner decision, CLAUDE.md 2026-11-24)."""

import json
import os
import tempfile
import unittest

from voicelib.pipeline import channel_voice


class ChannelVoiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.channel = os.path.join(self.tmp.name, "zoora-ai")
        self.episode = os.path.join(self.channel, "some-slug")
        os.makedirs(self.episode)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, doc):
        with open(os.path.join(self.channel, "channel.json"), "w", encoding="utf-8") as fh:
            fh.write(doc if isinstance(doc, str) else json.dumps(doc))

    def test_by_lang_then_default(self):
        self.write({"zooVoice": {"default": "im_nicola", "byLang": {"en": "im_nicola", "es": "em_alex"}}})
        self.assertEqual(channel_voice(self.episode, "en"), "im_nicola")
        self.assertEqual(channel_voice(self.episode, "es"), "em_alex")
        self.assertEqual(channel_voice(self.episode, "ja"), "im_nicola")  # not in byLang: the default

    def test_real_channel_file(self):
        here = os.path.dirname(os.path.abspath(__file__))
        episode = os.path.join(here, "..", "..", "..", "content", "zoora-ai", "_engine-demo")
        for lang in ("en", "es", "pt-br", "hi", "it", "zh"):
            self.assertEqual(channel_voice(episode, lang), "im_nicola", lang)

    def test_absent_or_broken(self):
        self.assertIsNone(channel_voice(self.episode, "en"))  # no channel.json: the caller uses langs.py
        self.write("{not json")
        self.assertIsNone(channel_voice(self.episode, "en"))
        self.write({"displayName": "x"})
        self.assertIsNone(channel_voice(self.episode, "en"))
        self.write({"zooVoice": {"byLang": {"en": ""}}})
        self.assertIsNone(channel_voice(self.episode, "en"))
        self.write({"zooVoice": "im_nicola"})
        self.assertIsNone(channel_voice(self.episode, "en"))


if __name__ == "__main__":
    unittest.main()
