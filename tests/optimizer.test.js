import { test } from "node:test";
import assert from "node:assert/strict";
import {
  haversine,
  haversineMatrix,
  routeCost,
  nearestNeighbor,
  optimizeRoute,
} from "../js/optimizer.js";

test("haversine: São Paulo → Rio de Janeiro ≈ 360 km", () => {
  const sp = { lat: -23.5505, lng: -46.6333 };
  const rj = { lat: -22.9068, lng: -43.1729 };
  const d = haversine(sp, rj);
  assert.ok(d > 350 && d < 370, `distância inesperada: ${d}`);
});

test("routeCost considera a volta ao depósito apenas quando pedida", () => {
  const m = [
    [0, 1, 5],
    [1, 0, 2],
    [5, 2, 0],
  ];
  assert.equal(routeCost([0, 1, 2], m, false), 3);
  assert.equal(routeCost([0, 1, 2], m, true), 8);
});

test("nearestNeighbor visita todos os pontos começando no depósito", () => {
  const pts = Array.from({ length: 8 }, (_, i) => ({ lat: -23 + i * 0.01, lng: -46 }));
  const route = nearestNeighbor(haversineMatrix(pts));
  assert.equal(route[0], 0);
  assert.deepEqual([...route].sort((a, b) => a - b), pts.map((_, i) => i));
});

test("optimizeRoute desfaz cruzamentos em pontos colineares", () => {
  // Pontos numa reta, embaralhados: a rota ótima (aberta) é percorrê-los em ordem.
  const lngs = [0, 0.05, 0.02, 0.04, 0.01, 0.03];
  const pts = lngs.map((lng) => ({ lat: 0, lng }));
  const route = optimizeRoute(haversineMatrix(pts), { roundTrip: false });
  const order = route.map((i) => lngs[i]);
  assert.deepEqual(order, [0, 0.01, 0.02, 0.03, 0.04, 0.05]);
});

test("optimizeRoute nunca é pior que o vizinho mais próximo", () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let trial = 0; trial < 20; trial++) {
    const pts = Array.from({ length: 15 }, () => ({ lat: rand(), lng: rand() }));
    const m = haversineMatrix(pts);
    for (const roundTrip of [true, false]) {
      const nn = routeCost(nearestNeighbor(m), m, roundTrip);
      const opt = optimizeRoute(m, { roundTrip });
      assert.equal(opt[0], 0);
      assert.equal(new Set(opt).size, pts.length);
      assert.ok(routeCost(opt, m, roundTrip) <= nn + 1e-9);
    }
  }
});

test("optimizeRoute lida com matriz assimétrica", () => {
  const m = [
    [0, 1, 10],
    [10, 0, 1],
    [1, 10, 0],
  ];
  assert.deepEqual(optimizeRoute(m, { roundTrip: true }), [0, 1, 2]);
});
