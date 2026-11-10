import http from "node:http";

const secret = (process.env.LUMEN_DESK_SECRET ?? "").trim();
const targetPort = Number(process.env.PORT || 3000);
const listenPort = Number(process.env.LUMEN_DESK_PORT || 3001);

if (!secret) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "desk_proxy", status: 500, route: "desk" }));
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const headers = { ...req.headers, "x-lumen-desk": secret };
  delete headers["fly-client-ip"];
  delete headers["Fly-Client-IP"];
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: targetPort,
      path: req.url,
      method: req.method,
      headers,
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});

server.listen({ port: listenPort, host: "::", ipv6Only: false });
