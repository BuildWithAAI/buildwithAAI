"""Static checks for the Zoora newsletter page. No network and no form POST."""

import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "sites" / "zoora-newsletter" / "public"

REQUIRED_COPY = "Zoora is building tools for people and AI agents to work together. Sign up for product and build updates."
PRIVACY_COPY = "This signup is used for Zoora product and build updates, sent through Kit. You'll get an email asking you to confirm, and you can unsubscribe any time."
KIT_ACTION = "https://app.kit.com/forms/10168331/subscriptions"

FORBIDDEN = (
    "localstorage",
    "sessionstorage",
    "netlify",
    "wallet",
    "phantom",
    "solflare",
    "solana",
    "token",
    "pricing",
    "profit",
    "trading",
    "airdrop",
    "pump.fun",
    "now live",
    "have launched",
    "product launch",
    "$",
)


def contrast(foreground, background):
    def channel(hex_color):
        value = int(hex_color[1:], 16)
        red, green, blue = ((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255

        def linear(channel_value):
            return channel_value / 12.92 if channel_value <= 0.04045 else ((channel_value + 0.055) / 1.055) ** 2.4

        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)

    lighter, darker = sorted((channel(foreground), channel(background)), reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


class NodeParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.nodes = []
        self._stack = []

    def handle_starttag(self, tag, attrs):
        node = {"tag": tag, "attrs": dict(attrs), "text": "", "children": []}
        if self._stack:
            self._stack[-1]["children"].append(node)
        else:
            self.nodes.append(node)
        if tag not in {"input", "meta", "link", "img", "br"}:
            self._stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        for index in range(len(self._stack) - 1, -1, -1):
            if self._stack[index]["tag"] == tag:
                del self._stack[index:]
                return

    def handle_data(self, data):
        if self._stack:
            self._stack[-1]["text"] += data


def walk(nodes):
    for node in nodes:
        yield node
        yield from walk(node["children"])


def parse(name):
    parser = NodeParser()
    parser.feed((PUBLIC / name).read_text(encoding="utf-8"))
    parser.close()
    return parser.nodes


class NewsletterPageTest(unittest.TestCase):
    def setUp(self):
        self.home = parse("index.html")
        self.success = parse("success.html")
        self.home_text = (PUBLIC / "index.html").read_text(encoding="utf-8")
        self.success_text = (PUBLIC / "success.html").read_text(encoding="utf-8")
        self.css = (PUBLIC / "style.css").read_text(encoding="utf-8")

    def test_publish_files_are_static(self):
        names = sorted(path.name for path in PUBLIC.iterdir())
        self.assertEqual(names, ["CNAME", "favicon.svg", "index.html", "style.css", "success.html"])
        self.assertEqual((PUBLIC / "CNAME").read_text(encoding="utf-8").strip(), "zoora.ai")
        self.assertNotIn("<script", self.home_text.lower())
        self.assertNotIn("<script", self.success_text.lower())
        self.assertEqual(re.findall(r"https?://[^\"'\s]+", self.home_text), [KIT_ACTION])
        self.assertNotRegex(self.success_text, r"https?://")

    def test_form_posts_to_kit(self):
        forms = [node for node in walk(self.home) if node["tag"] == "form"]
        self.assertEqual(len(forms), 1)
        form = forms[0]
        self.assertEqual(form["attrs"]["name"], "newsletter")
        self.assertEqual(form["attrs"]["method"].upper(), "POST")
        self.assertEqual(form["attrs"]["action"], KIT_ACTION)
        self.assertEqual(form["attrs"]["aria-describedby"], "privacy-note")
        self.assertNotIn("data-netlify", form["attrs"])
        self.assertNotIn("netlify", form["attrs"])

        fields = {node["attrs"].get("name"): node for node in walk(form["children"]) if node["tag"] == "input"}
        self.assertEqual(set(fields), {"email_address", "consent"})
        email = fields["email_address"]["attrs"]
        self.assertEqual(email["type"], "email")
        self.assertEqual(email["id"], "email")
        self.assertIn("required", email)
        self.assertEqual(email["autocomplete"], "email")
        self.assertEqual(email["maxlength"], "254")
        consent = fields["consent"]["attrs"]
        self.assertEqual(consent["type"], "checkbox")
        self.assertEqual(consent["id"], "consent")
        self.assertEqual(consent["value"], "yes")
        self.assertIn("required", consent)

        buttons = [node for node in walk(form["children"]) if node["tag"] == "button"]
        self.assertEqual(len(buttons), 1)
        self.assertEqual(buttons[0]["attrs"]["type"], "submit")
        self.assertIn("Sign up", buttons[0]["text"])
        self.assertTrue((PUBLIC / "success.html").is_file())

    def test_labels_name_the_controls(self):
        labels = [node for node in walk(self.home) if node["tag"] == "label"]
        by_for = {node["attrs"].get("for"): node["text"] for node in labels}
        self.assertEqual(set(by_for), {"email", "consent"})
        self.assertIn("Email", by_for["email"])
        self.assertIn("Send me Zoora product and build updates.", by_for["consent"])

    def test_copy_and_success_page_do_not_claim_a_launch(self):
        visible = re.sub(r"<[^>]+>", " ", self.home_text)
        self.assertIn(REQUIRED_COPY, visible)
        self.assertIn(PRIVACY_COPY, visible)
        self.assertIn("Zoora is still being built.", visible)
        success_visible = re.sub(r"<[^>]+>", " ", self.success_text)
        self.assertIn("Almost done", success_visible)
        self.assertIn("Check your inbox for a confirmation email from Zoora and click the link to finish signing up.", success_visible)
        self.assertIn("You can unsubscribe from any email at any time.", success_visible)
        combined = (self.home_text + self.success_text + self.css).lower()
        for phrase in FORBIDDEN:
            self.assertNotIn(phrase, combined, phrase)
        links = [node for node in walk(self.success) if node["tag"] == "a" and node["attrs"].get("href") == "./"]
        self.assertEqual(len(links), 1)

    def test_accessible_color_and_motion(self):
        self.assertIn("prefers-reduced-motion", self.css)
        self.assertIn(":focus-visible", self.css)
        self.assertIn("width=device-width", self.home_text)
        values = dict(re.findall(r"--([a-z-]+):\s*(#[0-9a-fA-F]{6})", self.css))
        self.assertGreaterEqual(contrast(values["text"], values["bg"]), 4.5)
        self.assertGreaterEqual(contrast(values["muted"], values["bg"]), 4.5)
        self.assertGreaterEqual(contrast(values["muted"], values["surface"]), 4.5)
        self.assertGreaterEqual(contrast(values["button-text"], values["button-bg"]), 4.5)
        self.assertGreaterEqual(contrast(values["focus"], values["bg"]), 3)


if __name__ == "__main__":
    unittest.main()
