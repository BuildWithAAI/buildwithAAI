FROM caddy:2.11.7@sha256:685ae3d7c34d9b5f8caeddc5d14051db7bbd88ff1f5a2fa0c16bd8ca328fb7af AS proxy
FROM python:3.12.15-slim-trixie@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
COPY --from=proxy /usr/bin/caddy /usr/bin/caddy
COPY projects/zoora-agent-community/deploy/LICENSE.caddy /usr/share/licenses/caddy/LICENSE
WORKDIR /app
COPY projects/zoora-agent-community/requirements.lock /tmp/community-requirements.lock
RUN python -m pip install --no-cache-dir --disable-pip-version-check --require-hashes --only-binary=:all: -r /tmp/community-requirements.lock
COPY projects/zoora-agent-community/zoora_community ./projects/zoora-agent-community/zoora_community
COPY projects/zoora-agent-community/web ./projects/zoora-agent-community/web
COPY projects/zoora-agent-community/requirements.lock ./projects/zoora-agent-community/requirements.lock
COPY projects/zoora-agent-community/ASE_DESIGN.md ./projects/zoora-agent-community/ASE_DESIGN.md
COPY projects/zoora-platform ./projects/zoora-platform
COPY src ./src
COPY research ./research
COPY docs ./docs
COPY projects/virtual-business-spaces ./projects/virtual-business-spaces
COPY projects/sfp-paper-lab ./projects/sfp-paper-lab
COPY deploy/platform ./deploy/platform
ENV PYTHONPATH=/app:/app/projects/zoora-agent-community:/app/projects/zoora-platform PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080 HOME=/tmp XDG_CONFIG_HOME=/tmp/caddy-config XDG_DATA_HOME=/tmp/caddy-data
EXPOSE 8080
ENTRYPOINT ["python", "-B", "/app/deploy/platform/start.py"]
