import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { runCli } = require("./pi-web-tray.js");

test("runCli with --help returns exit code 0", async () => {
  const res = await runCli(["--help"]);
  assert.equal(res.exitCode, 0);
});

test("runCli with --version returns exit code 0", async () => {
  const res = await runCli(["--version"]);
  assert.equal(res.exitCode, 0);
});

test("runCli with --status returns status object", async () => {
  const res = await runCli(["--status"]);
  assert.equal(res.exitCode, 0);
  assert.ok(res.status);
  assert.equal(typeof res.status.port, "number");
  assert.equal(typeof res.status.isWindows, "boolean");
});
