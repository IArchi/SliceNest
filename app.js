"use strict";

const $ = (id) => document.getElementById(id);
const state = { models: [], previewModelId: null, sourceSlices: [], disabledSlices: new Set(), result: null, viewer: null, nestView: null, nextModelId: 1 };
const canvas = $("nestCanvas"), ctx = canvas.getContext("2d");
const translations = {
  fr: { headerDescription: "Découpez un volume 3D et imbriquez ses tranches sur vos panneaux.", modelsTitle: "1. Modèles et plans de découpe", importFiles: "Importer des fichiers", noFile: "Aucun fichier", modelHint: "Définissez un axe par modèle. Les unités sont supposées être en millimètres.", workpieceTitle: "2. Panneau", width: "Largeur", height: "Hauteur", thickness: "Épaisseur", boardMargin: "Marge panneau", toolDiameter: "Diamètre outil", spacingHint: "La distance minimale entre pièces est égale au diamètre de l'outil.", sliceAndNest: "Découper et imbriquer", startStatus: "Importez un fichier pour commencer.", previewTitle: "Aperçu 3D des tranches", previewHint: "Sélectionnez un modèle à isoler dans la liste. Glissez pour tourner, utilisez la molette pour zoomer.", fitModel: "Cadrer le modèle", viewerEmpty: "Importez un fichier pour afficher sa prévisualisation 3D.", slices: "Tranches", boards: "Panneaux", usage: "Utilisation", layoutTitle: "Disposition des panneaux", layoutHint: "Molette pour zoomer, glissez pour déplacer la vue. Un DXF sera généré par panneau.", fitView: "Recadrer", exportDxf: "Exporter les DXF", generatedSlices: "Tranches générées", noSlices: "Aucune tranche calculée.", show3d: "Afficher dans la vue 3D", normalAxis: "Axe normal", slice: "tranche", board: "panneau", disabled: "désactivée", selectSlice: "Sélectionnez au moins une tranche pour afficher la disposition.", imported: "fichier(s) importé(s)", trianglesLoaded: "triangles chargés.", importError: "Erreur d'import", invalidAscii: "format ASCII non valide", noFiniteCoordinates: "le fichier ne contient aucune coordonnée finie", noIntersection: "aucune intersection n'a été trouvée", sliceError: "Impossible de découper", noSlicesSelected: "Aucune tranche sélectionnée.", invalidDimensions: "vérifiez les dimensions saisies", invalidCoordinates: "le fichier ne contient aucune coordonnée exploitable", marginTooLarge: "la marge dépasse les dimensions du panneau", doesNotFit: "ne tient pas dans la zone utile du panneau", cannotPlace: "impossible de placer", onNewBoard: "sur un nouveau panneau", panelLabel: "Panneau", metricSlices: "Tranches", metricBoards: "Panneaux", metricUsage: "Utilisation", downloadFile: "slices-panneau" },
  en: { headerDescription: "Slice a 3D volume and nest its sections on your boards.", modelsTitle: "1. Models and cutting planes", importFiles: "Import files", noFile: "No file", modelHint: "Set an axis for each model. Units are assumed to be millimetres.", workpieceTitle: "2. Workpiece", width: "Width", height: "Height", thickness: "Thickness", boardMargin: "Board margin", toolDiameter: "Tool diameter", spacingHint: "The minimum distance between parts equals the tool diameter.", sliceAndNest: "Slice & Nest", startStatus: "Import a file to get started.", previewTitle: "3D slice preview", previewHint: "Select a model to isolate from the list. Drag to rotate and use the wheel to zoom.", fitModel: "Fit model", viewerEmpty: "Import a file to display its 3D preview.", slices: "Slices", boards: "Boards", usage: "Usage", layoutTitle: "Board layout", layoutHint: "Use the wheel to zoom and drag to move the view. One DXF will be generated per board.", fitView: "Fit view", exportDxf: "Export DXFs", generatedSlices: "Generated slices", noSlices: "No slices calculated.", show3d: "Show in 3D view", normalAxis: "Normal axis", slice: "slice", board: "board", disabled: "disabled", selectSlice: "Select at least one slice to display the layout.", imported: "file(s) imported", trianglesLoaded: "triangles loaded.", importError: "Import error", invalidAscii: "invalid ASCII format", noFiniteCoordinates: "the file contains no finite coordinates", noIntersection: "no intersections found", sliceError: "Unable to slice", noSlicesSelected: "No slices selected.", invalidDimensions: "check the entered dimensions", invalidCoordinates: "the file contains no usable coordinates", marginTooLarge: "the margin exceeds the board dimensions", doesNotFit: "does not fit within the usable board area", cannotPlace: "unable to place", onNewBoard: "on a new board", panelLabel: "Board", metricSlices: "Slices", metricBoards: "Boards", metricUsage: "Usage", downloadFile: "slices-board" }
};
let language = "en";
const t = (key) => translations[language][key] ?? key;
function setLanguage(nextLanguage) { language = nextLanguage; document.documentElement.lang = language; document.querySelectorAll("[data-i18n]").forEach((node) => { node.textContent = t(node.dataset.i18n); }); document.querySelectorAll(".language-button").forEach((button) => button.classList.toggle("is-active", button.dataset.language === language)); if (!state.models.length) $("fileName").textContent = t("noFile"); renderModels(); if (state.result) { renderSlices(); renderMetrics(); drawNest(); } }
document.querySelectorAll(".language-button").forEach((button) => button.addEventListener("click", () => setLanguage(button.dataset.language)));

$("stlFile").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  if (!files.length) return;
  try {
    const imported = await Promise.all(files.map(async (file) => ({ id: state.nextModelId++, name: displayName(file.name), triangles: parseStl(await file.arrayBuffer()), axis: "z" })));
    state.models.push(...imported);
    if (state.previewModelId === null) state.previewModelId = imported[0].id;
    state.result = null;
    state.sourceSlices = [];
    state.disabledSlices.clear();
    $("fileName").textContent = `${state.models.length} ${t("imported")}`;
    $("sliceButton").disabled = !state.models.length;
    $("sliceResults").hidden = true;
    $("downloadButton").disabled = true;
    renderModels();
    showModelPreview();
    const triangleCount = imported.reduce((total, model) => total + model.triangles.length, 0);
    setStatus(`${imported.length} ${t("imported")}, ${triangleCount.toLocaleString(language === "fr" ? "fr-FR" : "en-US")} ${t("trianglesLoaded")}`);
    event.target.value = "";
  } catch (error) { setStatus(`${t("importError")}: ${error.message}`, true); }
});
$("sliceButton").addEventListener("click", sliceAndNest);
$("downloadButton").addEventListener("click", downloadDxf);
$("fitViewButton").addEventListener("click", () => state.viewer?.fit());
$("fitNestButton").addEventListener("click", () => { if (state.result) { fitNestView(); drawNest(); } });
$("thickness").addEventListener("input", refreshSlicePreview);
$("modelList").addEventListener("change", (event) => {
  if (event.target.matches(".model-preview")) {
    state.previewModelId = Number(event.target.value);
    updatePreviewVisibility();
    return;
  }
  if (!event.target.matches(".model-axis")) return;
  const model = state.models.find((item) => item.id === Number(event.target.dataset.modelId));
  if (model) { model.axis = event.target.value; refreshSlicePreview(); }
});
$("sliceList").addEventListener("change", (event) => {
  if (!event.target.matches(".slice-toggle")) return;
  const key = event.target.value;
  if (event.target.checked) state.disabledSlices.delete(key); else state.disabledSlices.add(key);
  recalculateNest();
});
installNestControls();

function parseStl(buffer) {
  const view = new DataView(buffer);
  const binaryCount = buffer.byteLength >= 84 ? view.getUint32(80, true) : -1;
  if (binaryCount >= 0 && 84 + binaryCount * 50 === buffer.byteLength) {
    const triangles = [];
    for (let offset = 84; offset < buffer.byteLength; offset += 50) {
      const points = [];
      for (let i = 0; i < 3; i++) points.push([view.getFloat32(offset + 12 + i * 12, true), view.getFloat32(offset + 16 + i * 12, true), view.getFloat32(offset + 20 + i * 12, true)]);
      if (points.every(isFinitePoint3)) triangles.push(points);
    }
    return triangles;
  }
  const text = new TextDecoder().decode(buffer);
  const vertices = [...text.matchAll(/vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/gi)].map((match) => [+match[1], +match[2], +match[3]]);
  if (!vertices.length || vertices.length % 3) throw new Error(t("invalidAscii"));
  const triangles = Array.from({ length: vertices.length / 3 }, (_, i) => vertices.slice(i * 3, i * 3 + 3)).filter((triangle) => triangle.every(isFinitePoint3));
  if (!triangles.length) throw new Error(t("noFiniteCoordinates"));
  return triangles;
}

function sliceAndNest() {
  try {
    const settings = settingsFromInputs();
    const slices = state.models.flatMap((model) => calculateSlices(model, settings.thickness).slices);
    if (!slices.length) throw new Error(t("noIntersection"));
    state.sourceSlices = slices;
    state.disabledSlices.clear();
    recalculateNest(settings);
    $("sliceResults").hidden = false;
    $("downloadButton").disabled = false;
  } catch (error) { setStatus(`${t("sliceError")}: ${error.message}`, true); }
}

function recalculateNest(settings = state.result?.settings) {
  const activeSlices = state.sourceSlices.filter((slice) => !state.disabledSlices.has(slice.key));
  if (!activeSlices.length) {
    state.result = { slices: [], boards: [], settings };
    drawNest(); renderSlices(); renderMetrics();
    setStatus(t("noSlicesSelected"));
    return;
  }
  const placed = nestSlices(activeSlices, settings);
  state.result = { slices: placed.slices, boards: placed.boards, settings };
  fitNestView();
  drawNest(); renderSlices(); renderMetrics();
  setStatus(`${activeSlices.length} ${t("slices").toLowerCase()} ${language === "fr" ? "répartie(s) sur" : "distributed across"} ${placed.boards.length} ${t("boards").toLowerCase()}.`);
}

function calculateSlices(model, thickness) {
  const basis = getBasis(model.axis);
  const localTriangles = model.triangles.map((triangle) => triangle.map((point) => project(point, basis)));
  const { min: minZ, max: maxZ } = coordinateRange(localTriangles, 2);
  const slices = [];
  // Start at the far model face. Offset imperceptibly inside the mesh so coplanar STL faces intersect reliably.
  const intersectionOffset = Math.min(1e-7, (maxZ - minZ) / 2);
  let number = 1;
  for (let plane = minZ; plane < maxZ - 1e-7; plane += thickness, number++) {
    const z = plane + intersectionOffset;
    const segments = localTriangles.map((triangle) => intersectionSegment(triangle, z)).filter(isFiniteSegment);
    if (!segments.length) continue;
    const bounds = segmentBounds(segments);
    if (bounds) slices.push({ key: `${model.id}:${number}`, modelId: model.id, modelName: model.name, number, z, segments, ...bounds });
  }
  return { basis, slices };
}

function showModelPreview() {
  const container = $("modelViewer");
  container.replaceChildren();
  const viewer = state.viewer = createViewer(container);
  state.models.forEach((item, index) => {
    const group = new THREE.Group();
    group.name = `model-${item.id}`;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(item.triangles.flat(2)), 3));
    geometry.computeVertexNormals();
    group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x6a747a, roughness: .82, metalness: 0, side: THREE.DoubleSide })));
    viewer.model.add(group);
  });
  refreshSlicePreview();
}

function createViewer(container) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 100000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xb8c0c4, 0x263137, .8));
  const key = new THREE.DirectionalLight(0xd5dde0, .9); key.position.set(1, 2, 3); scene.add(key);
  const model = new THREE.Group(), planes = new THREE.Group(); scene.add(model, planes);
  const viewer = { scene, camera, renderer, model, planes, center: new THREE.Vector3(), size: new THREE.Vector3(1, 1, 1), target: new THREE.Vector3(), azimuth: -.65, elevation: .45, distance: 100, dragging: false };
  viewer.fit = () => { const largest = Math.max(viewer.size.x, viewer.size.y, viewer.size.z, 1); viewer.distance = largest * 2.1; viewer.target.copy(viewer.center); renderViewer(viewer); };
  const resize = () => { const rect = container.getBoundingClientRect(); renderer.setSize(rect.width, rect.height, false); camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix(); renderViewer(viewer); };
  new ResizeObserver(resize).observe(container);
  let last;
  renderer.domElement.addEventListener("pointerdown", (event) => { viewer.dragging = true; last = [event.clientX, event.clientY]; renderer.domElement.setPointerCapture(event.pointerId); });
  renderer.domElement.addEventListener("pointermove", (event) => { if (!viewer.dragging) return; viewer.azimuth -= (event.clientX - last[0]) * .012; viewer.elevation = Math.max(-1.45, Math.min(1.45, viewer.elevation - (event.clientY - last[1]) * .012)); last = [event.clientX, event.clientY]; renderViewer(viewer); });
  renderer.domElement.addEventListener("pointerup", () => { viewer.dragging = false; });
  renderer.domElement.addEventListener("wheel", (event) => { event.preventDefault(); viewer.distance *= event.deltaY > 0 ? 1.12 : .89; const largest = Math.max(viewer.size.x, viewer.size.y, viewer.size.z, 1); viewer.distance = Math.max(largest * .15, Math.min(largest * 10, viewer.distance)); renderViewer(viewer); }, { passive: false });
  resize(); return viewer;
}

function renderViewer(viewer) {
  const horizontal = Math.cos(viewer.elevation) * viewer.distance;
  viewer.camera.position.set(viewer.target.x + horizontal * Math.sin(viewer.azimuth), viewer.target.y + Math.sin(viewer.elevation) * viewer.distance, viewer.target.z + horizontal * Math.cos(viewer.azimuth));
  viewer.camera.lookAt(viewer.target); viewer.renderer.render(viewer.scene, viewer.camera);
}

function refreshSlicePreview() {
  if (!state.viewer || !state.models.length) return;
  const viewer = state.viewer;
  viewer.planes.clear();
  try {
    const thickness = Number($("thickness").value);
    if (!(thickness > 0)) return;
    state.models.forEach((model) => addSlicePlanes(viewer, model, thickness));
    updatePreviewVisibility();
  } catch { /* The form may be temporarily incomplete while the user is editing. */ }
}
function addSlicePlanes(viewer, model, thickness) {
  const basis = getBasis(model.axis);
  const localTriangles = model.triangles.map((triangle) => triangle.map((point) => project(point, basis)));
  const { min: minZ, max: maxZ } = coordinateRange(localTriangles, 2);
  const planes = slicePlanePositions(minZ, maxZ, thickness, true);
  const count = planes.length;
  const displayEvery = Math.max(1, Math.ceil(count / 80));
  const planeGroup = new THREE.Group();
  planeGroup.name = `planes-${model.id}`;
  for (let index = 0; index < count; index += displayEvery) {
    const z = planes[index];
    const segments = localTriangles.map((triangle) => intersectionSegment(triangle, z)).filter(isFiniteSegment);
    if (!segments.length) continue;
    const points = segments.flatMap(([start, end]) => [
      localToWorld(start, z, basis),
      localToWorld(end, z, basis)
    ]);
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(...point)));
    planeGroup.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x00d8e8, transparent: true, opacity: .95, depthTest: true })));
  }
  viewer.planes.add(planeGroup);
}

function updatePreviewVisibility() {
  const viewer = state.viewer;
  if (!viewer || state.previewModelId === null) return;
  const modelGroup = viewer.model.getObjectByName(`model-${state.previewModelId}`);
  viewer.model.children.forEach((group) => { group.visible = group === modelGroup; });
  const planeGroup = viewer.planes.getObjectByName(`planes-${state.previewModelId}`);
  viewer.planes.children.forEach((group) => { group.visible = group === planeGroup; });
  if (!modelGroup) return;
  const box = new THREE.Box3().setFromObject(modelGroup);
  viewer.center.copy(box.getCenter(new THREE.Vector3()));
  viewer.size.copy(box.getSize(new THREE.Vector3()));
  viewer.fit();
}

function settingsFromInputs() {
  const get = (id) => Number($(id).value);
  const settings = { width: get("boardWidth"), height: get("boardHeight"), thickness: get("thickness"), margin: get("margin"), tool: get("toolDiameter") };
  if (Object.values(settings).some((value) => !Number.isFinite(value)) || settings.width <= 0 || settings.height <= 0 || settings.thickness <= 0 || settings.margin < 0 || settings.tool < 0) throw new Error(t("invalidDimensions"));
  return settings;
}

function getBasis(axis) {
  const normal = axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];
  const origin = [0, 0, 0];
  const helper = Math.abs(normal[2]) < .9 ? [0, 0, 1] : [0, 1, 0];
  const u = normalize(cross(helper, normal)), v = cross(normal, u);
  return { origin, u, v, normal };
}
function coordinateRange(triangles, coordinate) {
  let min = Infinity, max = -Infinity;
  for (const triangle of triangles) for (const point of triangle) {
    const value = point[coordinate];
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error(t("invalidCoordinates"));
  return { min, max };
}
function slicePlanePositions(min, max, thickness, includeTerminal = false) {
  const planes = [];
  for (let z = min; z < max - 1e-7; z += thickness) planes.push(z);
  if (includeTerminal && (!planes.length || max - planes.at(-1) > 1e-7)) planes.push(max);
  return planes;
}
function project(point, basis) { const d = sub(point, basis.origin); return [dot(d, basis.u), dot(d, basis.v), dot(d, basis.normal)]; }
function localToWorld(point, z, basis) { return add(add(add(basis.origin, scale(basis.u, point[0])), scale(basis.v, point[1])), scale(basis.normal, z)); }
function intersectionSegment(triangle, z) {
  if (!triangle.every((point) => point.every(Number.isFinite)) || !Number.isFinite(z)) return null;
  const points = [];
  for (let i = 0; i < 3; i++) {
    const a = triangle[i], b = triangle[(i + 1) % 3], da = a[2] - z, db = b[2] - z;
    if (Math.abs(da) < 1e-8 && Math.abs(db) < 1e-8) continue;
    if (Math.abs(da) < 1e-8) points.push([a[0], a[1]]);
    else if (da * db < 0) { const t = da / (da - db); points.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
  }
  const unique = points.filter((point) => point.every(Number.isFinite)).filter((p, i, validPoints) => !validPoints.slice(0, i).some((q) => distance(p, q) < 1e-6));
  return unique.length === 2 ? unique : null;
}
function segmentBounds(segments) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const segment of segments) for (const point of segment) {
    if (!point.every(Number.isFinite)) continue;
    minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
  }
  const bounds = { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
  return Object.values(bounds).every(Number.isFinite) ? bounds : null;
}

function nestSlices(slices, s) {
  const gap = s.tool, usableW = s.width - 2 * s.margin, usableH = s.height - 2 * s.margin, tolerance = 1e-6;
  if (usableW <= 0 || usableH <= 0) throw new Error(t("marginTooLarge"));
  const fits = (w, h) => w <= usableW + tolerance && h <= usableH + tolerance;
  const sliceLabel = (slice) => `${slice.modelName} · ${t("slice")} ${slice.number}`;
  const sliceTooLarge = (slice) => `${sliceLabel(slice)} (${slice.width.toFixed(1)} x ${slice.height.toFixed(1)} mm) ${t("doesNotFit")} (${usableW.toFixed(1)} x ${usableH.toFixed(1)} mm)`;
  const sorted = [...slices].sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height));
  const boards = [];
  for (const slice of sorted) {
    const variants = [{ rotated: false, w: slice.width, h: slice.height }, { rotated: true, w: slice.height, h: slice.width }].filter((v, i, arr) => i === 0 || v.w !== arr[0].w || v.h !== arr[0].h);
    if (variants.every((v) => !fits(v.w, v.h))) throw new Error(sliceTooLarge(slice));
    let choice;
    for (const board of boards) for (const variant of variants) { const pos = board.find(variant.w, variant.h, gap); if (pos && (!choice || pos.y < choice.pos.y || (pos.y === choice.pos.y && pos.x < choice.pos.x))) choice = { board, variant, pos }; }
    if (!choice) {
      const board = new ShelfBoard(usableW, usableH);
      const variant = variants.find((v) => fits(v.w, v.h));
      if (!variant) throw new Error(sliceTooLarge(slice));
      const pos = board.find(variant.w, variant.h, gap);
      if (!pos) throw new Error(`${t("cannotPlace")} ${sliceLabel(slice)} ${t("onNewBoard")}`);
      boards.push(board);
      choice = { board, variant, pos };
    }
    choice.board.add(choice.pos, choice.variant.w, choice.variant.h, gap);
    Object.assign(slice, { board: boards.indexOf(choice.board), x: choice.pos.x + s.margin, y: choice.pos.y + s.margin, rotated: choice.variant.rotated });
  }
  return { slices: sorted, boards };
}
class ShelfBoard { constructor(w, h) { this.w = w; this.h = h; this.shelves = []; } find(w, h, gap) { const tolerance = 1e-6; for (const shelf of this.shelves) if (h <= shelf.h + tolerance && shelf.x + w <= this.w + tolerance) return { x: shelf.x, y: shelf.y, shelf }; const y = this.shelves.length ? this.shelves.at(-1).y + this.shelves.at(-1).h + gap : 0; return y + h <= this.h + tolerance ? { x: 0, y, shelf: null } : null; } add(pos, w, h, gap) { if (pos.shelf) pos.shelf.x += w + gap; else this.shelves.push({ y: pos.y, h, x: w + gap }); } }

function nestLayout() {
  const { boards, settings } = state.result, cols = Math.max(1, Math.min(boards.length, 2)), gap = Math.max(80, settings.margin * 4), rows = Math.max(1, Math.ceil(boards.length / cols));
  return { cols, gap, width: cols * settings.width + Math.max(0, cols - 1) * gap, height: rows * settings.height + Math.max(0, rows - 1) * gap, origin: (index) => [index % cols * (settings.width + gap), Math.floor(index / cols) * (settings.height + gap)] };
}
function fitNestView() {
  const layout = nestLayout(), padding = 48, scale = Math.min((canvas.width - padding * 2) / layout.width, (canvas.height - padding * 2) / layout.height);
  state.nestView = { scale, x: (canvas.width - layout.width * scale) / 2, y: (canvas.height - layout.height * scale) / 2 };
}
function drawNest() {
  if (!state.result) return;
  const { boards, slices, settings } = state.result, layout = nestLayout(), view = state.nestView || (fitNestView(), state.nestView);
  const point = (x, y) => [view.x + x * view.scale, view.y + (layout.height - y) * view.scale];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f4f6f3"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!boards.length) { ctx.fillStyle = "#68747b"; ctx.font = "14px system-ui"; ctx.textAlign = "center"; ctx.fillText(t("selectSlice"), canvas.width / 2, canvas.height / 2); ctx.textAlign = "start"; return; }
  boards.forEach((board, index) => {
    const [ox, oy] = layout.origin(index), [left, top] = point(ox, oy + settings.height), boardW = settings.width * view.scale, boardH = settings.height * view.scale;
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "#48605c"; ctx.lineWidth = 1; ctx.fillRect(left, top, boardW, boardH); ctx.strokeRect(left, top, boardW, boardH);
    ctx.fillStyle = "#40504e"; ctx.font = "600 12px system-ui"; ctx.fillText(`${t("panelLabel")} ${index + 1}`, left + 8, top + 17);
  });
  ctx.strokeStyle = "#c23d24"; ctx.lineWidth = Math.max(.75, Math.min(2, view.scale * .45)); ctx.lineJoin = "round"; ctx.lineCap = "round";
  slices.forEach((slice) => {
    const [ox, oy] = layout.origin(slice.board);
    ctx.beginPath();
    slice.segments.forEach(([a, b]) => {
      const transform = (p) => slice.rotated ? [ox + slice.x + (p[1] - slice.minY), oy + slice.y + slice.width - (p[0] - slice.minX)] : [ox + slice.x + p[0] - slice.minX, oy + slice.y + p[1] - slice.minY];
      const pa = transform(a), pb = transform(b), [ax, ay] = point(...pa), [bx, by] = point(...pb);
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    });
    ctx.stroke();
    const sliceWidth = slice.rotated ? slice.height : slice.width, sliceHeight = slice.rotated ? slice.width : slice.height;
    const [labelX, labelY] = point(ox + slice.x + sliceWidth / 2, oy + slice.y + sliceHeight / 2);
    const radius = 11;
    ctx.fillStyle = "#16232c"; ctx.beginPath(); ctx.arc(labelX, labelY, radius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "700 11px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(slice.number, labelX, labelY + .5); ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
  });
}
function installNestControls() {
  let drag = null;
  const position = (event) => { const rect = canvas.getBoundingClientRect(); return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height]; };
  canvas.addEventListener("wheel", (event) => {
    if (!state.result) return;
    event.preventDefault();
    const [x, y] = position(event), view = state.nestView, factor = event.deltaY < 0 ? 1.18 : 1 / 1.18, nextScale = Math.max(.02, Math.min(20, view.scale * factor));
    view.x = x - (x - view.x) * nextScale / view.scale; view.y = y - (y - view.y) * nextScale / view.scale; view.scale = nextScale; drawNest();
  }, { passive: false });
  canvas.addEventListener("pointerdown", (event) => { if (!state.result) return; const [x, y] = position(event); drag = { x, y, viewX: state.nestView.x, viewY: state.nestView.y }; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener("pointermove", (event) => { if (!drag) return; const [x, y] = position(event); state.nestView.x = drag.viewX + x - drag.x; state.nestView.y = drag.viewY + y - drag.y; drawNest(); });
  canvas.addEventListener("pointerup", () => { drag = null; });
}
function renderModels() { $("modelList").innerHTML = state.models.map((model) => `<article class="model-card"><strong>${escapeHtml(model.name)}</strong><label class="model-preview-label"><input class="model-preview" type="radio" name="previewModel" value="${model.id}" ${model.id === state.previewModelId ? "checked" : ""} />${t("show3d")}</label><label>${t("normalAxis")}<select class="model-axis" data-model-id="${model.id}"><option value="z" ${model.axis === "z" ? "selected" : ""}>XY · normal Z</option><option value="y" ${model.axis === "y" ? "selected" : ""}>XZ · normal Y</option><option value="x" ${model.axis === "x" ? "selected" : ""}>YZ · normal X</option></select></label></article>`).join(""); }
function renderSlices() { $("sliceList").innerHTML = state.sourceSlices.map((slice) => { const active = !state.disabledSlices.has(slice.key), placed = state.result.slices.find((item) => item.key === slice.key); return `<article class="slice-card${active ? "" : " is-disabled"}"><label><input class="slice-toggle" type="checkbox" value="${slice.key}" ${active ? "checked" : ""} /><strong>${escapeHtml(slice.modelName)} · ${t("slice")} ${slice.number}</strong></label><span>${slice.width.toFixed(1)} x ${slice.height.toFixed(1)} mm${placed ? ` · ${t("board")} ${placed.board + 1}` : ` · ${t("disabled")}`}</span></article>`; }).join(""); }
function renderMetrics() { const { slices, boards, settings } = state.result, used = slices.reduce((sum, slice) => sum + slice.width * slice.height, 0), total = boards.length * settings.width * settings.height; $("metrics").innerHTML = `<div><span>${t("metricSlices")}</span><strong>${slices.length}</strong></div><div><span>${t("metricBoards")}</span><strong>${boards.length}</strong></div><div><span>${t("metricUsage")}</span><strong>${total ? (used / total * 100).toFixed(1) : "-"}%</strong></div>`; }
function downloadDxf() {
  const { slices, boards } = state.result;
  boards.forEach((_, boardIndex) => {
    const lines = ["0", "SECTION", "2", "HEADER", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"];
    slices.filter((slice) => slice.board === boardIndex).forEach((slice) => {
      for (const [a, b] of slice.segments) {
        const transform = (p) => {
          const x = p[0] - slice.minX, y = p[1] - slice.minY;
          return slice.rotated ? [slice.x + y, slice.y + slice.width - x] : [slice.x + x, slice.y + y];
        };
        const p1 = transform(a), p2 = transform(b);
        lines.push("0", "LINE", "8", `MODEL_${slice.modelId}_SLICE_${slice.number}`, "10", p1[0].toFixed(4), "20", p1[1].toFixed(4), "30", "0", "11", p2[0].toFixed(4), "21", p2[1].toFixed(4), "31", "0");
      }
    });
    lines.push("0", "ENDSEC", "0", "EOF");
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "application/dxf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${t("downloadFile")}-${boardIndex + 1}.dxf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
}
function setStatus(text, error = false) { const node = $("status"); node.textContent = text; node.style.color = error ? "#b83a20" : ""; }
const isFinitePoint3 = (point) => point.length === 3 && point.every(Number.isFinite); const isFiniteSegment = (segment) => Array.isArray(segment) && segment.length === 2 && segment.every((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)); const sub = (a, b) => a.map((n, i) => n - b[i]); const add = (a, b) => a.map((n, i) => n + b[i]); const scale = (v, factor) => v.map((n) => n * factor); const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0); const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; const normalize = (v) => { const length = Math.hypot(...v); return length && Number.isFinite(length) ? v.map((n) => n / length) : null; }; const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function escapeHtml(value) { const node = document.createElement("span"); node.textContent = value; return node.innerHTML; }
function displayName(fileName) { return fileName.replace(/\.stl$/i, ""); }
