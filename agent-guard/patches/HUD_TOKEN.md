# Lock the AAI HUD command API (MEDIUM finding)

At the time of the audit, pid 205652 (`aai hud --port 57025`, which binds only to 127.0.0.1) runs without AAI_HUD_TOKEN.
That means any local process or agent can POST /api/command and run kill, resume, submit_idea, lt_confirm or ingest_report.
The code already supports a token check (aai/hud.py:100). The agent did not restart the HUD, so it is unchanged.

1. Create a token and store it in the Grok Bot vault as "AAI HUD token". Keep it out of /workspace files.
   python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
2. Restart the HUD with the token set in its environment only:
   AAI_HUD_TOKEN='<from vault>' /workspace/aai/.venv/bin/aai hud --port 57025
3. Clients send the header `X-AAI-Token`.
