import test from "node:test";
import assert from "node:assert/strict";
import { extractRtfText } from "./rtf-extractor.ts";

test("extractRtfText extracts basic text and ignores metadata groups", () => {
  const rtf = "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red0\\green0\\blue0;}\\f0\\fs24 Hello World!\\par Next line.}";
  const result = extractRtfText(rtf);
  assert.equal(result, "Hello World!\nNext line.");
});

test("extractRtfText handles Unicode characters with trailing replacement markers", () => {
  const rtf = "{\\rtf1\\ansi Title: \\u20320?\\u22909? (Chinese)}";
  const result = extractRtfText(rtf);
  assert.equal(result, "Title: 你好 (Chinese)");
});

test("extractRtfText handles hex characters and escaped brackets", () => {
  const rtf = "{\\rtf1 Special: \\'a9 2026 \\{bracketed\\} \\\\backslash\\\\}";
  const result = extractRtfText(rtf);
  assert.equal(result, "Special: © 2026 {bracketed} \\backslash\\");
});

test("extractRtfText handles tables and rows gracefully", () => {
  const rtf = "{\\rtf1\\trowd\\cellx1000\\cellx2000\\intbl Row 1 Col 1\\cell Row 1 Col 2\\cell\\row\\intbl Row 2 Col 1\\cell Row 2 Col 2\\cell\\row}";
  const result = extractRtfText(rtf);
  assert.match(result, /Row 1 Col 1/);
  assert.match(result, /Row 1 Col 2/);
  assert.match(result, /Row 2 Col 1/);
  assert.match(result, /Row 2 Col 2/);
});

test("extractRtfText handles empty or invalid inputs", () => {
  assert.equal(extractRtfText(""), "");
  assert.equal(extractRtfText(null), "");
  assert.equal(extractRtfText(undefined), "");
});
