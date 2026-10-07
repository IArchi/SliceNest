"use strict";

const $ = (id) => document.getElementById(id);
const state = { triangles: [], mode: "axis", result: null, viewer: null };
const canvas = $("nestCanvas"), ctx = canvas.getContext("2d");

document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
  state.mode = button.dataset.mode;
  document.querySelectorAll("[data-mode]").forEach((item) => item.classList.toggle("active", item === button));
  $("axisFields").hidden = state.mode !== "axis";
  $("freeFields").hidden = state.mode !== "free";
  refreshSlicePreview();
}));

$("stlFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    state.triangles = parseStl(await file.arrayBuffer());
    $("fileName").textContent = file.name;
    $("sliceButton").disabled = !state.triangles.length;
    showModelPreview();
    setStatus(`${state.triangles.length.toLocaleString("fr-FR")} triangles chargés.`);
  } catch (error) { setStatus(`Erreur STL : ${error.message}`, true); }
});
$("sliceButton").addEventListener("click", sliceAndNest);
$("downloadButton").addEventListener("click", downloadDxf);
$("fitViewButton").addEventListener("click", () => state.viewer?.fit());
document.querySelectorAll("#sliceAxis, #pointX, #pointY, #pointZ, #normalX, #normalY, #normalZ, #thickness").forEach((input) => input.addEventListener("input", refreshSlicePreview));

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
  if (!vertices.length || vertices.length % 3) throw new Error("format ASCII non valide");
  const triangles = Array.from({ length: vertices.length / 3 }, (_, i) => vertices.slice(i * 3, i * 3 + 3)).filter((triangle) => triangle.every(isFinitePoint3));
  if (!triangles.length) throw new Error("le STL ne contient aucune coordonnée finie");
  return triangles;
}

function sliceAndNest() {
  try {
    const settings = settingsFromInputs();
    const { slices } = calculateSlices(settings.thickness);
    if (!slices.length) throw new Error("aucune intersection n'a été trouvée");
    const placed = nestSlices(slices, settings);
    state.result = { slices: placed.slices, boards: placed.boards, settings };
    drawNest(); renderSlices(); renderMetrics();
    $("downloadButton").disabled = false;
    setStatus(`${slices.length} tranches réparties sur ${placed.boards.length} panneau(x).`);
  } catch (error) { setStatus(`Impossible de découper : ${error.message}`, true); }
}

function calculateSlices(thickness) {
  const basis = getBasis();
  const localTriangles = state.triangles.map((triangle) => triangle.map((point) => project(point, basis)));
  const values = localTriangles.flat().map((point) => point[2]);
  const minZ = Math.min(...values), maxZ = Math.max(...values);
  const slices = [];
  // Slice centers are aligned to the reference plane (local z = 0), including for a free plane.
  const firstCenter = Math.ceil((minZ - thickness / 2) / thickness) * thickness + thickness / 2;
  for (let z = firstCenter, number = 1; z < maxZ + 1e-7; z += thickness, number++) {
    const segments = localTriangles.map((triangle) => intersectionSegment(triangle, z)).filter(isFiniteSegment);
    if (!segments.length) continue;
    const bounds = segmentBounds(segments);
    if (bounds) slices.push({ number, z, segments, ...bounds });
  }
  return { basis, slices };
}

function showModelPreview() {
  const container = $("modelViewer");
  container.replaceChildren();
  const viewer = state.viewer = createViewer(container);
  const positions = new Float32Array(state.triangles.flat(2));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x168b84, transparent: true, opacity: .31, side: THREE.DoubleSide, depthWrite: false }));
  viewer.model.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), new THREE.LineBasicMaterial({ color: 0x105752, transparent: true, opacity: .33 }));
  viewer.model.add(edges);
  const box = new THREE.Box3().setFromObject(viewer.model);
  viewer.center.copy(box.getCenter(new THREE.Vector3()));
  viewer.size.copy(box.getSize(new THREE.Vector3()));
  viewer.fit();
  refreshSlicePreview();
}

function createViewer(container) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 100000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x345b56, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.3); key.position.set(1, 2, 3); scene.add(key);
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
  if (!state.viewer || !state.triangles.length) return;
  const viewer = state.viewer;
  viewer.planes.clear();
  try {
    const thickness = Number($("thickness").value);
    if (!(thickness > 0)) return;
    const basis = getBasis();
    const localTriangles = state.triangles.map((triangle) => triangle.map((point) => project(point, basis)));
    const values = localTriangles.flat().map((point) => point[2]);
    const minZ = Math.min(...values), maxZ = Math.max(...values);
    const firstCenter = Math.ceil((minZ - thickness / 2) / thickness) * thickness + thickness / 2;
    const count = Math.max(0, Math.floor((maxZ - firstCenter) / thickness) + 1);
    const displayEvery = Math.max(1, Math.ceil(count / 80));
    const extent = Math.hypot(viewer.size.x, viewer.size.y, viewer.size.z) * 1.08;
    const normal = new THREE.Vector3(...basis.normal);
    const planeGeometry = new THREE.PlaneGeometry(extent, extent);
    const material = new THREE.MeshBasicMaterial({ color: 0xf25a38, transparent: true, opacity: .11, side: THREE.DoubleSide, depthWrite: false });
    const outlineGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-extent / 2, -extent / 2, 0), new THREE.Vector3(extent / 2, -extent / 2, 0), new THREE.Vector3(extent / 2, extent / 2, 0), new THREE.Vector3(-extent / 2, extent / 2, 0), new THREE.Vector3(-extent / 2, -extent / 2, 0)]);
    for (let index = 0; index < count; index += displayEvery) {
      const z = firstCenter + index * thickness, position = add(basis.origin, scale(basis.normal, z));
      const group = new THREE.Group();
      group.position.set(...position);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      group.add(new THREE.Mesh(planeGeometry, material));
      group.add(new THREE.Line(outlineGeometry, new THREE.LineBasicMaterial({ color: 0xe14b2b, transparent: true, opacity: .45 })));
      viewer.planes.add(group);
    }
    renderViewer(viewer);
  } catch { /* The form may be temporarily incomplete while the user is editing. */ }
}

function settingsFromInputs() {
  const get = (id) => Number($(id).value);
  const settings = { width: get("boardWidth"), height: get("boardHeight"), thickness: get("thickness"), margin: get("margin"), tool: get("toolDiameter") };
  if (Object.values(settings).some((value) => !Number.isFinite(value)) || settings.width <= 0 || settings.height <= 0 || settings.thickness <= 0 || settings.margin < 0 || settings.tool < 0) throw new Error("vérifiez les dimensions saisies");
  return settings;
}

function getBasis() {
  let normal;
  if (state.mode === "axis") {
    const axis = $("sliceAxis").value;
    normal = axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];
  } else normal = [Number($("normalX").value), Number($("normalY").value), Number($("normalZ").value)];
  normal = normalize(normal);
  if (!normal) throw new Error("la normale du plan libre ne peut pas être nulle");
  const origin = state.mode === "free" ? [Number($("pointX").value), Number($("pointY").value), Number($("pointZ").value)] : [0, 0, 0];
  if (!origin.every(Number.isFinite)) throw new Error("le point du plan libre doit contenir des valeurs numériques");
  const helper = Math.abs(normal[2]) < .9 ? [0, 0, 1] : [0, 1, 0];
  const u = normalize(cross(helper, normal)), v = cross(normal, u);
  return { origin, u, v, normal };
}
function project(point, basis) { const d = sub(point, basis.origin); return [dot(d, basis.u), dot(d, basis.v), dot(d, basis.normal)]; }
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
function segmentBounds(segments) { const points = segments.flat().filter((point) => point.every(Number.isFinite)); if (!points.length) return null; const minX = Math.min(...points.map((p) => p[0])), maxX = Math.max(...points.map((p) => p[0])), minY = Math.min(...points.map((p) => p[1])), maxY = Math.max(...points.map((p) => p[1])); const bounds = { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY }; return Object.values(bounds).every(Number.isFinite) ? bounds : null; }

function nestSlices(slices, s) {
  const gap = s.tool, usableW = s.width - 2 * s.margin, usableH = s.height - 2 * s.margin, tolerance = 1e-6;
  if (usableW <= 0 || usableH <= 0) throw new Error("la marge dépasse les dimensions du panneau");
  const fits = (w, h) => w <= usableW + tolerance && h <= usableH + tolerance;
  const sliceTooLarge = (slice) => `la tranche ${slice.number} (${slice.width.toFixed(1)} x ${slice.height.toFixed(1)} mm) ne tient pas dans la zone utile du panneau (${usableW.toFixed(1)} x ${usableH.toFixed(1)} mm)`;
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
      if (!pos) throw new Error(`impossible de placer la tranche ${slice.number} sur un nouveau panneau`);
      boards.push(board);
      choice = { board, variant, pos };
    }
    choice.board.add(choice.pos, choice.variant.w, choice.variant.h, gap);
    Object.assign(slice, { board: boards.indexOf(choice.board), x: choice.pos.x + s.margin, y: choice.pos.y + s.margin, rotated: choice.variant.rotated });
  }
  return { slices: sorted, boards };
}
class ShelfBoard { constructor(w, h) { this.w = w; this.h = h; this.shelves = []; } find(w, h, gap) { const tolerance = 1e-6; for (const shelf of this.shelves) if (h <= shelf.h + tolerance && shelf.x + w <= this.w + tolerance) return { x: shelf.x, y: shelf.y, shelf }; const y = this.shelves.length ? this.shelves.at(-1).y + this.shelves.at(-1).h + gap : 0; return y + h <= this.h + tolerance ? { x: 0, y, shelf: null } : null; } add(pos, w, h, gap) { if (pos.shelf) pos.shelf.x += w + gap; else this.shelves.push({ y: pos.y, h, x: w + gap }); } }

function drawNest() {
  const { boards, slices, settings } = state.result, pad = 30, cols = Math.min(boards.length, 3), scale = Math.min((canvas.width - pad * (cols + 1)) / (cols * settings.width), 220 / settings.height), boardH = settings.height * scale, rows = Math.ceil(boards.length / cols);
  canvas.height = Math.max(300, Math.ceil(rows * (boardH + 60) + 25)); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.font = "12px system-ui";
  boards.forEach((board, index) => { const bx = pad + (index % cols) * (settings.width * scale + pad), by = 25 + Math.floor(index / cols) * (boardH + 60); ctx.fillStyle = "#fff"; ctx.strokeStyle = "#48605c"; ctx.lineWidth = 1; ctx.fillRect(bx, by, settings.width * scale, boardH); ctx.strokeRect(bx, by, settings.width * scale, boardH); ctx.fillStyle = "#40504e"; ctx.fillText(`Panneau ${index + 1}`, bx, by - 8); slices.filter((slice) => slice.board === index).forEach((slice) => { const x = bx + slice.x * scale, y = by + (settings.height - slice.y - (slice.rotated ? slice.width : slice.height)) * scale, w = (slice.rotated ? slice.height : slice.width) * scale, h = (slice.rotated ? slice.width : slice.height) * scale; ctx.fillStyle = "#e95332"; ctx.globalAlpha = .83; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; ctx.fillStyle = "#fff"; ctx.fillText(`#${slice.number}`, x + 5, y + 15); }); });
}
function renderSlices() { $("sliceList").innerHTML = state.result.slices.map((slice) => `<article class="slice-card"><strong>Tranche ${slice.number}</strong><span>${slice.width.toFixed(1)} x ${slice.height.toFixed(1)} mm · panneau ${slice.board + 1}</span></article>`).join(""); }
function renderMetrics() { const { slices, boards, settings } = state.result, used = slices.reduce((sum, slice) => sum + slice.width * slice.height, 0), total = boards.length * settings.width * settings.height; $("metrics").innerHTML = `<div><span>Tranches</span><strong>${slices.length}</strong></div><div><span>Panneaux</span><strong>${boards.length}</strong></div><div><span>Utilisation</span><strong>${(used / total * 100).toFixed(1)}%</strong></div>`; }
function downloadDxf() { const { slices, settings } = state.result; const lines = ["0","SECTION","2","HEADER","0","ENDSEC","0","SECTION","2","ENTITIES"]; for (const slice of slices) for (const [a, b] of slice.segments) { const transform = (p) => { const x = p[0] - slice.minX, y = p[1] - slice.minY; return slice.rotated ? [slice.x + y, slice.y + slice.width - x] : [slice.x + x, slice.y + y]; }; const p1 = transform(a), p2 = transform(b); lines.push("0","LINE","8",`SLICE_${slice.number}`,"10",p1[0].toFixed(4),"20",p1[1].toFixed(4),"30","0","11",p2[0].toFixed(4),"21",p2[1].toFixed(4),"31","0"); } lines.push("0","ENDSEC","0","EOF"); const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "application/dxf" })); const link = document.createElement("a"); link.href = url; link.download = "slices-nested.dxf"; link.click(); URL.revokeObjectURL(url); }
function setStatus(text, error = false) { const node = $("status"); node.textContent = text; node.style.color = error ? "#b83a20" : ""; }
const isFinitePoint3 = (point) => point.length === 3 && point.every(Number.isFinite); const isFiniteSegment = (segment) => Array.isArray(segment) && segment.length === 2 && segment.every((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)); const sub = (a, b) => a.map((n, i) => n - b[i]); const add = (a, b) => a.map((n, i) => n + b[i]); const scale = (v, factor) => v.map((n) => n * factor); const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0); const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; const normalize = (v) => { const length = Math.hypot(...v); return length && Number.isFinite(length) ? v.map((n) => n / length) : null; }; const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
