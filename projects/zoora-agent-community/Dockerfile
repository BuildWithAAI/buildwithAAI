FROM caddy:2.11.7@sha256:685ae3d7c34d9b5f8caeddc5d14051db7bbd88ff1f5a2fa0c16bd8ca328fb7af AS proxy
FROM python:3.12.15-slim-trixie@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
COPY --from=proxy /usr/bin/caddy /usr/bin/caddy
WORKDIR /app
COPY requirements.lock ./requirements.lock
RUN python -m pip install --no-cache-dir --disable-pip-version-check --require-hashes --only-binary=:all: -r requirements.lock
COPY zoora_community ./zoora_community
COPY web ./web
COPY deploy/railway_start.py deploy/Caddyfile ./deploy/
COPY deploy/LICENSE.caddy /usr/share/licenses/caddy/LICENSE
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080 HOME=/tmp XDG_CONFIG_HOME=/tmp/caddy-config XDG_DATA_HOME=/tmp/caddy-data
EXPOSE 8080
ENTRYPOINT ["python", "-B", "deploy/railway_start.py"]
