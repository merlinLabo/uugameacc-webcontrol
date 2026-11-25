"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const portal = "/usr/share/unifi-core/app/node_modules/@ubnt/unifi-portal/dist/local/index.html";
const nginx = "/usr/share/unifi-core/http/shared-server-defaults.conf";
const tag = '<script defer src="/uu-gameacc.js"></script>';
const include = "include /data/uuplugin-webcontrol/uu-gameacc.nginx.conf;";
const legacyTag = '<script defer src="/uu-game-booster.js"></script>';
const legacyInclude = "include /data/uuplugin-webcontrol/uu-game-booster.nginx.conf;";
const olderInclude = "include /data/uuplugin/uu-game-booster.nginx.conf;";
const mode = process.argv[2];

if (!["check", "install", "uninstall"].includes(mode) || process.argv.length !== 3) {
  throw new Error("Usage: node24 portal_hooks.js check|install|uninstall");
}

function readFile(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Missing or symlinked UniFi file: ${filename}`);
  }
  return fs.readFileSync(filename, "utf8");
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

function replaceFile(filename, contents) {
  const stat = fs.statSync(filename);
  const temporary = path.join(path.dirname(filename),
    `.uu-webcontrol-${randomBytes(8).toString("hex")}`);
  try {
    fs.writeFileSync(temporary, contents, { flag: "wx", mode: stat.mode & 0o7777 });
    fs.chmodSync(temporary, stat.mode & 0o7777);
    fs.chownSync(temporary, stat.uid, stat.gid);
    fs.renameSync(temporary, filename);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

const html = readFile(portal);
const config = readFile(nginx);
if (count(html, "</body>") !== 1 || count(html, tag) > 1 ||
    count(html, legacyTag) > 1) {
  throw new Error("Unexpected portal HTML structure; inspect before installing");
}
if (count(config, include) > 1 || count(config, legacyInclude) > 1) {
  throw new Error("Duplicate UU Nginx include; inspect before installing");
}
if (mode !== "uninstall" && config.includes(olderInclude)) {
  throw new Error("Old UU frontend include found; remove the old frontend first");
}
if (mode !== "uninstall" &&
    html.includes(legacyTag) !== config.includes(legacyInclude)) {
  throw new Error("Incomplete old webcontrol hooks; inspect before installing");
}
if (mode === "check") process.exit(0);

let newHtml = html;
let newConfig = config;
if (mode === "install") {
  newHtml = newHtml.replace(legacyTag, "");
  if (!newHtml.includes(tag)) newHtml = newHtml.replace("</body>", `${tag}</body>`);
  newConfig = newConfig.replace(`${legacyInclude}\n`, "");
  if (!newConfig.includes(include)) {
    newConfig = `${newConfig.trimEnd()}\n\n${include}\n`;
  }
} else {
  newHtml = newHtml.replace(tag, "").replace(legacyTag, "");
  newConfig = newConfig.replace(`${include}\n`, "")
    .replace(`${legacyInclude}\n`, "");
}
if (newHtml !== html) replaceFile(portal, newHtml);
if (newConfig !== config) replaceFile(nginx, newConfig);
