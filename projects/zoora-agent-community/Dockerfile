FROM caddy:2.11.7 AS proxy
FROM python:3.12.15-slim-trixie
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
