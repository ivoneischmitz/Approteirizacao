import { haversineMatrix, optimizeRoute, routeCost } from "./optimizer.js";
import { linkWaze, linkGoogleMaps } from "./navegacao.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";
const OSRM = "https://router.project-osrm.org";
const VELOCIDADE_MEDIA_KMH = 40; // usada quando o OSRM não está disponível
const STORAGE_KEY = "roteirizacao:paradas";
const TRAJETO_KEY = "roteirizacao:trajeto";
const CACHE_KEY = "roteirizacao:geocache";
const PAIS = "br"; // prioriza resultados no Brasil

const $ = (id) => document.getElementById(id);

const estado = {
  paradas: carregar(), // [{ nome, lat, lng }] — índice 0 é a origem
  otimizada: false,
  trajeto: null, // { atual } enquanto a navegação está em andamento
};

const mapa = L.map("mapa").setView([-15.78, -47.93], 4);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(mapa);
const camadaMarcadores = L.layerGroup().addTo(mapa);
let linhaRota = null;

// ---------- Persistência ----------

function carregar() {
  try {
    const dados = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(dados) ? dados : [];
  } catch {
    return [];
  }
}

function salvar() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(estado.paradas));
  } catch {
    /* armazenamento indisponível: segue sem persistir */
  }
}

let cacheGeo = {};
try {
  cacheGeo = JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
} catch {
  cacheGeo = {};
}

function guardarNoCache(texto, { lat, lng }) {
  cacheGeo[texto] = { lat, lng };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheGeo));
  } catch {
    /* sem armazenamento: cache só nesta sessão */
  }
}

// ---------- Status ----------

function status(msg, erro = false) {
  $("status").textContent = msg;
  $("status").classList.toggle("erro", erro);
}

// ---------- Geocodificação ----------

async function geocodificar(texto, limite = 5) {
  const buscar = async (extra) => {
    const url = `${NOMINATIM}?${new URLSearchParams({ q: texto, format: "json", limit: limite, "accept-language": "pt-BR", ...extra })}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Falha na busca (${resp.status})`);
    return resp.json();
  };
  let dados = await buscar({ countrycodes: PAIS });
  if (!dados.length) {
    await new Promise((ok) => setTimeout(ok, 1100)); // política de uso do Nominatim: 1 req/s
    dados = await buscar({});
  }
  return dados.map((d) => ({ nome: d.display_name, lat: Number(d.lat), lng: Number(d.lon) }));
}

async function nomeDoPonto(lat, lng) {
  try {
    const url = `${NOMINATIM_REVERSE}?${new URLSearchParams({ lat, lon: lng, format: "json", "accept-language": "pt-BR" })}`;
    const resp = await fetch(url);
    if (resp.ok) {
      const d = await resp.json();
      if (d.display_name) return d.display_name;
    }
  } catch {
    /* sem rede: usa coordenadas */
  }
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

// ---------- Roteamento (OSRM com fallback em linha reta) ----------

const coordsOSRM = (pts) => pts.map((p) => `${p.lng},${p.lat}`).join(";");

async function matrizes(pontos) {
  try {
    const resp = await fetch(`${OSRM}/table/v1/driving/${coordsOSRM(pontos)}?annotations=duration,distance`);
    const dados = await resp.json();
    if (dados.code !== "Ok") throw new Error(dados.message || dados.code);
    // Pares sem rota viária vêm como null: substitui por um custo muito alto.
    const limpar = (m) => m.map((linha) => linha.map((v) => (v == null ? 1e12 : v)));
    return { duration: limpar(dados.durations), distance: limpar(dados.distances), viaria: true };
  } catch (e) {
    console.warn("OSRM indisponível, usando distância em linha reta", e);
    const km = haversineMatrix(pontos);
    return {
      distance: km.map((l) => l.map((v) => v * 1000)),
      duration: km.map((l) => l.map((v) => (v / VELOCIDADE_MEDIA_KMH) * 3600)),
      viaria: false,
    };
  }
}

async function tracado(pontos) {
  try {
    const resp = await fetch(`${OSRM}/route/v1/driving/${coordsOSRM(pontos)}?overview=full&geometries=geojson`);
    const dados = await resp.json();
    if (dados.code !== "Ok") throw new Error(dados.message || dados.code);
    const rota = dados.routes[0];
    return {
      coords: rota.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distancia: rota.distance,
      duracao: rota.duration,
    };
  } catch {
    return null;
  }
}

// ---------- Ações ----------

function adicionar(parada) {
  estado.paradas.push(parada);
  estado.otimizada = false;
  atualizar();
  if (estado.paradas.length === 1) mapa.setView([parada.lat, parada.lng], 13);
}

function remover(i) {
  estado.paradas.splice(i, 1);
  estado.otimizada = false;
  atualizar();
}

function mover(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= estado.paradas.length) return;
  [estado.paradas[i], estado.paradas[j]] = [estado.paradas[j], estado.paradas[i]];
  estado.otimizada = false;
  atualizar();
}

function rotaFechada() {
  const pts = estado.paradas;
  return $("ida-volta").checked && pts.length > 1 ? [...pts, pts[0]] : pts;
}

async function otimizar() {
  const pts = estado.paradas;
  if (pts.length < 2) return status("Adicione ao menos dois pontos.", true);
  if (pts.length > 100) return status("Máximo de 100 paradas por rota.", true);

  const btn = $("btn-otimizar");
  btn.disabled = true;
  status("Calculando matriz de distâncias…");
  try {
    const roundTrip = $("ida-volta").checked;
    const m = await matrizes(pts);
    const custo = m[$("criterio").value];
    const antes = routeCost(pts.map((_, i) => i), custo, roundTrip);
    status("Otimizando ordem das paradas…");
    const ordem = optimizeRoute(custo, { roundTrip });
    const depois = routeCost(ordem, custo, roundTrip);
    estado.paradas = ordem.map((i) => pts[i]);
    estado.otimizada = true;
    await atualizar();

    const economia = antes > 0 ? ((antes - depois) / antes) * 100 : 0;
    $("res-economia").textContent =
      (economia > 0.05 ? `Economia de ${economia.toFixed(1)}% em relação à ordem original. ` : "A ordem original já era a melhor encontrada. ") +
      (m.viaria ? "" : "Servidor de rotas indisponível: valores estimados em linha reta.");
    status("Rota otimizada.");
  } catch (e) {
    status(`Erro ao otimizar: ${e.message}`, true);
  } finally {
    btn.disabled = false;
  }
}

function exportarCSV() {
  const linhas = [["ordem", "nome", "latitude", "longitude"]];
  estado.paradas.forEach((p, i) => linhas.push([i, p.nome, p.lat, p.lng]));
  const csv = linhas.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "rota.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

// Converte uma linha em parada. Aceita "nome;lat;lng", "lat,lng" ou um endereço livre.
// Retorna { parada } ou { geocodificar: texto } quando precisa buscar o endereço.
function interpretarLinha(linha) {
  const campos = linha.split(/[;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
  const nums = campos.map(Number);
  if (campos.length >= 3 && Number.isFinite(nums[campos.length - 2]) && Number.isFinite(nums[campos.length - 1])) {
    return { parada: { nome: campos.slice(0, -2).join(" ") || linha, lat: nums[campos.length - 2], lng: nums[campos.length - 1] } };
  }
  const m = linha.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) return { parada: { nome: linha, lat: Number(m[1]), lng: Number(m[2]) } };
  return { geocodificar: campos.filter(Boolean).join(", ") };
}

// Busca as coordenadas de cada linha, respeitando o limite de 1 requisição/s do Nominatim.
async function importarLinhas(linhas) {
  const paradas = [];
  const falhas = [];
  let ultimaBusca = 0;
  for (const [n, linha] of linhas.entries()) {
    if (n === 0 && /^(ordem|nome|endere)/i.test(linha) && !/\d/.test(linha)) continue; // cabeçalho
    const r = interpretarLinha(linha);
    let parada = r.parada;
    if (!parada) {
      status(`Buscando endereço ${n + 1} de ${linhas.length}: ${linha}`);
      const cache = cacheGeo[r.geocodificar];
      if (cache) {
        parada = { ...cache, nome: linha };
      } else {
        const espera = ultimaBusca + 1100 - Date.now();
        if (espera > 0) await new Promise((ok) => setTimeout(ok, espera));
        try {
          const [achado] = await geocodificar(r.geocodificar, 1);
          if (achado) {
            parada = { nome: linha, lat: achado.lat, lng: achado.lng };
            guardarNoCache(r.geocodificar, parada);
          }
        } catch {
          parada = null;
        }
        ultimaBusca = Date.now();
      }
    }
    if (parada && Math.abs(parada.lat) <= 90 && Math.abs(parada.lng) <= 180) paradas.push(parada);
    else falhas.push(linha);
  }
  return { paradas, falhas };
}

function mostrarFalhas(falhas) {
  const lista = $("falhas");
  lista.replaceChildren(
    ...falhas.map((f) => {
      const li = document.createElement("li");
      li.textContent = f;
      return li;
    })
  );
  $("bloco-falhas").hidden = falhas.length === 0;
}

async function importarCSV(arquivo) {
  const linhas = (await arquivo.text()).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const { paradas, falhas } = await importarLinhas(linhas);
  estado.paradas.push(...paradas);
  estado.otimizada = false;
  mostrarFalhas(falhas);
  await atualizar();
  ajustarZoom();
  status(`${paradas.length} ponto(s) importado(s)${falhas.length ? `, ${falhas.length} não encontrado(s)` : ""}.`, falhas.length > 0);
}

// Recebe a lista colada, localiza todos os endereços e já devolve a melhor rota.
async function organizarLista() {
  const linhas = $("lista-enderecos").value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!linhas.length) return status("Cole ao menos um endereço.", true);
  const btn = $("btn-organizar");
  btn.disabled = true;
  try {
    const { paradas, falhas } = await importarLinhas(linhas);
    estado.paradas = $("substituir").checked ? paradas : [...estado.paradas, ...paradas];
    estado.otimizada = false;
    mostrarFalhas(falhas);
    // Deixa na caixa só o que não foi encontrado, para o usuário corrigir e tentar de novo.
    $("lista-enderecos").value = falhas.join("\n");
    await atualizar();
    ajustarZoom();
    if (estado.paradas.length >= 2) await otimizar();
    // Na nova tentativa, os endereços corrigidos devem se somar à rota já montada.
    if (falhas.length) $("substituir").checked = false;
    if (falhas.length) status(`${paradas.length} endereço(s) encontrado(s). ${falhas.length} não encontrado(s): corrija-os e clique de novo para adicionar.`, true);
  } finally {
    btn.disabled = false;
  }
}

// ---------- Trajeto (navegação parada a parada) ----------

// Destinos na ordem de visita; a origem é o ponto de saída, então não entra.
function destinos() {
  const pts = rotaFechada();
  return pts.slice(1).map((p, i) => ({ ...p, retorno: $("ida-volta").checked && i === pts.length - 2 }));
}

// Identifica a rota, para não retomar o progresso de um trajeto diferente.
const assinatura = () => JSON.stringify(destinos().map((p) => [p.lat, p.lng]));

function salvarTrajeto() {
  try {
    if (estado.trajeto) localStorage.setItem(TRAJETO_KEY, JSON.stringify({ ...estado.trajeto, rota: assinatura() }));
    else localStorage.removeItem(TRAJETO_KEY);
  } catch {
    /* sem armazenamento: o progresso vale só nesta sessão */
  }
}

function restaurarTrajeto() {
  try {
    const salvo = JSON.parse(localStorage.getItem(TRAJETO_KEY));
    if (salvo && salvo.rota === assinatura()) estado.trajeto = { atual: salvo.atual };
  } catch {
    estado.trajeto = null;
  }
}

function iniciarTrajeto() {
  if (estado.paradas.length < 2) return;
  estado.trajeto = { atual: 0 };
  salvarTrajeto();
  renderTrajeto();
  $("painel").scrollTop = 0;
  renderMarcadores();
  focarProxima();
}

function encerrarTrajeto() {
  estado.trajeto = null;
  salvarTrajeto();
  renderTrajeto();
  renderMarcadores();
  ajustarZoom();
}

function irPara(indice) {
  estado.trajeto.atual = Math.max(0, Math.min(indice, destinos().length));
  salvarTrajeto();
  renderTrajeto();
  renderMarcadores();
  focarProxima();
}

function focarProxima() {
  const proxima = destinos()[estado.trajeto?.atual];
  if (proxima) mapa.setView([proxima.lat, proxima.lng], Math.max(mapa.getZoom(), 14));
}

function renderTrajeto() {
  const ativo = Boolean(estado.trajeto);
  document.body.classList.toggle("navegando", ativo);
  $("navegacao").hidden = !ativo;
  if (!ativo) return;

  const lista = destinos();
  const atual = estado.trajeto.atual;
  const proxima = lista[atual];
  const concluido = !proxima;

  $("barra").style.width = `${(Math.min(atual, lista.length) / lista.length) * 100}%`;
  $("nav-progresso").textContent = concluido
    ? `${lista.length} de ${lista.length} concluídas`
    : `Parada ${atual + 1} de ${lista.length}`;
  $("nav-proxima").hidden = concluido;
  $("nav-fim").hidden = !concluido;
  if (proxima) {
    $("nav-nome").textContent = proxima.retorno ? `Retorno à origem — ${proxima.nome}` : proxima.nome;
    $("link-gmaps").href = linkGoogleMaps(lista.slice(atual));
    $("link-waze").href = linkWaze(proxima);
    $("btn-entregue").textContent = atual === lista.length - 1 ? "✓ Cheguei — finalizar trajeto" : "✓ Cheguei — próxima parada";
  }
  $("btn-voltar-parada").hidden = atual === 0;

  const ol = $("nav-lista");
  ol.replaceChildren();
  lista.forEach((p, i) => {
    const li = document.createElement("li");
    li.className = i < atual ? "feita" : i === atual ? "atual" : "";
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = i < atual ? "✓" : p.retorno ? "O" : i + 1;
    const nome = document.createElement("span");
    nome.className = "nome";
    nome.textContent = p.retorno ? `Retorno: ${p.nome}` : p.nome;
    li.append(num, nome);
    li.title = "Tocar para definir como próxima parada";
    li.onclick = () => irPara(i);
    ol.append(li);
  });
}

// ---------- Renderização ----------

function ajustarZoom() {
  if (estado.paradas.length) {
    mapa.fitBounds(L.latLngBounds(estado.paradas.map((p) => [p.lat, p.lng])), { padding: [40, 40] });
  }
}

function icone(rotulo, classe) {
  return L.divIcon({
    className: "",
    html: `<div class="marcador ${classe}">${rotulo}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function renderLista() {
  const lista = $("lista-paradas");
  lista.replaceChildren();
  estado.paradas.forEach((p, i) => {
    const li = document.createElement("li");
    if (i === 0) li.className = "origem";
    li.innerHTML = `
      <span class="num">${i === 0 ? "O" : i}</span>
      <span class="nome"></span>
      <span class="ctrl">
        <button type="button" title="Subir" data-acao="subir">↑</button>
        <button type="button" title="Descer" data-acao="descer">↓</button>
        <button type="button" title="Remover" class="remover" data-acao="remover">✕</button>
      </span>`;
    li.querySelector(".nome").textContent = p.nome;
    li.querySelector('[data-acao="subir"]').onclick = () => mover(i, -1);
    li.querySelector('[data-acao="descer"]').onclick = () => mover(i, 1);
    li.querySelector('[data-acao="remover"]').onclick = () => remover(i);
    lista.append(li);
  });
  $("contador").textContent = `(${estado.paradas.length})`;
  $("vazio").hidden = estado.paradas.length > 0;
}

function renderMarcadores() {
  camadaMarcadores.clearLayers();
  estado.paradas.forEach((p, i) => {
    const conteudo = document.createElement("div");
    const titulo = document.createElement("strong");
    titulo.textContent = i === 0 ? "Origem" : `Parada ${i}`;
    conteudo.append(titulo, document.createElement("br"), p.nome);
    // Durante o trajeto: paradas feitas ficam cinza e a próxima, em destaque.
    let classe = i === 0 ? "origem" : "";
    if (estado.trajeto && i > 0) {
      if (i - 1 < estado.trajeto.atual) classe = "feita";
      else if (i - 1 === estado.trajeto.atual) classe = "proxima";
    }
    L.marker([p.lat, p.lng], { icon: icone(i === 0 ? "O" : i, classe), zIndexOffset: classe === "proxima" ? 1000 : 0 })
      .bindPopup(conteudo)
      .addTo(camadaMarcadores);
  });
}

const formatarKm = (m) => `${(m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
function formatarTempo(s) {
  const h = Math.floor(s / 3600);
  const min = Math.round((s % 3600) / 60);
  return h ? `${h} h ${min} min` : `${min} min`;
}

let renderId = 0;
async function renderRota() {
  const id = ++renderId;
  if (linhaRota) {
    linhaRota.remove();
    linhaRota = null;
  }
  const pts = rotaFechada();
  const temRota = estado.paradas.length >= 2;
  $("btn-iniciar").disabled = !temRota;
  $("btn-exportar").disabled = estado.paradas.length === 0;
  $("resumo").hidden = !temRota;
  if (!temRota) return;

  const t = await tracado(pts);
  if (id !== renderId) return; // uma renderização mais recente já começou
  if (t) {
    linhaRota = L.polyline(t.coords, { color: "#1f6feb", weight: 5, opacity: 0.8 }).addTo(mapa);
    $("res-distancia").textContent = formatarKm(t.distancia);
    $("res-tempo").textContent = formatarTempo(t.duracao);
  } else {
    linhaRota = L.polyline(pts.map((p) => [p.lat, p.lng]), { color: "#1f6feb", weight: 4, dashArray: "6 6" }).addTo(mapa);
    const km = haversineMatrix(pts);
    const metros = pts.slice(1).reduce((s, _, i) => s + km[i][i + 1], 0) * 1000;
    $("res-distancia").textContent = `${formatarKm(metros)} (linha reta)`;
    $("res-tempo").textContent = `${formatarTempo((metros / 1000 / VELOCIDADE_MEDIA_KMH) * 3600)} (estimado)`;
  }
  if (!estado.otimizada) $("res-economia").textContent = "";
}

async function atualizar() {
  salvar();
  // Rota alterada: o progresso de um trajeto anterior deixa de valer.
  if (estado.trajeto) encerrarTrajeto();
  renderLista();
  renderMarcadores();
  await renderRota();
}

// ---------- Eventos ----------

$("form-busca").addEventListener("submit", async (e) => {
  e.preventDefault();
  const texto = $("busca").value.trim();
  if (!texto) return;
  const lista = $("sugestoes");
  status("Buscando…");
  try {
    const resultados = await geocodificar(texto);
    lista.replaceChildren();
    if (!resultados.length) {
      lista.hidden = true;
      return status("Nenhum endereço encontrado.", true);
    }
    for (const r of resultados) {
      const li = document.createElement("li");
      li.textContent = r.nome;
      li.onclick = () => {
        adicionar(r);
        lista.hidden = true;
        $("busca").value = "";
        status("");
      };
      lista.append(li);
    }
    lista.hidden = false;
    status("Escolha um resultado.");
  } catch (err) {
    status(err.message, true);
  }
});

mapa.on("click", async (e) => {
  const { lat, lng } = e.latlng;
  adicionar({ nome: await nomeDoPonto(lat, lng), lat, lng });
});

$("btn-otimizar").onclick = otimizar;
$("btn-limpar").onclick = () => {
  if (estado.paradas.length && confirm("Remover todas as paradas?")) {
    estado.paradas = [];
    estado.otimizada = false;
    atualizar();
  }
};
$("ida-volta").onchange = () => {
  estado.otimizada = false;
  renderRota();
};
$("btn-iniciar").onclick = iniciarTrajeto;
$("btn-encerrar").onclick = () => {
  if (estado.trajeto.atual >= destinos().length || confirm("Encerrar o trajeto em andamento?")) encerrarTrajeto();
};
$("btn-entregue").onclick = () => irPara(estado.trajeto.atual + 1);
$("btn-voltar-parada").onclick = () => irPara(estado.trajeto.atual - 1);
$("btn-exportar").onclick = exportarCSV;
$("btn-organizar").onclick = organizarLista;
$("arquivo-csv").onchange = (e) => {
  const arquivo = e.target.files[0];
  if (arquivo) importarCSV(arquivo).finally(() => (e.target.value = ""));
};

atualizar().then(() => {
  // Retoma um trajeto em andamento (ex.: depois de voltar do Waze ou do Google Maps).
  restaurarTrajeto();
  if (estado.trajeto) {
    renderTrajeto();
    renderMarcadores();
    focarProxima();
  } else {
    ajustarZoom();
  }
});
