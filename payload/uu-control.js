"use strict";

const http = require("node:http");
const { randomBytes, timingSafeEqual } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const service = "uuplugin.service";
const nonce = randomBytes(32).toString("hex");

function serviceOk(...args) {
  const result = spawnSync("/usr/bin/systemctl", [...args, service], {
    stdio: "ignore",
    timeout: 30000,
  });
  return !result.error && result.status === 0;
}

function reply(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": Buffer.byteLength(payload),
    Connection: "close",
  });
  response.end(payload);
}

function currentState() {
  return {
    active: serviceOk("is-active", "--quiet"),
    enabled: serviceOk("is-enabled", "--quiet"),
  };
}

function validNonce(value) {
  if (typeof value !== "string" || value.length !== nonce.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(nonce));
}

const server = http.createServer((request, response) => {
  if (!((request.method === "GET" && request.url === "/status") ||
        (request.method === "POST" && request.url === "/toggle"))) {
    reply(response, 404, { error: "Not found" });
    return;
  }

  const role = String(request.headers["x-userrole"] || "").toLowerCase();
  if (!request.headers["x-userid"] ||
      !/^(owner|admin|super_admin|superadmin)$/.test(role)) {
    reply(response, 403, { error: "UniFi administrator access required" });
    return;
  }

  if (request.method === "GET") {
    reply(response, 200, { ...currentState(), nonce });
    return;
  }

  if (!validNonce(request.headers["x-uu-nonce"])) {
    reply(response, 403, { error: "Invalid request token" });
    return;
  }

  const declaredLength = request.headers["content-length"];
  if (declaredLength === undefined || !/^\d+$/.test(declaredLength) ||
      Number(declaredLength) < 1 || Number(declaredLength) > 128 ||
      request.headers["transfer-encoding"] !== undefined) {
    reply(response, 400, { error: "Invalid request size" });
    return;
  }

  const chunks = [];
  let received = 0;
  request.on("data", (chunk) => {
    if (response.writableEnded) return;
    received += chunk.length;
    if (received > 128) {
      reply(response, 400, { error: "Invalid request size" });
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => {
    if (response.writableEnded) return;
    if (received !== Number(declaredLength)) {
      reply(response, 400, { error: "Incomplete request body" });
      return;
    }
    let data;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      reply(response, 400, { error: "Expected enabled boolean" });
      return;
    }
    if (!data || Array.isArray(data) || typeof data !== "object" ||
        typeof data.enabled !== "boolean") {
      reply(response, 400, { error: "Expected enabled boolean" });
      return;
    }
    const command = data.enabled ? ["enable", "--now"] : ["disable", "--now"];
    if (!serviceOk(...command)) {
      reply(response, 500, { error: "Service change failed" });
      return;
    }
    reply(response, 200, currentState());
  });
});

server.maxHeadersCount = 64;
server.headersTimeout = 10000;
server.requestTimeout = 35000;
server.listen(17663, "127.0.0.1");
