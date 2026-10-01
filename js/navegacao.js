// Links para iniciar a navegação nos aplicativos de GPS.

const fmt = (p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

// Waze só aceita um destino por link: navega até a próxima parada.
export function linkWaze(destino) {
  return `https://waze.com/ul?${new URLSearchParams({ ll: fmt(destino), navigate: "yes" })}`;
}

// Google Maps aceita várias paradas: a primeira da lista é a próxima e a origem é a
// localização atual do celular. Limita a `maxWaypoints` paradas intermediárias + destino.
export function linkGoogleMaps(paradas, maxWaypoints = 9) {
  if (!paradas.length) throw new Error("Nenhuma parada para navegar");
  const trecho = paradas.slice(0, maxWaypoints + 1);
  const params = new URLSearchParams({
    api: "1",
    destination: fmt(trecho[trecho.length - 1]),
    travelmode: "driving",
    dir_action: "navigate",
  });
  if (trecho.length > 1) params.set("waypoints", trecho.slice(0, -1).map(fmt).join("|"));
  return `https://www.google.com/maps/dir/?${params}`;
}
