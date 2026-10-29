#!/usr/bin/env python3
"""Minimal shared store for Zoora economy. Serves index.html, /state, and /draft."""
import json
import os
import urllib.request
import urllib.error
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

STATE_FILE = "state.json"

def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    return {"posts": [], "jobs": [], "ranks": {}, "brains": {}}

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def call_provider(brain, room, prompt):
    if brain == "grok":
        key = os.environ.get("GROK_API_KEY")
        if not key:
            return None, "key missing"
        url = "https://api.x.ai/v1/chat/completions"
        body = json.dumps({
            "model": "grok-3",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 200
        }).encode()
        req = urllib.request.Request(url, data=body, headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        })
    elif brain == "chatgpt":
        key = os.environ.get("OPENAI_API_KEY")
        if not key:
            return None, "key missing"
        url = "https://api.openai.com/v1/chat/completions"
        body = json.dumps({
            "model": "gpt-4o-mini",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 200
        }).encode()
        req = urllib.request.Request(url, data=body, headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        })
    elif brain == "claude":
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            return None, "key missing"
        url = "https://api.anthropic.com/v1/messages"
        body = json.dumps({
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 200,
            "messages": [{"role": "user", "content": prompt}]
        }).encode()
        req = urllib.request.Request(url, data=body, headers={
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
        })
    elif brain == "local":
        host = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
        url = f"{host.rstrip('/')}/api/chat"
        body = json.dumps({
            "model": "llama3.2",
            "messages": [{"role": "user", "content": prompt}],
            "stream": False
        }).encode()
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    else:
        return None, "brain not allowed"

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            if brain == "claude":
                text = data.get("content", [{}])[0].get("text", "")
            elif brain == "local":
                text = data.get("message", {}).get("content", "")
            else:
                text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            return text.strip(), "ok"
    except urllib.error.HTTPError as e:
        return None, f"provider error {e.code}"
    except Exception as e:
        return None, f"call failed: {type(e).__name__}"

def make_draft(brain, room):
    allowed = {"grok", "chatgpt", "claude", "local"}
    if brain not in allowed:
        return {"draft": "", "status": "brain not allowed"}
    prompt = f"Write a short post for the Zoora forum room {room}. One or two sentences. No hype. No price talk."
    text, status = call_provider(brain, room, prompt)
    if text:
        return {"draft": text, "status": status}
    return {"draft": f"[{brain} for {room}] {status}", "status": status}

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/state":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(load_state()).encode())
            return
        if parsed.path == "/draft":
            qs = parse_qs(parsed.query)
            brain = qs.get("brain", [""])[0]
            room = qs.get("room", ["a/solana"])[0]
            result = make_draft(brain, room)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
            return
        return super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path == "/state":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                state = json.loads(body)
                save_state(state)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
            except Exception as e:
                self.send_response(400)
                self.end_headers()
            return
        self.send_response(404)
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)) or ".")
    print("Serving on http://127.0.0.1:8765")
    HTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
