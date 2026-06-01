import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENTES_TIMELINE_ACTIVE_STATES,
  computeClientesTimelineAxisBounds,
  floorToLocalHourMs,
  indexOfCurrentHourInAxis,
} from "../src/lib/clientes-timeline-axis.ts";

test("computeClientesTimelineAxisBounds uses min hour among active states", () => {
  const base = new Date("2026-05-30T14:00:00");
  const rows = [
    {
      estado: "Llegado",
      serviceAt: new Date("2026-05-30T08:30:00"),
    },
    {
      estado: "Pendiente",
      serviceAt: new Date("2026-05-30T06:45:00"),
    },
    {
      estado: "Aceptado",
      serviceAt: new Date("2026-05-30T18:20:00"),
    },
  ];

  const { axisStartMs, axisEndMs, fallback } = computeClientesTimelineAxisBounds({
    rows,
    now: base,
    minAxisHours: 24,
  });

  assert.equal(fallback, "active-states-min");
  assert.equal(axisStartMs, floorToLocalHourMs(new Date("2026-05-30T06:45:00")));
  assert.ok(axisEndMs >= floorToLocalHourMs(new Date("2026-05-30T18:20:00")));
});

test("computeClientesTimelineAxisBounds falls back to system hour when no active states", () => {
  const now = new Date("2026-05-30T14:37:00");
  const { axisStartMs, fallback } = computeClientesTimelineAxisBounds({
    rows: [
      { estado: "En camino", serviceAt: new Date("2026-05-30T09:00:00") },
      { estado: "Llegado", serviceAt: new Date("2026-05-30T10:00:00") },
    ],
    now,
    minAxisHours: 24,
  });

  assert.equal(fallback, "system-hour");
  assert.equal(axisStartMs, floorToLocalHourMs(now));
});

test("indexOfCurrentHourInAxis locates now column in slot list", () => {
  const start = floorToLocalHourMs(new Date("2026-05-30T06:00:00"));
  const slots = [
    { ts: start },
    { ts: start + 60 * 60 * 1000 },
    { ts: start + 2 * 60 * 60 * 1000 },
  ];
  const idx = indexOfCurrentHourInAxis(slots, new Date("2026-05-30T07:15:00"));
  assert.equal(idx, 1);
});

test("CLIENTES_TIMELINE_ACTIVE_STATES lists four pre-en camino states", () => {
  assert.deepEqual([...CLIENTES_TIMELINE_ACTIVE_STATES], [
    "Pendiente",
    "Aceptado",
    "Iniciado",
    "Esperando",
  ]);
});
