// Algoritmos de otimização de rota (problema do caixeiro-viajante).
// Funciona com matrizes de custo simétricas ou assimétricas.
// O índice 0 é sempre o ponto de partida (depósito).

const EARTH_RADIUS_KM = 6371;

export function haversine(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function haversineMatrix(points) {
  return points.map((a) => points.map((b) => haversine(a, b)));
}

export function routeCost(route, matrix, roundTrip) {
  let cost = 0;
  for (let i = 0; i < route.length - 1; i++) cost += matrix[route[i]][route[i + 1]];
  if (roundTrip && route.length > 1) cost += matrix[route[route.length - 1]][route[0]];
  return cost;
}

export function nearestNeighbor(matrix) {
  const n = matrix.length;
  const visited = new Array(n).fill(false);
  const route = [0];
  visited[0] = true;
  for (let step = 1; step < n; step++) {
    const last = route[route.length - 1];
    let best = -1;
    for (let j = 0; j < n; j++) {
      if (!visited[j] && (best === -1 || matrix[last][j] < matrix[last][best])) best = j;
    }
    visited[best] = true;
    route.push(best);
  }
  return route;
}

// 2-opt: inverte trechos da rota enquanto houver melhora. O depósito (posição 0) fica fixo.
export function twoOpt(route, matrix, roundTrip) {
  let best = route.slice();
  let bestCost = routeCost(best, matrix, roundTrip);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = best
          .slice(0, i)
          .concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
        const cost = routeCost(candidate, matrix, roundTrip);
        if (cost < bestCost - 1e-9) {
          best = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }
  }
  return best;
}

// Or-opt: move uma parada isolada para outra posição enquanto houver melhora.
export function orOpt(route, matrix, roundTrip) {
  let best = route.slice();
  let bestCost = routeCost(best, matrix, roundTrip);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < best.length; i++) {
      for (let j = 1; j < best.length; j++) {
        if (i === j) continue;
        const candidate = best.slice();
        const [node] = candidate.splice(i, 1);
        candidate.splice(j, 0, node);
        const cost = routeCost(candidate, matrix, roundTrip);
        if (cost < bestCost - 1e-9) {
          best = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }
  }
  return best;
}

export function optimizeRoute(matrix, { roundTrip = true } = {}) {
  if (matrix.length <= 2) return matrix.map((_, i) => i);
  let route = nearestNeighbor(matrix);
  let cost = routeCost(route, matrix, roundTrip);
  // Alterna as heurísticas até que nenhuma melhore mais a rota.
  for (;;) {
    route = orOpt(twoOpt(route, matrix, roundTrip), matrix, roundTrip);
    const next = routeCost(route, matrix, roundTrip);
    if (next >= cost - 1e-9) break;
    cost = next;
  }
  return route;
}
