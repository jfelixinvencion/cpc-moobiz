import test from "node:test";
import assert from "node:assert/strict";

import {
  SCHEDULE_CRITICAL_PRODUCTS,
  canonicalViajeProducto,
  matchesProductFilter,
  scheduleBucketForProducto,
} from "../src/lib/product-categories.ts";

test("incluye VIP LIMA en catálogo de productos diferenciados", () => {
  assert.ok(SCHEDULE_CRITICAL_PRODUCTS.includes("VIP LIMA"));
});

test("clasifica variantes de VIP LIMA como bucket VIP LIMA", () => {
  assert.equal(scheduleBucketForProducto("VIP LIMA"), "VIP LIMA");
  assert.equal(scheduleBucketForProducto("vip_lima"), "VIP LIMA");
  assert.equal(scheduleBucketForProducto("VIP-LIMA"), "VIP LIMA");
});

test("filtro de producto respeta VIP LIMA sin caer en Otros", () => {
  assert.equal(matchesProductFilter("VIP LIMA", "VIP LIMA"), true);
  assert.equal(matchesProductFilter("vip_lima", "VIP LIMA"), true);
  assert.equal(matchesProductFilter("VAN", "VIP LIMA"), false);
});

test("etl canónico normaliza VIP LIMA", () => {
  assert.equal(canonicalViajeProducto("vip_lima"), "VIP LIMA");
  assert.equal(canonicalViajeProducto("  VIP LIMA  "), "VIP LIMA");
});
