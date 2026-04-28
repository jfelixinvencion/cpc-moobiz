import test from "node:test";
import assert from "node:assert/strict";

import { isGpsOff, normalizeConductorName } from "../src/lib/gps-filter.ts";

test("normaliza nombres: mayúsculas/minúsculas, tildes y espacios", () => {
  assert.equal(normalizeConductorName("  José   Álvarez "), "jose alvarez");
  assert.equal(normalizeConductorName("JOSE ALVAREZ"), "jose alvarez");
  assert.equal(normalizeConductorName("María   Del   Pilar"), "maria del pilar");
});

test("detecta GPS apagado con valores permitidos", () => {
  assert.equal(isGpsOff("false"), true);
  assert.equal(isGpsOff("False"), true);
  assert.equal(isGpsOff("APAGADO"), true);
  assert.equal(isGpsOff("0"), true);
});

test("considera otros valores como GPS encendido", () => {
  assert.equal(isGpsOff("true"), false);
  assert.equal(isGpsOff("encendido"), false);
  assert.equal(isGpsOff("1"), false);
});
