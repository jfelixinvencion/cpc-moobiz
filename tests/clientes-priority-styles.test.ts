import assert from "node:assert/strict";
import test from "node:test";

import { clientesPriorityRowClass } from "../src/lib/clientes-priority-styles.ts";

test("clientesPriorityRowClass maps N1 N2 N3 to local CSS classes", () => {
  assert.equal(clientesPriorityRowClass(1), "clientes-priority-n1");
  assert.equal(clientesPriorityRowClass(2), "clientes-priority-n2");
  assert.equal(clientesPriorityRowClass(3), "clientes-priority-n3");
  assert.equal(clientesPriorityRowClass(undefined), "");
});
