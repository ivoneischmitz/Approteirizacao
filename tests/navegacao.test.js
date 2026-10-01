import { test } from "node:test";
import assert from "node:assert/strict";
import { linkWaze, linkGoogleMaps } from "../js/navegacao.js";

test("linkWaze navega direto até o destino", () => {
  const url = new URL(linkWaze({ lat: -23.5505, lng: -46.6333 }));
  assert.equal(url.hostname, "waze.com");
  assert.equal(url.searchParams.get("ll"), "-23.550500,-46.633300");
  assert.equal(url.searchParams.get("navigate"), "yes");
});

test("linkGoogleMaps com uma parada não tem waypoints e parte da localização atual", () => {
  const q = new URL(linkGoogleMaps([{ lat: 1, lng: 2 }])).searchParams;
  assert.equal(q.get("destination"), "1.000000,2.000000");
  assert.equal(q.get("waypoints"), null);
  assert.equal(q.get("origin"), null);
  assert.equal(q.get("dir_action"), "navigate");
});

test("linkGoogleMaps mantém a ordem e respeita o limite de paradas", () => {
  const pts = Array.from({ length: 15 }, (_, i) => ({ lat: i, lng: i }));
  const q = new URL(linkGoogleMaps(pts)).searchParams;
  const waypoints = q.get("waypoints").split("|");
  assert.equal(waypoints.length, 9);
  assert.equal(waypoints[0], "0.000000,0.000000");
  assert.equal(q.get("destination"), "9.000000,9.000000");
});

test("linkGoogleMaps recusa lista vazia", () => {
  assert.throws(() => linkGoogleMaps([]));
});
