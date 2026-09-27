const LINE_META = {
  T1: { name: "North Shore & Western", color: "#F99D1C" },
  T2: { name: "Inner West & Leppington", color: "#0098CD" },
  T3: { name: "Liverpool & Inner West", color: "#F37021" },
  T4: { name: "Eastern Suburbs & Illawarra", color: "#005AA3" },
  T5: { name: "Cumberland", color: "#C4258F" },
  T6: { name: "Lidcombe & Bankstown", color: "#7C3E21" },
  T7: { name: "Olympic Park", color: "#6F818E" },
  T8: { name: "Airport & South", color: "#00954C" },
  T9: { name: "Northern", color: "#D11F2F" },
  M1: { name: "Metro Northwest & Bankstown", color: "#168388" },
  L1: { name: "Dulwich Hill", color: "#BE1622" },
  L2: { name: "Randwick", color: "#DD1E25" },
  L3: { name: "Kingsford", color: "#781140" },
  L4: { name: "Westmead & Carlingford", color: "#BB2043" },
  F1: { name: "Manly", color: "#00774B" },
  F2: { name: "Taronga Zoo", color: "#144734" },
  F3: { name: "Parramatta River", color: "#648C3C" },
  F4: { name: "Pyrmont Bay", color: "#BFD730" },
  F5: { name: "Neutral Bay", color: "#286142" },
  F6: { name: "Mosman Bay", color: "#00AB51" },
  F7: { name: "Double Bay", color: "#00B189" },
  F8: { name: "Cockatoo Island", color: "#55622B" },
  F9: { name: "Watsons Bay", color: "#65B32E" },
  F10: { name: "Blackwattle Bay", color: "#5AB031" },
};

const MODE_META = {
  train: { label: "Sydney Trains", color: "#2b2b2b" },
  metro: { label: "Sydney Metro", color: "#168388" },
  light_rail: { label: "Light rail", color: "#BE1622" },
  ferry: { label: "Sydney Ferries", color: "#00774B" },
  lga: { label: "LGA borders", color: "#6b7280" },
};

const LAYER_ORDER = ["lga", "train", "metro", "light_rail", "ferry"];

const BASEMAPS = {
  light: {
    label: "Light grey",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
    theme: "light",
  },
  streets: {
    label: "Streets",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
    theme: "light",
  },
  osm: {
    label: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap",
    theme: "light",
    maxZoom: 19,
  },
  imagery: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
    theme: "dark",
  },
  dark: {
    label: "Dark grey",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
    theme: "dark",
  },
};

const map = L.map("map", {
  center: [-33.86, 151.05],
  zoom: 11,
  minZoom: 9,
  maxZoom: 18,
  zoomControl: true,
});

map.createPane("lgaPane");
map.getPane("lgaPane").style.zIndex = 350;
map.createPane("lgaBorderPane");
map.getPane("lgaBorderPane").style.zIndex = 360;
map.createPane("routePane");
map.getPane("routePane").style.zIndex = 450;
map.createPane("stationPane");
map.getPane("stationPane").style.zIndex = 550;

let baseLayer = null;
let lgaFillLayer = null;
let lgaBorderLayer = null;

const layers = {
  lga: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  metro: L.layerGroup().addTo(map),
  light_rail: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
};

const searchIndex = [];
const lgaPolygons = [];
let stationLayer = null;

function lineColor(ref, mode) {
  if (LINE_META[ref]) return LINE_META[ref].color;
  if (mode === "metro") return MODE_META.metro.color;
  if (mode === "light_rail") return MODE_META.light_rail.color;
  if (mode === "ferry") return MODE_META.ferry.color;
  return "#444";
}

function centroid(feature) {
  const geom = feature.geometry;
  let rings = [];
  if (geom.type === "Polygon") rings = geom.coordinates;
  if (geom.type === "MultiPolygon") rings = geom.coordinates.flat();
  let x = 0;
  let y = 0;
  let n = 0;
  rings.forEach((ring) => {
    ring.forEach(([lon, lat]) => {
      x += lon;
      y += lat;
      n += 1;
    });
  });
  return n ? [y / n, x / n] : null;
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function lgaForPoint(lon, lat) {
  for (const feature of lgaPolygons) {
    const geom = feature.geometry;
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    for (const poly of polys) {
      if (pointInRing(lon, lat, poly[0])) return feature.properties.name;
    }
  }
  return null;
}

const OPACITY = {
  routes: 1,
  stations: 1,
  lgaFill: 1,
  lgaBorder: 0.85,
};

function routeStyle(feature) {
  const ref = feature.properties.ref;
  return {
    color: lineColor(ref, feature.properties.mode),
    weight: feature.properties.mode === "ferry" ? 2.4 : 3.6,
    opacity: 1,
    pane: "routePane",
    lineCap: "round",
    lineJoin: "round",
    smoothFactor: 0,
  };
}

function addRoutes(geojson, group) {
  L.geoJSON(geojson, {
    filter: (feature) => feature.properties.ref !== "LX",
    style: routeStyle,
    onEachFeature: (feature, layer) => {
      const ref = feature.properties.ref;
      const meta = LINE_META[ref];
      const title = meta ? `${ref} ${meta.name}` : feature.properties.name || ref;
      layer.bindPopup(`<div class="popup"><h3>${title}</h3><p>${feature.properties.mode.replace("_", " ")}</p></div>`);
    },
  }).addTo(group);
}

function stationRadius() {
  const z = map.getZoom();
  if (z >= 15) return 6;
  if (z >= 13) return 5;
  if (z >= 12) return 4;
  return 3;
}

function addStations(geojson) {
  stationLayer = L.geoJSON(geojson, {
    pointToLayer: (feature, latlng) =>
      L.circleMarker(latlng, {
        radius: stationRadius(),
        color: "#fff",
        weight: 1,
        fillColor: MODE_META[feature.properties.mode].color,
        fillOpacity: 1,
        pane: "stationPane",
      }),
    onEachFeature: (feature, layer) => {
      const [lon, lat] = feature.geometry.coordinates;
      const lga = feature.properties.lga || lgaForPoint(lon, lat);
      const mode = MODE_META[feature.properties.mode].label;
      const heading = lga ? `${feature.properties.name} · ${lga}` : feature.properties.name;
      layer.bindPopup(`<div class="popup"><h3>${heading}</h3><p>${mode}</p></div>`);
      layer.bindTooltip(heading, {
        direction: "top",
        offset: [0, -6],
        opacity: 0.95,
      });
      layers[feature.properties.mode].addLayer(layer);
      searchIndex.push({
        kind: "station",
        name: feature.properties.name,
        mode: feature.properties.mode,
        lga,
        layer,
        latlng: layer.getLatLng(),
      });
    },
  });
}

function currentTheme() {
  const selected = document.getElementById("basemap")?.value || "light";
  return BASEMAPS[selected]?.theme || "light";
}

function lgaFillStyle() {
  const dark = currentTheme() === "dark";
  return {
    stroke: false,
    color: "transparent",
    weight: 0,
    opacity: 0,
    fill: true,
    fillColor: dark ? "#d7dde6" : "#6b7280",
    fillOpacity: dark ? 0.1 : 0.08,
    pane: "lgaPane",
    smoothFactor: 0,
  };
}

function lgaBorderStyle() {
  const dark = currentTheme() === "dark";
  return {
    color: dark ? "#e8edf3" : "#3f4a57",
    weight: 1,
    opacity: 1,
    fill: false,
    lineCap: "butt",
    lineJoin: "miter",
    pane: "lgaBorderPane",
    interactive: false,
    smoothFactor: 0,
  };
}

function applyLgaTheme() {
  if (lgaFillLayer) lgaFillLayer.setStyle(lgaFillStyle());
  if (lgaBorderLayer) lgaBorderLayer.setStyle(lgaBorderStyle());
  map.getContainer().classList.toggle("theme-dark", currentTheme() === "dark");
}

function addLgas(geojson, borders) {
  lgaFillLayer = L.geoJSON(geojson, {
    style: lgaFillStyle,
    smoothFactor: 0,
    onEachFeature: (feature, layer) => {
      lgaPolygons.push(feature);
      layer.on("mouseover", () => layer.setStyle({ fillOpacity: 0.22 }));
      layer.on("mouseout", () => layer.setStyle(lgaFillStyle()));
      const official = feature.properties.officialName || feature.properties.name;
      layer.bindPopup(`<div class="popup"><h3>${official}</h3><p>Local government area</p></div>`);
      const center = centroid(feature);
      if (center) {
        const label = L.marker(center, {
          interactive: false,
          pane: "lgaPane",
          icon: L.divIcon({
            className: "lga-label",
            html: feature.properties.name,
            iconSize: [0, 0],
          }),
        });
        layers.lga.addLayer(label);
        searchIndex.push({
          kind: "lga",
          name: feature.properties.name,
          mode: "lga",
          layer,
          latlng: L.latLng(center),
          bounds: layer.getBounds(),
        });
      }
    },
  }).addTo(layers.lga);

  lgaBorderLayer = L.geoJSON(borders, { style: lgaBorderStyle }).addTo(layers.lga);
}

function applyOpacity() {
  map.getPane("routePane").style.opacity = String(OPACITY.routes);
  map.getPane("stationPane").style.opacity = String(OPACITY.stations);
  map.getPane("lgaPane").style.opacity = String(OPACITY.lgaFill);
  map.getPane("lgaBorderPane").style.opacity = String(OPACITY.lgaBorder);
  localStorage.setItem("sydney-map-opacity", JSON.stringify(OPACITY));
}

function setupOpacity() {
  const saved = localStorage.getItem("sydney-map-opacity");
  if (saved) {
    try {
      Object.assign(OPACITY, JSON.parse(saved));
    } catch {
      /* keep defaults */
    }
  }
  const root = document.getElementById("opacity");
  const items = [
    ["routes", "Routes"],
    ["stations", "Stations"],
    ["lgaFill", "LGA fills"],
    ["lgaBorder", "LGA borders"],
  ];
  items.forEach(([key, label]) => {
    const wrap = document.createElement("label");
    wrap.className = "slider";
    wrap.innerHTML = `<header><span>${label}</span><span data-val="${key}">${Math.round(OPACITY[key] * 100)}%</span></header><input type="range" min="0" max="100" value="${Math.round(OPACITY[key] * 100)}" data-opacity="${key}" />`;
    root.appendChild(wrap);
  });
  root.addEventListener("input", (event) => {
    const key = event.target.dataset.opacity;
    if (!key) return;
    OPACITY[key] = Number(event.target.value) / 100;
    const readout = root.querySelector(`[data-val="${key}"]`);
    if (readout) readout.textContent = `${event.target.value}%`;
    applyOpacity();
  });
  applyOpacity();
}

function renderToggles() {
  const root = document.getElementById("layers");
  LAYER_ORDER.forEach((key) => {
    const label = document.createElement("label");
    label.className = "toggle";
    label.innerHTML = `<input type="checkbox" checked data-layer="${key}" /><span class="swatch" style="background:${MODE_META[key === "train" ? "train" : key].color}"></span>${MODE_META[key === "train" ? "train" : key].label}`;
    root.appendChild(label);
  });
  root.addEventListener("change", (event) => {
    const key = event.target.dataset.layer;
    if (!key) return;
    if (event.target.checked) map.addLayer(layers[key]);
    else map.removeLayer(layers[key]);
  });
}

function renderLegend() {
  const root = document.getElementById("legend");
  const groups = [
    ["Sydney Trains", ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9"]],
    ["Metro & light rail", ["M1", "L1", "L2", "L3", "L4"]],
    ["Ferries", ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10"]],
  ];
  groups.forEach(([title, refs]) => {
    const wrap = document.createElement("div");
    wrap.className = "legend-group";
    wrap.innerHTML = `<h2>${title}</h2>`;
    refs.forEach((ref) => {
      const meta = LINE_META[ref];
      const row = document.createElement("div");
      row.className = "legend-item";
      row.innerHTML = `<span class="swatch" style="background:${meta.color}"></span>${ref} ${meta.name}`;
      wrap.appendChild(row);
    });
    root.appendChild(wrap);
  });
}

function renderStats(counts) {
  const root = document.getElementById("stats");
  [
    [counts.train, "Train stations"],
    [counts.metro, "Metro stations"],
    [counts.light_rail, "Light rail stops"],
    [counts.ferry, "Ferry wharves"],
    [counts.lga, "LGAs"],
    [counts.lines, "Mapped lines"],
  ].forEach(([value, label]) => {
    const el = document.createElement("div");
    el.className = "stat";
    el.innerHTML = `<strong>${value}</strong><p>${label}</p>`;
    root.appendChild(el);
  });
}

function setBasemap(id) {
  const spec = BASEMAPS[id] || BASEMAPS.light;
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = L.tileLayer(spec.url, {
    attribution: spec.attribution,
    maxZoom: spec.maxZoom || 18,
    crossOrigin: spec.url.includes("arcgisonline") ? true : undefined,
  }).addTo(map);
  localStorage.setItem("sydney-map-style", id);
  applyLgaTheme();
}

function setupBasemap() {
  const select = document.getElementById("basemap");
  const saved = localStorage.getItem("sydney-map-style");
  const initial = BASEMAPS[saved] ? saved : "light";
  Object.entries(BASEMAPS).forEach(([id, spec]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = spec.label;
    if (id === initial) option.selected = true;
    select.appendChild(option);
  });
  select.addEventListener("change", () => setBasemap(select.value));
  setBasemap(initial);
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function drawTiles(ctx) {
  if (!baseLayer || !baseLayer._tiles) return;
  const origin = L.DomUtil.getPosition(map.getPane("mapPane")) || L.point(0, 0);
  const size = baseLayer.getTileSize();
  Object.values(baseLayer._tiles).forEach((tile) => {
    const img = tile.el;
    if (!img || !img.complete || !img.naturalWidth) return;
    const pos = L.DomUtil.getPosition(img);
    if (!pos) return;
    try {
      ctx.drawImage(img, pos.x + origin.x, pos.y + origin.y, size.x, size.y);
    } catch {
      /* tainted or not yet paintable */
    }
  });
}

function drawPolyline(ctx, latlngs, style) {
  if (!latlngs.length) return;
  ctx.beginPath();
  latlngs.forEach((ll, i) => {
    const p = map.latLngToContainerPoint(ll);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.weight;
  ctx.globalAlpha = style.opacity ?? 1;
  ctx.lineCap = style.lineCap || "round";
  ctx.lineJoin = style.lineJoin || "round";
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function flattenLatLngLines(latlngs) {
  if (!latlngs || !latlngs.length) return [];
  if (latlngs[0] && latlngs[0].lat != null) return [latlngs];
  return latlngs.flatMap(flattenLatLngLines);
}

function eachLatLngLine(layer, visit) {
  if (!layer.getLatLngs) return;
  flattenLatLngLines(layer.getLatLngs()).forEach(visit);
}

function walkLayers(layer, visit) {
  if (layer.eachLayer) {
    layer.eachLayer((child) => walkLayers(child, visit));
    return;
  }
  visit(layer);
}

function renderMapCanvas() {
  const size = map.getSize();
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = size.x * scale;
  canvas.height = size.y * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = getComputedStyle(map.getContainer()).backgroundColor || "#d8d3c8";
  ctx.fillRect(0, 0, size.x, size.y);
  drawTiles(ctx);

  if (map.hasLayer(layers.lga) && lgaFillLayer) {
    const fill = lgaFillStyle();
    lgaFillLayer.eachLayer((layer) => {
      if (!layer.getLatLngs) return;
      const rings = layer.getLatLngs();
      const polys = Array.isArray(rings[0]) && rings[0][0] && rings[0][0].lat != null ? [rings] : rings;
      ctx.beginPath();
      polys.forEach((poly) => {
        (Array.isArray(poly[0]) ? poly : [poly]).forEach((ring) => {
          ring.forEach((ll, i) => {
            const p = map.latLngToContainerPoint(ll);
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.closePath();
        });
      });
      ctx.fillStyle = fill.fillColor;
      ctx.globalAlpha = fill.fillOpacity;
      ctx.fill("evenodd");
      ctx.globalAlpha = 1;
    });
  }

  if (map.hasLayer(layers.lga) && lgaBorderLayer) {
    lgaBorderLayer.eachLayer((layer) => eachLatLngLine(layer, (line) => drawPolyline(ctx, line, lgaBorderStyle())));
  }

  ["train", "metro", "light_rail", "ferry"].forEach((key) => {
    if (!map.hasLayer(layers[key])) return;
    walkLayers(layers[key], (layer) => {
      if (layer.feature && layer.feature.geometry && layer.feature.geometry.type !== "Point") {
        eachLatLngLine(layer, (line) => drawPolyline(ctx, line, routeStyle(layer.feature)));
      }
    });
  });

  ["train", "metro", "light_rail", "ferry"].forEach((key) => {
    if (!map.hasLayer(layers[key])) return;
    walkLayers(layers[key], (layer) => {
      if (!layer.getLatLng || !layer.options || layer.options.fillColor == null) return;
      const p = map.latLngToContainerPoint(layer.getLatLng());
      const r = layer.getRadius ? layer.getRadius() : 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = layer.options.fillColor;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    });
  });

  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not create image"))), "image/png");
  });
}

async function exportPng() {
  const filename = `sydney-transport-map-${stamp()}.png`;
  const blob = await canvasToBlob(renderMapCanvas());
  const file = new File([blob], filename, { type: "image/png" });
  return { file, blob, filename, url: URL.createObjectURL(blob) };
}

function triggerDownload(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function isAppleMobile() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function setupDownload() {
  const saveButton = document.getElementById("download");
  const shareButton = document.getElementById("share");

  async function withBusy(button, label, work) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = label;
    try {
      await work();
    } catch (err) {
      console.error(err);
      button.textContent = "Failed";
      await new Promise((resolve) => setTimeout(resolve, 1400));
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  saveButton.addEventListener("click", () => {
    withBusy(saveButton, "Saving…", async () => {
      const exported = await exportPng();
      if (isAppleMobile() && exported.url.startsWith("/")) {
        window.location.assign(exported.url);
        return;
      }
      triggerDownload(exported.url, exported.filename);
    });
  });

  shareButton.addEventListener("click", () => {
    withBusy(shareButton, "Preparing…", async () => {
      const exported = await exportPng();
      const absolute = new URL(exported.url, window.location.href).href;
      if (navigator.canShare && navigator.canShare({ files: [exported.file] })) {
        await navigator.share({
          files: [exported.file],
          title: "Sydney transport map",
          text: "Sydney trains, metro, ferry and light rail",
        });
        return;
      }
      if (navigator.share) {
        await navigator.share({
          title: "Sydney transport map",
          text: "Sydney trains, metro, ferry and light rail",
          url: absolute,
        });
        return;
      }
      triggerDownload(exported.url, exported.filename);
    });
  });
}

async function setupPhoneAccess() {
  const box = document.getElementById("phone-access");
  const link = document.getElementById("phone-url");
  const qr = document.getElementById("phone-qr");
  if (!box || !link || !qr) return;
  const here = window.location.href.split("#")[0];
  const publicHost = !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
  let phoneUrl = here;
  if (!publicHost) {
    try {
      const res = await fetch("/api/host");
      const data = await res.json();
      const remote = (data.urls || []).filter((url) => !url.includes("127.0.0.1"));
      phoneUrl = data.public || remote.find((url) => url.includes("://192.168.")) || remote[0] || here;
    } catch {
      phoneUrl = here;
    }
  }
  box.hidden = false;
  link.href = phoneUrl;
  link.textContent = phoneUrl;
  qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(phoneUrl)}`;
  qr.hidden = false;
}

function setupSearch() {
  const input = document.getElementById("search");
  const list = document.getElementById("results");

  function hide() {
    list.hidden = true;
    list.innerHTML = "";
  }

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) {
      hide();
      return;
    }
    const hits = searchIndex
      .filter((item) => item.name.toLowerCase().includes(q))
      .slice(0, 12);
    list.innerHTML = "";
    hits.forEach((item, i) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      const kind = item.kind === "lga" ? "LGA" : [MODE_META[item.mode].label, item.lga].filter(Boolean).join(" · ");
      btn.innerHTML = `${item.name}<small>${kind}</small>`;
      if (i === 0) btn.setAttribute("aria-selected", "true");
      btn.addEventListener("click", () => {
        if (item.bounds) map.fitBounds(item.bounds.pad(0.08));
        else map.setView(item.latlng, 15);
        item.layer.openPopup(item.latlng);
        hide();
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
    list.hidden = hits.length === 0;
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search")) hide();
  });
}

async function load() {
  renderToggles();
  renderLegend();
  setupSearch();
  setupBasemap();
  setupOpacity();
  setupDownload();
  setupPhoneAccess();

  const bundled = window.MAP_DATA;
  const [lgas, borders, trains, metro, lightRail, ferries, stations] = bundled
    ? [
        bundled.lgas,
        bundled.borders,
        bundled.trains,
        bundled.metro,
        bundled.lightRail,
        bundled.ferries,
        bundled.stations,
      ]
    : await Promise.all([
        fetch("data/lgas.geojson").then((r) => r.json()),
        fetch("data/lga_borders.geojson").then((r) => r.json()),
        fetch("data/trains.geojson").then((r) => r.json()),
        fetch("data/metro.geojson").then((r) => r.json()),
        fetch("data/light_rail.geojson").then((r) => r.json()),
        fetch("data/ferries.geojson").then((r) => r.json()),
        fetch("data/stations.geojson").then((r) => r.json()),
      ]);

  addLgas(lgas, borders);
  applyLgaTheme();
  addRoutes(trains, layers.train);
  addRoutes(metro, layers.metro);
  addRoutes(lightRail, layers.light_rail);
  addRoutes(ferries, layers.ferry);
  addStations(stations);

  const counts = { train: 0, metro: 0, light_rail: 0, ferry: 0, lga: lgas.features.length, lines: 0 };
  stations.features.forEach((f) => {
    counts[f.properties.mode] += 1;
  });
  counts.lines =
    new Set([
      ...trains.features.map((f) => f.properties.ref),
      ...metro.features.map((f) => f.properties.ref),
      ...lightRail.features.filter((f) => f.properties.ref !== "LX").map((f) => f.properties.ref),
      ...ferries.features.map((f) => f.properties.ref),
    ]).size;
  renderStats(counts);

  map.on("zoomend", () => {
    if (stationLayer) stationLayer.eachLayer((layer) => layer.setRadius(stationRadius()));
    document.querySelectorAll(".lga-label").forEach((el) => {
      el.style.display = map.getZoom() >= 10 ? "block" : "none";
    });
  });
}

load().catch((err) => {
  document.getElementById("stats").innerHTML = `<p>Could not load map data. Serve this folder over HTTP (python serve.py).</p>`;
  console.error(err);
});
