import {
  boundsOf,
  buildGraph,
  buildHitGrid,
  expandEverythingUnder,
  expandedIdsToReveal,
  fitView,
  hitTest,
  layoutGraph,
  sanitizeExport,
  searchDoors,
  statusCountsOf,
  STATUS_ORDER,
  visibleNodeIds,
} from "./graph.mjs";

/**
 * The Security map page in the browser: reads the data embedded at build time, draws the map on two canvases
 * and fills the panels. Every string from the data goes in through textContent or canvas fillText, and the
 * page makes no network call. The rules it follows are in the security-map skill's Page section.
 */

const STORAGE_KEY = "security-map-panels";
const STATUS_NAMES = { unexplored: "Unexplored", robust: "Robust", weak: "Weak", fixed: "Fixed", stale: "Stale" };
const EVIDENCE_NAMES = { test: "Test", ship_check: "Ship check", probe: "Probe" };
const NODE_KIND_NAMES = { root: "Map", sector: "Sector", door_kind: "Door kinds", door: "Door", case: "Case" };
const MAX_LABEL_COUNT = 400;
const MAX_GLOW_COUNT = 1500;
const LIST_ITEM_LIMIT = 100;
const MIN_SCALE_FACTOR = 0.6;
const MAX_SCALE = 6;

const byId = (id) => document.getElementById(id);
const app = byId("app");

/** Builds an element; every string goes in as text, never as markup. */
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}
const clear = (node) => node.replaceChildren();

function readStorage() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}
function writeStorage(partial) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStorage(), ...partial }));
  } catch {
    // The page works the same without it.
  }
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function relativeTime(iso) {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const steps = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of steps) if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  return relativeFormat.format(Math.round(seconds), "second");
}
const timeText = (iso) => (iso ? `${dateFormat.format(new Date(iso))} (${relativeTime(iso)})` : "unknown");

// ---------------------------------------------------------------- load

const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();
const COLORS = Object.fromEntries(["--bg", "--node", "--panel", "--panel-line", "--line", "--grid", "--grid-major", "--ring", "--fg", "--fg-2", "--muted", "--accent", "--accent-bright", "--focus", "--unexplored", "--robust", "--weak", "--hole", "--stale", "--fixed", "--mono"].map((name) => [name.slice(2), color(name)]));
const statusColor = (status) => COLORS[status] ?? COLORS.unexplored;
const MONO = COLORS.mono || "monospace";

const staticCanvas = byId("static-layer");
const overlayCanvas = byId("overlay-layer");
const canvasWrap = byId("canvas-wrap");
const staticContext = staticCanvas.getContext("2d");
const overlayContext = overlayCanvas.getContext("2d");

const state = {
  exportData: null,
  problems: [],
  graph: null,
  expandedIds: new Set(),
  layout: null,
  visibleIds: new Set(),
  visibleNodes: [],
  visibleChildCountById: new Map(),
  drawPositions: null,
  hitGrid: null,
  view: { scale: 1, offsetX: 0, offsetY: 0 },
  fitScale: 0.1,
  widthPx: 0,
  heightPx: 0,
  dpr: 1,
  selectedId: null,
  hoverId: null,
  pointer: { x: 0, y: 0 },
  panelMode: "none",
  listKind: null,
  isTextViewOn: false,
  layoutTween: null,
  viewTween: null,
  hasPulse: false,
  isStaticDirty: true,
  isOverlayDirty: true,
  frameHandle: 0,
  lastPulseFrameAt: 0,
  isReducedMotion: false,
  hasFitted: false,
};

let glowSprites = null;

function setState(name, message) {
  app.dataset.state = name;
  if (message !== undefined) byId("state-broken").textContent = message;
}

function load() {
  let raw;
  try {
    raw = JSON.parse(byId("map-data").textContent);
  } catch (error) {
    return setState("broken", `The map data didn't load: ${error instanceof Error ? error.message : "it isn't valid JSON"}.`);
  }
  const { exportData, problems } = sanitizeExport(raw);
  state.exportData = exportData;
  state.problems = problems;
  state.graph = buildGraph(exportData);
  state.isReducedMotion = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  buildTopBar();
  buildStrip();
  buildSectorPanel();
  buildLegend();
  buildTextView();
  if (exportData.sectors.length === 0) return setState("empty");
  if (!staticContext || !overlayContext) {
    state.isTextViewOn = true;
    renderTextViewState();
    return setState("text");
  }
  setState("ready");
  window.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener?.("change", (event) => {
    state.isReducedMotion = event.matches;
    updatePulseFlag();
    markDirty(true, true);
  });
  new ResizeObserver(() => resize()).observe(canvasWrap);
  resize(true);
  applyLayout(false);
  attachInteraction();
  const initialRect = canvasWrap.getBoundingClientRect();
  if (initialRect.width >= 100 && initialRect.height >= 100) {
    state.hasFitted = true;
    restorePanels();
  }
  markDirty(true, true);
}

// ---------------------------------------------------------------- layout and view

function updateVisibleCounts() {
  state.visibleChildCountById = new Map();
  for (const node of state.visibleNodes) {
    if (!node.parentId) continue;
    state.visibleChildCountById.set(node.parentId, (state.visibleChildCountById.get(node.parentId) ?? 0) + 1);
  }
}

function updatePulseFlag() {
  state.hasPulse = state.exportData.sectors.some((sector) => holeCountOf(sector) > 0) || state.visibleNodes.some((node) => (node.nodeKind === "door" || node.nodeKind === "case") && node.status === "stale");
}

/** Lays the visible tree out again; the nodes slide from where they were (new ones from their parent) unless `animate` is false. */
function applyLayout(animate) {
  const previous = state.drawPositions;
  const layout = layoutGraph(state.graph, state.expandedIds);
  state.layout = layout;
  state.visibleIds = visibleNodeIds(state.graph, state.expandedIds);
  state.visibleNodes = [...state.visibleIds].map((nodeId) => state.graph.nodesById.get(nodeId));
  state.hitGrid = buildHitGrid(layout.positionsById, state.visibleIds);
  updateVisibleCounts();
  updatePulseFlag();
  app.dataset.visibleNodeCount = String(state.visibleIds.size);
  state.fitScale = fitView(layout.bounds, Math.max(1, state.widthPx), Math.max(1, state.heightPx)).scale;
  if (animate && previous && !state.isReducedMotion) {
    const from = new Map();
    for (const [nodeId, target] of layout.positionsById) {
      const before = previous.get(nodeId) ?? previous.get(state.graph.nodesById.get(nodeId).parentId) ?? target;
      from.set(nodeId, { x: before.x, y: before.y });
    }
    state.layoutTween = { startAt: performance.now(), durationMs: 280, from };
    state.drawPositions = interpolatedPositions(0);
  } else {
    state.layoutTween = null;
    state.drawPositions = layout.positionsById;
  }
  markDirty(true, true);
}

const easeOutCubic = (t) => 1 - (1 - t) ** 3;

function interpolatedPositions(progress) {
  const eased = easeOutCubic(progress);
  const positions = new Map();
  for (const [nodeId, target] of state.layout.positionsById) {
    const from = state.layoutTween.from.get(nodeId);
    positions.set(nodeId, { ...target, x: from.x + (target.x - from.x) * eased, y: from.y + (target.y - from.y) * eased });
  }
  return positions;
}

function panelInsets() {
  const isWide = state.widthPx >= 900;
  const top = byId("strip").getBoundingClientRect().bottom + 8;
  const left = isWide && !byId("sector-panel").hidden ? byId("sector-panel").getBoundingClientRect().right + 8 : 0;
  const right = isWide && state.panelMode !== "none" ? state.widthPx - (state.panelMode === "list" ? byId("list-panel") : byId("drawer")).getBoundingClientRect().left + 8 : 0;
  return { top, left, right };
}

function fitBoundsInView(bounds) {
  const insets = panelInsets();
  const width = Math.max(120, state.widthPx - insets.left - insets.right);
  const height = Math.max(120, state.heightPx - insets.top);
  const fitted = fitView(bounds, width, height, 24);
  return { scale: fitted.scale, offsetX: fitted.offsetX + insets.left, offsetY: fitted.offsetY + insets.top };
}

function moveView(target, animate) {
  const clamped = { ...target, scale: Math.min(MAX_SCALE, Math.max(state.fitScale * MIN_SCALE_FACTOR, target.scale)) };
  if (animate && !state.isReducedMotion) state.viewTween = { startAt: performance.now(), durationMs: 400, from: { ...state.view }, to: clamped };
  else {
    state.viewTween = null;
    state.view = clamped;
  }
  markDirty(true, true);
}

function fitToView(animate) {
  moveView(fitBoundsInView(state.layout.bounds), animate);
}

/** The view that puts a world point at a screen point with the given scale. */
const viewKeeping = (worldX, worldY, screenX, screenY, scale) => ({ scale, offsetX: screenX - worldX * scale, offsetY: screenY - worldY * scale });

function zoomAbout(screenX, screenY, factor, animate = false) {
  const base = state.viewTween?.to ?? state.view;
  const scale = Math.min(MAX_SCALE, Math.max(state.fitScale * MIN_SCALE_FACTOR, base.scale * factor));
  const worldX = (screenX - base.offsetX) / base.scale;
  const worldY = (screenY - base.offsetY) / base.scale;
  moveView(viewKeeping(worldX, worldY, screenX, screenY, scale), animate);
}

function resize(isFirst = false) {
  const rect = canvasWrap.getBoundingClientRect();
  state.widthPx = Math.max(1, Math.round(rect.width));
  state.heightPx = Math.max(1, Math.round(rect.height));
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const canvas of [staticCanvas, overlayCanvas]) {
    canvas.width = Math.round(state.widthPx * state.dpr);
    canvas.height = Math.round(state.heightPx * state.dpr);
  }
  document.documentElement.style.setProperty("--top-offset", `${Math.round(byId("strip").getBoundingClientRect().bottom + 8)}px`);
  if (!isFirst && state.layout) state.fitScale = fitView(state.layout.bounds, state.widthPx, state.heightPx).scale;
  // The first real size (the pane may report none while it loads) is when the map is first fitted.
  if (state.layout && !state.hasFitted && rect.width >= 100 && rect.height >= 100) {
    state.hasFitted = true;
    restorePanels();
  }
  markDirty(true, true);
}

// ---------------------------------------------------------------- drawing

function markDirty(isStatic, isOverlay) {
  if (isStatic) state.isStaticDirty = true;
  if (isOverlay) state.isOverlayDirty = true;
  scheduleFrame();
}

function scheduleFrame() {
  if (state.frameHandle) return;
  state.frameHandle = requestAnimationFrame(frame);
}

function frame(now) {
  state.frameHandle = 0;
  let isMoving = false;
  if (state.layoutTween) {
    const progress = Math.min(1, (now - state.layoutTween.startAt) / state.layoutTween.durationMs);
    if (progress >= 1) {
      state.drawPositions = state.layout.positionsById;
      state.layoutTween = null;
    } else {
      state.drawPositions = interpolatedPositions(progress);
      isMoving = true;
    }
    state.isStaticDirty = true;
    state.isOverlayDirty = true;
  }
  if (state.viewTween) {
    const progress = Math.min(1, (now - state.viewTween.startAt) / state.viewTween.durationMs);
    const eased = easeOutCubic(progress);
    const { from, to } = state.viewTween;
    state.view = { scale: from.scale + (to.scale - from.scale) * eased, offsetX: from.offsetX + (to.offsetX - from.offsetX) * eased, offsetY: from.offsetY + (to.offsetY - from.offsetY) * eased };
    if (progress >= 1) state.viewTween = null;
    else isMoving = true;
    state.isStaticDirty = true;
    state.isOverlayDirty = true;
  }
  // The radar sweep keeps the overlay moving whenever motion is allowed; pulses ride along with it.
  const isPulsing = !state.isReducedMotion;
  if (isPulsing && !isMoving && now - state.lastPulseFrameAt >= 33) {
    state.isOverlayDirty = true;
    state.lastPulseFrameAt = now;
  }
  if (state.isStaticDirty) {
    drawStatic();
    state.isStaticDirty = false;
  }
  if (state.isOverlayDirty) {
    drawOverlay(now);
    state.isOverlayDirty = false;
  }
  if (isMoving || isPulsing) scheduleFrame();
}

const screenOf = (position) => ({ x: position.x * state.view.scale + state.view.offsetX, y: position.y * state.view.scale + state.view.offsetY });
const isOnScreen = (point, margin = 0) => point.x >= -margin && point.y >= -margin && point.x <= state.widthPx + margin && point.y <= state.heightPx + margin;

function glowSpriteFor(colorValue) {
  glowSprites ??= new Map();
  let sprite = glowSprites.get(colorValue);
  if (sprite) return sprite;
  sprite = document.createElement("canvas");
  sprite.width = 64;
  sprite.height = 64;
  const context = sprite.getContext("2d");
  const [red, green, blue] = [1, 3, 5].map((index) => Number.parseInt(colorValue.slice(index, index + 2), 16));
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, `rgba(${red}, ${green}, ${blue}, 0.9)`);
  gradient.addColorStop(0.35, `rgba(${red}, ${green}, ${blue}, 0.35)`);
  gradient.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  glowSprites.set(colorValue, sprite);
  return sprite;
}

function nodeColor(node) {
  if (node.nodeKind === "case") return statusColor(node.status);
  if (node.nodeKind === "door") return statusColor(node.status);
  return COLORS.accent;
}

/** The style an edge into `child` is drawn with. */
function edgeStyleOf(parent, child) {
  if (parent.nodeKind === "root") return { color: COLORS.accent, alpha: 0.55, widthPx: 2, dash: null, glow: true };
  if (parent.nodeKind === "sector") return { color: COLORS.accent, alpha: 0.45, widthPx: 1.5, dash: null };
  if (parent.nodeKind === "door_kind") return { color: COLORS.accent, alpha: 0.28, widthPx: 1, dash: null };
  if (child.nodeKind === "door") return { color: COLORS["accent-bright"], alpha: 0.6, widthPx: 1, dash: [3, 3] };
  return { color: statusColor(child.status), alpha: 0.45, widthPx: 1, dash: null };
}

const polar = (radius, angle) => ({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });

/** The curve from a start point to a child: control points at the mid-ring radius on the start's angle and on the child's. */
function curveBetween(start, child, isStraight) {
  if (isStraight) return { start, controlOne: start, controlTwo: child, end: child };
  const startRadius = Math.hypot(start.x, start.y);
  const childRadius = Math.hypot(child.x, child.y);
  const middle = (startRadius + childRadius) / 2;
  return { start, controlOne: polar(middle, Math.atan2(start.y, start.x)), controlTwo: polar(middle, Math.atan2(child.y, child.x)), end: child };
}

/** Every edge to draw as {parentId, childId, curve, stem?}: a parent with two or more children branches from a fork point on the way out. */
function edgeList() {
  const edges = [];
  const forks = new Map();
  for (const child of state.visibleNodes) {
    if (!child.parentId) continue;
    const parent = state.graph.nodesById.get(child.parentId);
    const parentPosition = state.drawPositions.get(parent.nodeId);
    const childPosition = state.drawPositions.get(child.nodeId);
    if (!parentPosition || !childPosition) continue;
    const isRoot = parent.nodeKind === "root";
    const hasFork = !isRoot && (state.visibleChildCountById.get(parent.nodeId) ?? 0) >= 2;
    let start = parentPosition;
    if (hasFork) {
      if (!forks.has(parent.nodeId)) {
        const parentRadius = Math.hypot(parentPosition.x, parentPosition.y);
        const childRadius = Math.hypot(childPosition.x, childPosition.y);
        const forkPoint = polar(parentRadius + 0.3 * (childRadius - parentRadius), Math.atan2(parentPosition.y, parentPosition.x));
        forks.set(parent.nodeId, forkPoint);
        edges.push({ parentId: parent.nodeId, childId: child.nodeId, curve: curveBetween(parentPosition, forkPoint, true), isStem: true, forkPoint });
      }
      start = forks.get(parent.nodeId);
    }
    edges.push({ parentId: parent.nodeId, childId: child.nodeId, curve: curveBetween(start, childPosition, isRoot), isStem: false });
  }
  return edges;
}

function addCurve(path, curve) {
  path.moveTo(curve.start.x, curve.start.y);
  if (curve.controlOne === curve.start) path.lineTo(curve.end.x, curve.end.y);
  else path.bezierCurveTo(curve.controlOne.x, curve.controlOne.y, curve.controlTwo.x, curve.controlTwo.y, curve.end.x, curve.end.y);
}

function curveIsOffScreen(curve) {
  const startPoint = screenOf(curve.start);
  const endPoint = screenOf(curve.end);
  return !isOnScreen(startPoint, 50) && !isOnScreen(endPoint, 50);
}

function worldTransform(context) {
  const { scale, offsetX, offsetY } = state.view;
  context.setTransform(state.dpr * scale, 0, 0, state.dpr * scale, state.dpr * offsetX, state.dpr * offsetY);
}
const screenTransform = (context) => context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

function drawStatic() {
  const context = staticContext;
  const { scale, offsetX, offsetY } = state.view;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
  worldTransform(context);
  context.setLineDash([]);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  const worldLeft = -offsetX / scale;
  const worldTop = -offsetY / scale;
  const worldRight = (state.widthPx - offsetX) / scale;
  const worldBottom = (state.heightPx - offsetY) / scale;

  // The world grid: faint lines every 400, a dot at every 80 and a small cross where the major lines meet.
  const majorStep = 400;
  if (majorStep * scale >= 6) {
    context.beginPath();
    for (let x = Math.ceil(worldLeft / majorStep) * majorStep; x <= worldRight; x += majorStep) {
      context.moveTo(x, worldTop);
      context.lineTo(x, worldBottom);
    }
    for (let y = Math.ceil(worldTop / majorStep) * majorStep; y <= worldBottom; y += majorStep) {
      context.moveTo(worldLeft, y);
      context.lineTo(worldRight, y);
    }
    context.strokeStyle = COLORS.grid;
    context.lineWidth = 1 / scale;
    context.stroke();
    const arm = 4 / scale;
    context.beginPath();
    for (let x = Math.ceil(worldLeft / majorStep) * majorStep; x <= worldRight; x += majorStep) {
      for (let y = Math.ceil(worldTop / majorStep) * majorStep; y <= worldBottom; y += majorStep) {
        context.moveTo(x - arm, y);
        context.lineTo(x + arm, y);
        context.moveTo(x, y - arm);
        context.lineTo(x, y + arm);
      }
    }
    context.strokeStyle = COLORS["grid-major"];
    context.stroke();
  }
  const minorStep = 80;
  if (minorStep * scale >= 16) {
    const dot = 1.2 / scale;
    context.beginPath();
    for (let x = Math.ceil(worldLeft / minorStep) * minorStep; x <= worldRight; x += minorStep) {
      for (let y = Math.ceil(worldTop / minorStep) * minorStep; y <= worldBottom; y += minorStep) context.rect(x - dot / 2, y - dot / 2, dot, dot);
    }
    context.fillStyle = COLORS["grid-major"];
    context.fill();
  }

  // Ring guides, and a bearing scale round the outside like a radar's.
  context.beginPath();
  for (const radius of state.layout.ringRadii) {
    if (radius <= 0) continue;
    context.moveTo(radius, 0);
    context.arc(0, 0, radius, 0, Math.PI * 2);
  }
  context.setLineDash([2 / scale, 6 / scale]);
  context.strokeStyle = COLORS.ring;
  context.lineWidth = 1 / scale;
  context.stroke();
  context.setLineDash([]);
  drawBearingScale(context);

  drawEdges(context);
  drawNodes(context);
  drawLabels(context);
  context.globalAlpha = 1;
}

/** The radius of the bearing scale and the radar sweep: just outside the outermost ring. */
function scopeRadius() {
  const outer = Math.max(0, ...state.layout.ringRadii);
  return outer + 28 / Math.max(state.view.scale, 0.05);
}

/** Tick marks every 5° round the outermost ring, longer every 30° with a three-digit bearing. */
function drawBearingScale(context) {
  if (state.layout.ringRadii.length < 2) return;
  const { scale } = state.view;
  const radius = scopeRadius();
  const center = screenOf({ x: 0, y: 0 });
  const radiusPx = radius * scale;
  if (radiusPx < 60) return;
  screenTransform(context);
  context.beginPath();
  context.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
  context.strokeStyle = "rgba(57, 160, 255, 0.22)";
  context.lineWidth = 1;
  context.stroke();
  const minor = new Path2D();
  const major = new Path2D();
  for (let degrees = 0; degrees < 360; degrees += 5) {
    const angle = ((degrees - 90) * Math.PI) / 180;
    const isMajor = degrees % 30 === 0;
    const length = isMajor ? 9 : 4;
    const path = isMajor ? major : minor;
    path.moveTo(center.x + Math.cos(angle) * radiusPx, center.y + Math.sin(angle) * radiusPx);
    path.lineTo(center.x + Math.cos(angle) * (radiusPx + length), center.y + Math.sin(angle) * (radiusPx + length));
  }
  context.strokeStyle = "rgba(57, 160, 255, 0.3)";
  context.stroke(minor);
  context.strokeStyle = "rgba(143, 211, 255, 0.65)";
  context.stroke(major);
  context.font = `10px ${MONO}`;
  context.fillStyle = COLORS.muted;
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (let degrees = 0; degrees < 360; degrees += 30) {
    const angle = ((degrees - 90) * Math.PI) / 180;
    const point = { x: center.x + Math.cos(angle) * (radiusPx + 20), y: center.y + Math.sin(angle) * (radiusPx + 20) };
    if (isOnScreen(point, 10)) context.fillText(String(degrees).padStart(3, "0"), point.x, point.y);
  }
  worldTransform(context);
}

function hexagonPath(x, y, radius, rotation = 0) {
  const path = new Path2D();
  for (let corner = 0; corner < 6; corner += 1) {
    const angle = rotation + (corner * Math.PI) / 3;
    if (corner === 0) path.moveTo(x + radius * Math.cos(angle), y + radius * Math.sin(angle));
    else path.lineTo(x + radius * Math.cos(angle), y + radius * Math.sin(angle));
  }
  path.closePath();
  return path;
}

/** Four corner brackets round a screen point, the way a targeting reticle frames what it's locked on. */
function drawBrackets(context, point, half, minimumArm, rotation = 0) {
  const arm = Math.min(half, Math.max(minimumArm, half * 0.3));
  context.save();
  context.translate(point.x, point.y);
  context.rotate(rotation);
  context.beginPath();
  for (const [signX, signY] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    context.moveTo(signX * half, signY * (half - arm));
    context.lineTo(signX * half, signY * half);
    context.lineTo(signX * (half - arm), signY * half);
  }
  context.stroke();
  context.restore();
}

function drawEdges(context) {
  const { scale } = state.view;
  const batches = new Map();
  const dots = new Path2D();
  const glow = new Path2D();
  let hasGlow = false;
  for (const edge of edgeList()) {
    if (curveIsOffScreen(edge.curve)) continue;
    const parent = state.graph.nodesById.get(edge.parentId);
    const child = state.graph.nodesById.get(edge.childId);
    const style = edgeStyleOf(parent, child);
    const key = `${style.color}|${style.alpha}|${style.widthPx}|${style.dash ? style.dash.join(",") : ""}`;
    let batch = batches.get(key);
    if (!batch) {
      batch = { style, path: new Path2D() };
      batches.set(key, batch);
    }
    addCurve(batch.path, edge.curve);
    if (style.glow) {
      addCurve(glow, edge.curve);
      hasGlow = true;
    }
    if (edge.isStem) {
      dots.moveTo(edge.forkPoint.x + 1.5 / scale, edge.forkPoint.y);
      dots.arc(edge.forkPoint.x, edge.forkPoint.y, 1.5 / scale, 0, Math.PI * 2);
    }
  }
  if (hasGlow) {
    context.globalAlpha = 0.12;
    context.strokeStyle = COLORS.accent;
    context.lineWidth = 6 / scale;
    context.stroke(glow);
  }
  for (const { style, path } of batches.values()) {
    context.globalAlpha = style.alpha;
    context.strokeStyle = style.color;
    context.lineWidth = style.widthPx / scale;
    context.setLineDash(style.dash ? style.dash.map((length) => length / scale) : []);
    context.stroke(path);
  }
  context.setLineDash([]);
  context.globalAlpha = 0.8;
  context.fillStyle = COLORS.accent;
  context.fill(dots);
  context.globalAlpha = 1;
}

function drawNodes(context) {
  const { scale } = state.view;
  const nodes = state.visibleNodes.map((node) => ({ node, position: state.drawPositions.get(node.nodeId) })).filter(({ position }) => position && isOnScreen(screenOf(position), 80));

  // Glow, additive, root and sectors first, then until the budget is spent.
  screenTransform(context);
  context.globalCompositeOperation = "lighter";
  let glowCount = 0;
  const ordered = [...nodes].sort((first, second) => (first.node.depth <= 1 ? 0 : 1) - (second.node.depth <= 1 ? 0 : 1));
  for (const { node, position } of ordered) {
    const screenRadius = position.radius * scale;
    if (screenRadius < 2.5) continue;
    if (glowCount >= MAX_GLOW_COUNT) break;
    glowCount += 1;
    const size = screenRadius * (node.nodeKind === "root" ? 6 : 4);
    const point = screenOf(position);
    context.globalAlpha = node.nodeKind === "case" ? 0.7 : 1;
    context.drawImage(glowSpriteFor(nodeColor(node)), point.x - size, point.y - size, size * 2, size * 2);
  }
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  worldTransform(context);

  const discBatches = new Map();
  const squareBatches = new Map();
  const removedDoors = [];
  const donuts = [];
  const framed = [];
  for (const { node, position } of nodes) {
    const screenRadius = position.radius * scale;
    const isSmall = screenRadius < 1.25;
    if (node.nodeKind === "door_kind" || node.nodeKind === "sector" || node.nodeKind === "root") {
      framed.push({ node, position });
      continue;
    }
    if (node.nodeKind === "door" && node.source.door_removed_at) {
      removedDoors.push({ node, position });
      continue;
    }
    if (isSmall) {
      const key = nodeColor(node);
      if (!squareBatches.has(key)) squareBatches.set(key, new Path2D());
      squareBatches.get(key).rect(position.x - 0.5 / scale, position.y - 0.5 / scale, 1 / scale, 1 / scale);
      continue;
    }
    if (node.nodeKind === "door" && screenRadius >= 5) {
      donuts.push({ node, position });
      continue;
    }
    const key = nodeColor(node);
    if (!discBatches.has(key)) discBatches.set(key, new Path2D());
    const path = discBatches.get(key);
    path.moveTo(position.x + position.radius, position.y);
    path.arc(position.x, position.y, position.radius, 0, Math.PI * 2);
  }
  for (const [key, path] of discBatches) {
    context.fillStyle = key;
    context.fill(path);
  }
  for (const [key, path] of squareBatches) {
    context.fillStyle = key;
    context.fill(path);
  }
  for (const { node, position } of donuts) drawDonut(context, node, position);
  context.globalAlpha = 0.35;
  for (const { node, position } of removedDoors) {
    if (position.radius * scale >= 5) drawDonut(context, node, position);
    else {
      context.fillStyle = nodeColor(node);
      context.beginPath();
      context.arc(position.x, position.y, position.radius, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.globalAlpha = 1;
  for (const { node, position } of framed) drawFramedNode(context, node, position);
}

/** A door as a donut of its case statuses, arcs proportional to the counts. */
function drawDonut(context, node, position) {
  const counts = statusCountsOf(state.graph, node.nodeId);
  const total = STATUS_ORDER.reduce((sum, status) => sum + counts[status], 0);
  if (total === 0) {
    context.fillStyle = COLORS.unexplored;
    context.beginPath();
    context.arc(position.x, position.y, position.radius, 0, Math.PI * 2);
    context.fill();
    return;
  }
  const ringRadius = position.radius * 0.775;
  context.lineWidth = position.radius * 0.45;
  let angle = -Math.PI / 2;
  for (const status of ["robust", "fixed", "weak", "stale", "unexplored"]) {
    if (!counts[status]) continue;
    const span = (counts[status] / total) * Math.PI * 2;
    context.strokeStyle = statusColor(status);
    context.beginPath();
    context.arc(position.x, position.y, ringRadius, angle, angle + span);
    context.stroke();
    angle += span;
  }
}

function drawFramedNode(context, node, position) {
  const { scale } = state.view;
  // The root is a hexagonal core, a sector a hexagon, a kind group a circle.
  const isHexagon = node.nodeKind === "root" || node.nodeKind === "sector";
  const outline = isHexagon ? hexagonPath(position.x, position.y, position.radius * 1.08, node.nodeKind === "sector" ? position.angleRad : -Math.PI / 2) : null;
  context.fillStyle = COLORS.node;
  if (outline) context.fill(outline);
  else {
    context.beginPath();
    context.arc(position.x, position.y, position.radius, 0, Math.PI * 2);
    context.fill();
  }
  context.strokeStyle = COLORS.accent;
  context.lineWidth = (node.nodeKind === "door_kind" ? 1.5 : 2) / scale;
  if (outline) context.stroke(outline);
  else context.stroke();
  if (node.nodeKind === "root") {
    // A bright core until the root is big enough to hold its own name and coverage.
    if (position.radius * scale < 16) {
      context.fillStyle = COLORS["accent-bright"];
      context.globalAlpha = 0.9;
      context.fill(hexagonPath(position.x, position.y, position.radius * 0.32, -Math.PI / 2));
    }
    context.globalAlpha = 0.35;
    context.lineWidth = 1 / scale;
    context.stroke(hexagonPath(position.x, position.y, position.radius * 0.66, -Math.PI / 2));
    context.globalAlpha = 1;
  }
  if (node.nodeKind === "sector") {
    context.globalAlpha = 0.3;
    context.lineWidth = 1 / scale;
    context.stroke(hexagonPath(position.x, position.y, position.radius * 0.6, position.angleRad));
    context.globalAlpha = 1;
  }
  const counts = statusCountsOf(state.graph, node.nodeId);
  const total = STATUS_ORDER.reduce((sum, status) => sum + counts[status], 0);
  if (node.nodeKind === "door_kind" && total > 0) {
    context.strokeStyle = COLORS.robust;
    context.lineWidth = 2 / scale;
    context.beginPath();
    context.arc(position.x, position.y, position.radius + 3, -Math.PI / 2, -Math.PI / 2 + ((counts.robust + counts.fixed) / total) * Math.PI * 2);
    context.stroke();
  }
  if (node.nodeKind === "sector") {
    const donutRadius = position.radius + 6;
    context.lineWidth = 5;
    context.strokeStyle = COLORS.line;
    context.beginPath();
    context.arc(position.x, position.y, donutRadius, 0, Math.PI * 2);
    context.stroke();
    if (node.source.coverage_pct > 0) {
      context.strokeStyle = COLORS.robust;
      context.beginPath();
      context.arc(position.x, position.y, donutRadius, -Math.PI / 2, -Math.PI / 2 + (node.source.coverage_pct / 100) * Math.PI * 2);
      context.stroke();
    }
  }
}

function overallCoverage() {
  const sectors = state.exportData.sectors;
  const caseCount = sectors.reduce((sum, sector) => sum + sector.case_count, 0);
  const doneCount = sectors.reduce((sum, sector) => sum + sector.done_case_count, 0);
  return caseCount ? Math.round((doneCount / caseCount) * 100) : 0;
}

function labelTextOf(node) {
  if (node.nodeKind === "door") return node.label.length > 32 ? `${node.label.slice(0, 31)}…` : node.label;
  return node.label;
}

/** Whether a node's name is on screen at this zoom (the hover tooltip stands in when it isn't). */
function isLabelShown(node) {
  const { scale } = state.view;
  if (node.nodeKind === "root" || node.nodeKind === "sector") return true;
  if (node.nodeKind === "door_kind") return scale >= 0.3;
  if (node.nodeKind === "door") return scale >= 1;
  return scale >= 2;
}

function drawLabels(context) {
  const { scale } = state.view;
  screenTransform(context);
  context.textBaseline = "middle";
  const occupied = new Set();
  let labelCount = 0;
  const claim = (points) => {
    const keys = points.map((point) => `${Math.floor(point.x / 32)},${Math.floor(point.y / 32)}`);
    if (keys.some((key) => occupied.has(key))) return false;
    for (const key of keys) occupied.add(key);
    return true;
  };
  const drawOrder = ["root", "sector", "door_kind", "door", "case"];
  const nodes = [...state.visibleNodes].sort((first, second) => drawOrder.indexOf(first.nodeKind) - drawOrder.indexOf(second.nodeKind));
  for (const node of nodes) {
    if (labelCount >= MAX_LABEL_COUNT) break;
    if (!isLabelShown(node)) continue;
    const position = state.drawPositions.get(node.nodeId);
    if (!position) continue;
    const point = screenOf(position);
    if (!isOnScreen(point, 40)) continue;
    const radiusPx = position.radius * scale;
    if (node.nodeKind === "root") {
      // The root's name only fits inside it once it's big enough; the top bar says the coverage meanwhile.
      if (radiusPx < 16) continue;
      context.textAlign = "center";
      context.fillStyle = COLORS.fg;
      context.font = `600 13px ${MONO}`;
      context.fillText("zaisma", point.x, point.y - 7);
      context.fillStyle = COLORS["fg-2"];
      context.font = `11px ${MONO}`;
      context.fillText(`${overallCoverage()}%`, point.x, point.y + 9);
      labelCount += 1;
      continue;
    }
    if (node.nodeKind === "sector") {
      context.font = `600 13px ${MONO}`;
      context.shadowColor = COLORS.accent;
      context.shadowBlur = 8;
      const nameWidth = context.measureText(node.label).width;
      // Under the node when its neighbors are far enough apart; along its own spoke, outward, when they aren't.
      if (nameWidth + 12 <= sectorSpacingPx()) {
        context.textAlign = "center";
        context.fillStyle = COLORS.fg;
        context.fillText(node.label, point.x, point.y + radiusPx + 20);
        context.fillStyle = COLORS["fg-2"];
        context.font = `11px ${MONO}`;
        context.fillText(`${node.source.coverage_pct}%`, point.x, point.y + radiusPx + 35);
        claim([{ x: point.x - nameWidth / 2, y: point.y + radiusPx + 20 }, { x: point.x + nameWidth / 2, y: point.y + radiusPx + 20 }]);
      } else {
        const text = `${node.label} ${node.source.coverage_pct}%`;
        const angle = position.angleRad;
        const isLeft = Math.cos(angle) < 0;
        const start = radiusPx + 14;
        context.save();
        context.translate(point.x, point.y);
        context.rotate(isLeft ? angle + Math.PI : angle);
        context.textAlign = isLeft ? "right" : "left";
        context.fillStyle = COLORS.fg;
        context.fillText(text, (isLeft ? -1 : 1) * start, 0);
        context.restore();
        const width = context.measureText(text).width;
        const points = [];
        for (let along = 0; along <= width; along += 16) points.push({ x: point.x + Math.cos(angle) * (start + along), y: point.y + Math.sin(angle) * (start + along) });
        claim(points);
      }
      context.shadowBlur = 0;
      labelCount += 1;
      continue;
    }
    const sizePx = node.nodeKind === "door_kind" ? 11 : node.nodeKind === "door" ? 10 : 9;
    context.font = `${sizePx}px ${MONO}`;
    context.fillStyle = node.nodeKind === "case" ? COLORS.muted : COLORS["fg-2"];
    const text = labelTextOf(node);
    const width = context.measureText(text).width;
    if (node.nodeKind === "door_kind") {
      if (!claim([{ x: point.x - width / 2, y: point.y + radiusPx + 12 }, { x: point.x + width / 2, y: point.y + radiusPx + 12 }])) continue;
      context.textAlign = "center";
      context.fillText(text, point.x, point.y + radiusPx + 12);
      labelCount += 1;
      continue;
    }
    const angle = position.angleRad;
    const isLeft = Math.cos(angle) < 0;
    const direction = isLeft ? -1 : 1;
    const start = radiusPx + 6;
    const points = [];
    for (let along = 0; along <= width; along += 16) points.push({ x: point.x + Math.cos(angle) * (start + along) * 1, y: point.y + Math.sin(angle) * (start + along) });
    points.push({ x: point.x + Math.cos(angle) * (start + width), y: point.y + Math.sin(angle) * (start + width) });
    if (!claim(points)) continue;
    context.save();
    context.translate(point.x, point.y);
    context.rotate(isLeft ? angle + Math.PI : angle);
    context.textAlign = isLeft ? "right" : "left";
    context.fillText(text, direction * start, 0);
    context.restore();
    labelCount += 1;
  }
}

/** The least distance on screen between two neighbouring sector nodes. */
function sectorSpacingPx() {
  const ids = state.graph.sectorIds;
  if (ids.length < 2) return Infinity;
  let least = Infinity;
  for (let index = 0; index < ids.length; index += 1) {
    const first = state.drawPositions.get(`sector:${ids[index]}`);
    const second = state.drawPositions.get(`sector:${ids[(index + 1) % ids.length]}`);
    if (first && second) least = Math.min(least, Math.hypot(first.x - second.x, first.y - second.y) * state.view.scale);
  }
  return least;
}

function pulseAlpha(now, periodMs, low) {
  return low + (1 - low) * (0.5 + 0.5 * Math.sin((now / periodMs) * Math.PI * 2));
}

function drawOverlay(now) {
  const context = overlayContext;
  const { scale } = state.view;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  worldTransform(context);
  context.setLineDash([]);
  context.globalAlpha = 1;

  drawSweep(context, now);

  // Selected path: its edges drawn again, bright.
  if (state.selectedId && state.visibleIds.has(state.selectedId)) {
    const ancestors = [];
    for (let node = state.graph.nodesById.get(state.selectedId); node?.parentId; node = state.graph.nodesById.get(node.parentId)) ancestors.push(node);
    for (const child of ancestors) {
      const parent = state.graph.nodesById.get(child.parentId);
      const parentPosition = state.drawPositions.get(parent.nodeId);
      const childPosition = state.drawPositions.get(child.nodeId);
      if (!parentPosition || !childPosition) continue;
      const style = edgeStyleOf(parent, child);
      const path = new Path2D();
      addCurve(path, curveBetween(parentPosition, childPosition, parent.nodeKind === "root"));
      context.strokeStyle = style.color;
      context.lineWidth = 2 / scale;
      context.stroke(path);
    }
  }

  // Stale: a pulsing halo, or a static dashed outline with reduced motion.
  const staleNodes = state.visibleNodes.filter((node) => node.status === "stale" && (node.nodeKind === "door" || node.nodeKind === "case"));
  if (staleNodes.length) {
    let haloCount = 0;
    context.strokeStyle = COLORS.stale;
    context.lineWidth = 1.5 / scale;
    context.globalAlpha = state.isReducedMotion ? 1 : pulseAlpha(now, 2400, 0.5);
    if (state.isReducedMotion) context.setLineDash([3 / scale, 3 / scale]);
    for (const node of staleNodes) {
      const position = state.drawPositions.get(node.nodeId);
      if (!position || !isOnScreen(screenOf(position), 20) || position.radius * scale < 1.5) continue;
      if (haloCount >= 600) break;
      haloCount += 1;
      context.beginPath();
      context.arc(position.x, position.y, position.radius + 3 / scale, 0, Math.PI * 2);
      context.stroke();
    }
    context.setLineDash([]);
    context.globalAlpha = 1;
  }

  // Holes: a ring on the sector (doubled with reduced motion) and a badge with the count. Nothing below the sector says anything about a hole.
  for (const sector of state.exportData.sectors) {
    if (holeCountOf(sector) === 0) continue;
    const position = state.drawPositions.get(`sector:${sector.sector_id}`);
    if (!position) continue;
    context.strokeStyle = COLORS.hole;
    context.lineWidth = 3 / scale;
    context.globalAlpha = state.isReducedMotion ? 1 : pulseAlpha(now, 1600, 0.45);
    context.beginPath();
    context.arc(position.x, position.y, position.radius + 16, 0, Math.PI * 2);
    context.stroke();
    if (sector.hole_count_by_tier.urgent > 0 || state.isReducedMotion) {
      context.beginPath();
      context.arc(position.x, position.y, position.radius + 22, 0, Math.PI * 2);
      context.stroke();
    }
    context.globalAlpha = 1;
    // Lock-on brackets, turning against the selection reticle's direction.
    screenTransform(context);
    context.strokeStyle = COLORS.hole;
    context.lineWidth = 1.5;
    context.globalAlpha = 0.8;
    drawBrackets(context, screenOf(position), (position.radius + 30) * scale, 7, state.isReducedMotion ? Math.PI / 4 : -(now / 5000) * Math.PI * 2);
    context.globalAlpha = 1;
    worldTransform(context);
  }
  drawHoleBadges(context);

  // Selection ring, and a reticle locked on the selected node, turning slowly.
  screenTransform(context);
  const spin = state.isReducedMotion ? 0 : (now / 6000) * Math.PI * 2;
  if (state.selectedId && state.visibleIds.has(state.selectedId)) {
    const position = state.drawPositions.get(state.selectedId);
    if (position) {
      const point = screenOf(position);
      const radiusPx = Math.max(position.radius * scale, 3);
      context.strokeStyle = COLORS.focus;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(point.x, point.y, radiusPx + 4, 0, Math.PI * 2);
      context.stroke();
      context.lineWidth = 1.5;
      context.shadowColor = COLORS.focus;
      context.shadowBlur = 8;
      drawBrackets(context, point, radiusPx + 11, 6, spin);
      context.shadowBlur = 0;
      // Crosshair ticks out to the four sides.
      context.globalAlpha = 0.55;
      context.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        context.moveTo(point.x + dx * (radiusPx + 16), point.y + dy * (radiusPx + 16));
        context.lineTo(point.x + dx * (radiusPx + 26), point.y + dy * (radiusPx + 26));
      }
      context.stroke();
      context.globalAlpha = 1;
    }
  }

  // Hover: a still, dimmer reticle.
  if (state.hoverId && state.hoverId !== state.selectedId && state.visibleIds.has(state.hoverId)) {
    const position = state.drawPositions.get(state.hoverId);
    if (position) {
      context.strokeStyle = COLORS["accent-bright"];
      context.globalAlpha = 0.75;
      context.lineWidth = 1;
      drawBrackets(context, screenOf(position), Math.max(position.radius * scale, 3) + 7, 4);
      context.globalAlpha = 1;
    }
  }
  worldTransform(context);

  drawTooltip(context);
  updateReadout();
}

/** A radar sweep round the root: a bright leading edge with a fading wake. Still with reduced motion. */
function drawSweep(context, now) {
  if (state.isReducedMotion || typeof context.createConicGradient !== "function" || state.layout.ringRadii.length < 2) return;
  const radius = scopeRadius();
  const wake = 0.5;
  const angle = ((now / 8000) * Math.PI * 2) % (Math.PI * 2);
  const gradient = context.createConicGradient(angle - wake, 0, 0);
  const wakeShare = wake / (Math.PI * 2);
  gradient.addColorStop(0, "rgba(57, 160, 255, 0)");
  gradient.addColorStop(wakeShare * 0.999, "rgba(57, 160, 255, 0.13)");
  gradient.addColorStop(wakeShare, "rgba(57, 160, 255, 0)");
  gradient.addColorStop(1, "rgba(57, 160, 255, 0)");
  context.globalCompositeOperation = "lighter";
  context.fillStyle = gradient;
  context.beginPath();
  context.moveTo(0, 0);
  context.arc(0, 0, radius, angle - wake, angle);
  context.closePath();
  context.fill();
  context.strokeStyle = "rgba(143, 211, 255, 0.45)";
  context.lineWidth = 1 / state.view.scale;
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(radius * Math.cos(angle), radius * Math.sin(angle));
  context.stroke();
  context.globalCompositeOperation = "source-over";

  // The root's outer ring turns the other way, in segments.
  const root = state.drawPositions.get(state.graph.rootId);
  const rootRadius = (root?.radius ?? 0) + 7 / state.view.scale;
  if (root && rootRadius * state.view.scale > 6) {
    context.save();
    context.rotate(-angle * 0.6);
    context.setLineDash([6 / state.view.scale, 4 / state.view.scale]);
    context.strokeStyle = COLORS.accent;
    context.globalAlpha = 0.7;
    context.lineWidth = 1.5 / state.view.scale;
    context.beginPath();
    context.arc(0, 0, rootRadius, 0, Math.PI * 2);
    context.stroke();
    context.restore();
    context.setLineDash([]);
    context.globalAlpha = 1;
  }
}

let lastReadout = "";
/** The strip at the bottom: zoom, the world point under the pointer, and how many nodes are drawn. */
function updateReadout() {
  const readout = byId("readout");
  if (!readout) return;
  const world = { x: (state.pointer.x - state.view.offsetX) / state.view.scale, y: (state.pointer.y - state.view.offsetY) / state.view.scale };
  const bearing = Math.round(((Math.atan2(world.y, world.x) * 180) / Math.PI + 90 + 360) % 360);
  const range = Math.round(Math.hypot(world.x, world.y));
  const parts = [["zoom", `${state.view.scale.toFixed(2)}×`], ["bearing", String(bearing).padStart(3, "0")], ["range", String(range)], ["nodes", String(state.visibleIds.size)]];
  const text = parts.map((part) => part.join(" ")).join("|");
  if (text === lastReadout) return;
  lastReadout = text;
  readout.replaceChildren(...parts.map(([label, value]) => h("span", {}, `${label} `, h("b", { text: value }))));
}

const holeCountOf = (sector) => sector.hole_count_by_tier.urgent + sector.hole_count_by_tier.important + sector.hole_count_by_tier.hardening;

function drawHoleBadges(context) {
  screenTransform(context);
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const sector of state.exportData.sectors) {
    const holeCount = holeCountOf(sector);
    if (holeCount === 0) continue;
    const position = state.drawPositions.get(`sector:${sector.sector_id}`);
    if (!position) continue;
    const ringRadius = position.radius + 16;
    const point = screenOf({ x: position.x + ringRadius * Math.cos(-Math.PI / 4), y: position.y + ringRadius * Math.sin(-Math.PI / 4) });
    if (!isOnScreen(point, 20)) continue;
    context.fillStyle = COLORS.hole;
    context.beginPath();
    context.arc(point.x, point.y, 9, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = COLORS.fg;
    context.font = `700 10px ${MONO}`;
    context.fillText(String(holeCount), point.x, point.y + 0.5);
  }
  worldTransform(context);
}

function drawTooltip(context) {
  if (!state.hoverId || !state.visibleIds.has(state.hoverId)) return;
  const node = state.graph.nodesById.get(state.hoverId);
  if (isLabelShown(node)) return;
  screenTransform(context);
  const id = node.nodeKind === "door" ? node.source.door_id : node.nodeKind === "case" ? node.source.case_id : node.nodeId;
  const lines = [id, node.label];
  context.font = `11px ${MONO}`;
  const width = Math.max(...lines.map((line) => context.measureText(line).width)) + 16;
  const height = lines.length * 16 + 10;
  const x = Math.min(state.pointer.x + 14, state.widthPx - width - 8);
  const y = Math.min(state.pointer.y + 14, state.heightPx - height - 8);
  context.fillStyle = "rgba(4, 10, 22, 0.94)";
  context.strokeStyle = COLORS["panel-line"];
  context.lineWidth = 1;
  context.fillRect(x, y, width, height);
  context.strokeRect(x + 0.5, y + 0.5, width, height);
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillStyle = COLORS["fg-2"];
  context.fillText(lines[0], x + 8, y + 13);
  context.fillStyle = COLORS.fg;
  context.fillText(lines[1], x + 8, y + 29);
}

// ---------------------------------------------------------------- selecting and revealing

const hasCaseChildren = (node) => node.childIds.some((childId) => state.graph.nodesById.get(childId).nodeKind === "case");

function selectNode(nodeId) {
  state.selectedId = nodeId;
  if (nodeId) {
    state.panelMode = "detail";
    renderDrawer();
  } else if (state.panelMode === "detail") state.panelMode = "none";
  updatePanels();
  markDirty(false, true);
}

function expandNode(nodeId, isExpanded) {
  if (isExpanded) state.expandedIds.add(nodeId);
  else state.expandedIds.delete(nodeId);
  applyLayout(true);
  if (state.selectedId) renderDrawer();
}

function focusNode(nodeId, minimumScale = 1.4) {
  const position = state.layout.positionsById.get(nodeId);
  if (!position) return;
  const scale = Math.max(state.viewTween?.to.scale ?? state.view.scale, minimumScale);
  const insets = panelInsets();
  const centerX = insets.left + (state.widthPx - insets.left - insets.right) / 2;
  const centerY = insets.top + (state.heightPx - insets.top) / 2;
  moveView(viewKeeping(position.x, position.y, centerX, centerY, scale), true);
}

/** Opens whatever hides the node, centers it and selects it. */
function revealNode(nodeId) {
  if (!state.graph.nodesById.has(nodeId)) return;
  const toExpand = expandedIdsToReveal(state.graph, nodeId).filter((id) => !state.expandedIds.has(id));
  for (const id of toExpand) state.expandedIds.add(id);
  if (toExpand.length) applyLayout(true);
  closeSearch();
  selectNode(nodeId);
  focusNode(nodeId);
}

function focusSector(sectorId) {
  const nodeId = `sector:${sectorId}`;
  selectNode(nodeId);
  const subtree = [];
  const walk = (id) => {
    if (!state.visibleIds.has(id)) return;
    subtree.push(id);
    for (const childId of state.graph.nodesById.get(id).childIds) walk(childId);
  };
  walk(nodeId);
  moveView(fitBoundsInView(boundsOf(state.layout.positionsById, subtree)), true);
}

function handleNodeClick(nodeId) {
  if (!nodeId) {
    selectNode(null);
    if (state.panelMode === "list") closeListPanel();
    return;
  }
  const node = state.graph.nodesById.get(nodeId);
  const wasSelected = state.selectedId === nodeId;
  if (node.nodeKind === "sector") return focusSector(node.sectorId);
  selectNode(nodeId);
  if ((node.nodeKind === "door" || node.nodeKind === "case") && hasCaseChildren(node)) {
    const isExpanded = state.expandedIds.has(nodeId);
    if (!isExpanded) expandNode(nodeId, true);
    else if (wasSelected) expandNode(nodeId, false);
  }
}

// ---------------------------------------------------------------- pointer, wheel, touch and keys

function worldOf(clientX, clientY) {
  const rect = canvasWrap.getBoundingClientRect();
  return { x: (clientX - rect.left - state.view.offsetX) / state.view.scale, y: (clientY - rect.top - state.view.offsetY) / state.view.scale };
}

function nodeAt(clientX, clientY, pointerType) {
  const world = worldOf(clientX, clientY);
  const tolerancePx = pointerType === "touch" ? 18 : 10;
  return hitTest(state.hitGrid, world.x, world.y, tolerancePx / state.view.scale);
}

function attachInteraction() {
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let lastTap = { at: 0, x: 0, y: 0 };

  canvasWrap.addEventListener("pointerdown", (event) => {
    canvasWrap.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) drag = { startX: event.clientX, startY: event.clientY, offsetX: state.view.offsetX, offsetY: state.view.offsetY, isPanning: false };
    if (pointers.size === 2) {
      const [first, second] = [...pointers.values()];
      pinch = { distance: Math.hypot(first.x - second.x, first.y - second.y), scale: state.view.scale, offsetX: state.view.offsetX, offsetY: state.view.offsetY, midX: (first.x + second.x) / 2, midY: (first.y + second.y) / 2 };
      drag = null;
    }
  });

  canvasWrap.addEventListener("pointermove", (event) => {
    const rect = canvasWrap.getBoundingClientRect();
    state.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size === 2) {
      const [first, second] = [...pointers.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      const midX = (first.x + second.x) / 2;
      const midY = (first.y + second.y) / 2;
      const scale = Math.min(MAX_SCALE, Math.max(state.fitScale * MIN_SCALE_FACTOR, pinch.scale * (distance / pinch.distance)));
      const worldX = (pinch.midX - rect.left - pinch.offsetX) / pinch.scale;
      const worldY = (pinch.midY - rect.top - pinch.offsetY) / pinch.scale;
      state.viewTween = null;
      state.view = viewKeeping(worldX, worldY, midX - rect.left, midY - rect.top, scale);
      markDirty(true, true);
      return;
    }
    if (drag && pointers.has(event.pointerId)) {
      const moveX = event.clientX - drag.startX;
      const moveY = event.clientY - drag.startY;
      if (!drag.isPanning && Math.hypot(moveX, moveY) > 4) {
        drag.isPanning = true;
        canvasWrap.style.cursor = "grabbing";
      }
      if (drag.isPanning) {
        state.viewTween = null;
        state.view = { ...state.view, offsetX: drag.offsetX + moveX, offsetY: drag.offsetY + moveY };
        markDirty(true, true);
      }
      return;
    }
    const hovered = nodeAt(event.clientX, event.clientY, event.pointerType);
    canvasWrap.style.cursor = hovered ? "pointer" : "grab";
    if (hovered !== state.hoverId) {
      state.hoverId = hovered;
      markDirty(false, true);
    } else if (hovered) markDirty(false, true);
  });

  const endPointer = (event) => {
    const wasDrag = drag;
    const wasPinch = pinch;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (wasPinch) {
      drag = null;
      return;
    }
    if (!wasDrag) return;
    drag = null;
    canvasWrap.style.cursor = "grab";
    if (event.type === "pointercancel" || wasDrag.isPanning) return;
    const now = performance.now();
    if (event.pointerType === "touch" && now - lastTap.at < 300 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 30) {
      const rect = canvasWrap.getBoundingClientRect();
      zoomAbout(event.clientX - rect.left, event.clientY - rect.top, 2, true);
      lastTap = { at: 0, x: 0, y: 0 };
      return;
    }
    lastTap = { at: now, x: event.clientX, y: event.clientY };
    handleNodeClick(nodeAt(event.clientX, event.clientY, event.pointerType));
  };
  canvasWrap.addEventListener("pointerup", endPointer);
  canvasWrap.addEventListener("pointercancel", endPointer);
  canvasWrap.addEventListener("pointerleave", () => {
    if (state.hoverId) {
      state.hoverId = null;
      markDirty(false, true);
    }
  });
  canvasWrap.addEventListener("dblclick", (event) => {
    const rect = canvasWrap.getBoundingClientRect();
    zoomAbout(event.clientX - rect.left, event.clientY - rect.top, 2, true);
  });
  canvasWrap.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const rect = canvasWrap.getBoundingClientRect();
      const lineFactor = event.deltaMode === 1 ? 16 : 1;
      zoomAbout(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * lineFactor * 0.0015));
    },
    { passive: false },
  );

  canvasWrap.addEventListener("keydown", (event) => {
    const centerX = state.widthPx / 2;
    const centerY = state.heightPx / 2;
    const pan = (dx, dy) => {
      event.preventDefault();
      moveView({ ...state.view, offsetX: state.view.offsetX + dx, offsetY: state.view.offsetY + dy }, false);
    };
    if (event.key === "ArrowLeft") pan(60, 0);
    else if (event.key === "ArrowRight") pan(-60, 0);
    else if (event.key === "ArrowUp") pan(0, 60);
    else if (event.key === "ArrowDown") pan(0, -60);
    else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomAbout(centerX, centerY, 1.25);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomAbout(centerX, centerY, 0.8);
    } else if (event.key === "0") {
      event.preventDefault();
      fitToView(true);
    } else if (event.key === "Enter" && state.selectedId) {
      event.preventDefault();
      const node = state.graph.nodesById.get(state.selectedId);
      if ((node.nodeKind === "door" || node.nodeKind === "case") && hasCaseChildren(node)) expandNode(node.nodeId, !state.expandedIds.has(node.nodeId));
    }
  });

  byId("zoom-in").addEventListener("click", () => zoomAbout(state.widthPx / 2, state.heightPx / 2, 1.4, true));
  byId("zoom-out").addEventListener("click", () => zoomAbout(state.widthPx / 2, state.heightPx / 2, 1 / 1.4, true));
  byId("zoom-fit").addEventListener("click", () => fitToView(true));

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!byId("search-results").hidden) closeSearch();
    else if (state.panelMode === "list") closeListPanel();
    else if (state.panelMode === "detail" && state.selectedId) selectNode(null);
    else if (state.selectedId) selectNode(null);
  });
  canvasWrap.setAttribute("aria-label", `Security map graph: ${state.exportData.sectors.length} sectors, ${state.graph.nodesById.size ? [...state.graph.nodesById.values()].filter((node) => node.nodeKind === "door").length : 0} doors, ${overallCoverage()}% covered. The text view lists the same.`);
}

// ---------------------------------------------------------------- panels

const statusChip = (status, text = STATUS_NAMES[status] ?? status) => h("span", { class: "chip" }, h("span", { class: `dot dot-${status}` }), text);

function countChips(counts) {
  return h("div", { class: "row" }, STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => statusChip(status, `${counts[status]} ${STATUS_NAMES[status].toLowerCase()}`)));
}

function holeSummary(sector) {
  const { urgent, important, hardening } = sector.hole_count_by_tier;
  const total = urgent + important + hardening;
  if (total === 0) return null;
  const parts = [[urgent, "urgent"], [important, "important"], [hardening, "hardening"]].filter(([count]) => count > 0).map(([count, name]) => `${count} ${name}`);
  return `${total} ${total === 1 ? "hole" : "holes"}: ${parts.join(", ")}`;
}

function coverageBar(percent) {
  return h("div", { class: "bar", role: "img", "aria-label": `${percent}% covered` }, h("span", { style: `width: ${percent}%` }));
}

function buildTopBar() {
  const { exportData } = state;
  const fact = (label, value, isBig = false) => [h("span", { class: "fact-label", text: label }), h("span", { class: `fact-value${isBig ? " is-big" : ""}`, text: value })];
  byId("generated-at").replaceChildren(...fact("generated", exportData.generated_at ? timeText(exportData.generated_at) : "unknown"));
  byId("overall-coverage").replaceChildren(...fact("covered", `${overallCoverage()}%`, true));
  const totals = exportData.sectors.reduce((sum, sector) => ({ urgent: sum.urgent + sector.hole_count_by_tier.urgent, important: sum.important + sector.hole_count_by_tier.important, hardening: sum.hardening + sector.hole_count_by_tier.hardening }), { urgent: 0, important: 0, hardening: 0 });
  const total = totals.urgent + totals.important + totals.hardening;
  const chip = byId("holes-chip");
  if (total > 0) {
    const detail = `${total} ${total === 1 ? "hole" : "holes"}: ${totals.urgent} urgent, ${totals.important} important, ${totals.hardening} hardening`;
    chip.hidden = false;
    clear(chip);
    chip.append(h("span", { class: "dot dot-hole" }), `${total} ${total === 1 ? "hole" : "holes"}`);
    chip.title = detail;
    chip.setAttribute("aria-label", detail);
    chip.addEventListener("click", () => openListPanel("holes"));
  }
  byId("text-toggle").addEventListener("click", () => {
    state.isTextViewOn = !state.isTextViewOn;
    renderTextViewState();
  });
  byId("sectors-button").addEventListener("click", () => setSectorPanelOpen(byId("sector-panel").hidden));
  const input = byId("search-input");
  input.addEventListener("input", () => renderSearch(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const first = searchDoors(state.graph, input.value)[0];
      if (first) revealNode(first.nodeId);
    }
  });
}

let searchSelected = 0;
function renderSearch(query) {
  const results = searchDoors(state.graph, query);
  const list = byId("search-results");
  clear(list);
  searchSelected = 0;
  list.hidden = results.length === 0;
  byId("search-input").setAttribute("aria-expanded", String(results.length > 0));
  for (const result of results) {
    list.append(h("li", { role: "option" }, h("button", { class: "search-option", type: "button", onclick: () => revealNode(result.nodeId) }, h("span", { class: "node-id", text: result.id }), result.name)));
  }
}
function closeSearch() {
  byId("search-results").hidden = true;
  byId("search-input").setAttribute("aria-expanded", "false");
}

function buildStrip() {
  const strip = byId("strip");
  const since = state.exportData.since_last_night;
  clear(strip);
  if (!since.baseline_generated_at) {
    strip.append(h("span", { text: "First map: nothing to compare with yet." }));
    return;
  }
  strip.append(h("span", { class: "strip-title", text: "Since last night" }));
  const explored = since.explored_cases.filter((item) => item.status === "robust" || item.status === "weak").length;
  const fixed = since.explored_cases.filter((item) => item.status === "fixed").length;
  const holeChange = state.exportData.sectors.reduce((sum, sector) => sum + Object.values(sector.hole_count_by_tier).reduce((a, b) => a + b, 0) - Object.values(sector.hole_count_by_tier_at_baseline ?? sector.hole_count_by_tier).reduce((a, b) => a + b, 0), 0);
  const chips = [["explored", `Explored ${explored}`], ["fixed", `Fixed ${fixed}`], ["stale", `Went stale ${since.stale_cases.length}`], ["doors", `New doors ${since.new_doors.length}`]];
  if (holeChange !== 0) chips.push(["holes", `Holes ${holeChange > 0 ? "+" : "−"}${Math.abs(holeChange)}`]);
  for (const [kind, text] of chips) {
    const splitAt = text.lastIndexOf(" ");
    strip.append(h("button", { class: `chip${kind === "holes" ? " chip-hole" : ""}`, type: "button", onclick: () => openListPanel(kind) }, text.slice(0, splitAt + 1), h("span", { class: kind === "holes" ? null : "chip-count", text: text.slice(splitAt + 1) })));
  }
}

function caseNodeId(item) {
  const nodeId = `case:${item.door_id}|${item.case_id.split("/").join("|")}`;
  return state.graph.nodesById.has(nodeId) ? nodeId : `door:${item.door_id}`;
}

function openListPanel(kind) {
  state.listKind = kind;
  state.panelMode = "list";
  const panel = byId("list-panel");
  clear(panel);
  const since = state.exportData.sectors.length ? state.exportData.since_last_night : null;
  const titles = { explored: "Explored since last night", fixed: "Fixed since last night", stale: "Went stale since last night", doors: "New doors since last night", holes: "Holes by sector" };
  panel.append(h("div", { class: "panel-header" }, h("div", {}, h("p", { class: "kind-tag", text: kind === "holes" ? "Holes" : "Since last night" }), h("h2", { text: titles[kind] })), h("button", { class: "button framed", type: "button", onclick: closeListPanel }, "Close")));
  let items = [];
  if (kind === "explored") items = since.explored_cases.filter((item) => item.status === "robust" || item.status === "weak").map((item) => ({ title: item.case_name, note: `${doorNameOf(item.door_id)}`, status: item.status, nodeId: caseNodeId(item) }));
  else if (kind === "fixed") items = since.explored_cases.filter((item) => item.status === "fixed").map((item) => ({ title: item.case_name, note: doorNameOf(item.door_id), status: item.status, nodeId: caseNodeId(item) }));
  else if (kind === "stale") items = since.stale_cases.map((item) => ({ title: item.case_name, note: `${doorNameOf(item.door_id)}${item.stale_reason ? `: ${item.stale_reason}` : ""}`, status: "stale", nodeId: caseNodeId(item) }));
  else if (kind === "doors") items = since.new_doors.map((item) => ({ title: item.door_name, note: item.door_id, status: null, nodeId: `door:${item.door_id}` }));
  else {
    items = state.exportData.sectors.filter((sector) => holeSummary(sector)).map((sector) => ({ title: sector.sector_name, note: holeSummary(sector), status: null, nodeId: `sector:${sector.sector_id}`, isHole: true }));
  }
  if (items.length === 0) panel.append(h("p", { class: "muted", text: "Nothing here." }));
  for (const item of items.slice(0, LIST_ITEM_LIMIT)) {
    const isMissing = !state.graph.nodesById.has(item.nodeId);
    panel.append(h("button", { class: "list-button", type: "button", disabled: isMissing, onclick: () => (item.nodeId.startsWith("sector:") ? focusSector(item.nodeId.slice(7)) : revealNode(item.nodeId)) }, h("span", { text: item.title }), item.note ? h("span", { class: `muted${item.isHole ? " hole-text" : ""}`, text: item.note }) : null, item.status ? statusChip(item.status) : null));
  }
  if (items.length > LIST_ITEM_LIMIT) panel.append(h("p", { class: "muted", text: `and ${items.length - LIST_ITEM_LIMIT} more` }));
  if (kind === "holes") panel.append(h("p", { class: "muted", text: "Details stay hidden until it's fixed." }));
  updatePanels();
}

function doorNameOf(doorId) {
  const node = state.graph.nodesById.get(`door:${doorId}`);
  return node ? node.label : doorId;
}

function closeListPanel() {
  state.listKind = null;
  state.panelMode = state.selectedId ? "detail" : "none";
  updatePanels();
}

function setSectorPanelOpen(isOpen) {
  byId("sector-panel").hidden = !isOpen;
  byId("sectors-button").setAttribute("aria-expanded", String(isOpen));
  writeStorage({ isSectorPanelOpen: isOpen });
  updatePanels();
  if (state.layout && state.widthPx >= 900) fitToView(true);
}

function updatePanels() {
  byId("drawer").hidden = state.panelMode !== "detail";
  byId("list-panel").hidden = state.panelMode !== "list";
  const isNarrow = state.widthPx < 900;
  const openSheet = isNarrow && (!byId("sector-panel").hidden || state.panelMode !== "none");
  app.classList.toggle("has-open-sheet", openSheet);
  byId("legend").classList.toggle("has-open-panel", isNarrow && openSheet);
  // On a narrow screen only one sheet shows at a time: the one opened last.
  if (isNarrow && state.panelMode !== "none") byId("sector-panel").hidden = true;
  byId("sectors-button").setAttribute("aria-expanded", String(!byId("sector-panel").hidden));
}

function restorePanels() {
  const stored = readStorage();
  const isWide = state.widthPx >= 900;
  const isOpen = typeof stored.isSectorPanelOpen === "boolean" ? stored.isSectorPanelOpen && (isWide || false) : isWide;
  byId("sector-panel").hidden = !isOpen;
  const legendDetails = byId("legend").querySelector("details");
  if (legendDetails) legendDetails.open = typeof stored.isLegendOpen === "boolean" ? stored.isLegendOpen : isWide;
  updatePanels();
  fitToView(false);
}

function buildSectorPanel() {
  const panel = byId("sector-panel");
  clear(panel);
  panel.append(h("h2", { text: "Sectors" }));
  for (const sector of state.exportData.sectors) {
    const counts = statusCountsOf(state.graph, `sector:${sector.sector_id}`);
    const holes = holeSummary(sector);
    panel.append(
      h(
        "button",
        { class: `sector-card framed${holes ? " has-holes" : ""}`, type: "button", onclick: () => focusSector(sector.sector_id) },
        h("h2", {}, h("span", { text: sector.sector_name }), h("span", { class: "sector-pct", text: `${sector.coverage_pct}%` })),
        h("p", { class: "muted", text: sector.attacker_goal }),
        coverageBar(sector.coverage_pct),
        h("p", { class: "small fg-2", text: `${sector.coverage_pct}% covered: ${sector.done_case_count} of ${sector.case_count} cases` }),
        countChips(counts),
        holes ? h("p", { class: "small hole-text", text: holes }) : null,
      ),
    );
  }
  if (state.problems.length) {
    panel.append(h("details", { class: "notes" }, h("summary", { text: `Data notes: ${state.problems.length}` }), h("ul", {}, state.problems.map((problem) => h("li", { text: problem })))));
  }
}

function buildLegend() {
  const legend = byId("legend");
  clear(legend);
  const items = ["unexplored", "robust", "weak", "stale", "fixed"].map((status) => h("li", {}, h("span", { class: `dot dot-${status}` }), STATUS_NAMES[status]));
  items.push(h("li", {}, h("span", { class: "dot dot-hole" }), "Pulsing red ring: holes in this sector. Details stay hidden until fixed."));
  const details = h("details", {}, h("summary", { text: "Legend" }), h("ul", {}, items));
  details.addEventListener("toggle", () => writeStorage({ isLegendOpen: details.open }));
  legend.append(details);
}

function renderDrawer() {
  const drawer = byId("drawer");
  clear(drawer);
  const node = state.graph.nodesById.get(state.selectedId);
  if (!node) return;
  const { nodeKind, source } = node;
  const idText = nodeKind === "door" ? source.door_id : nodeKind === "case" ? source.case_id : nodeKind === "sector" ? source.sector_id : nodeKind === "door_kind" ? source.door_kind : "root";
  drawer.append(
    h(
      "div",
      { class: "panel-header" },
      h("div", {}, h("p", { class: "kind-tag", text: NODE_KIND_NAMES[nodeKind] }), h("h2", { text: node.label }), h("p", { class: "node-id", text: idText })),
      h("button", { class: "button framed", type: "button", onclick: () => selectNode(null) }, "Close"),
    ),
  );
  drawer.append(h("div", { class: "row" }, statusChip(node.status)));
  if (nodeKind === "case") {
    drawer.append(h("p", { class: "small", text: source.last_checked_at ? `Last checked ${timeText(source.last_checked_at)}` : "Never checked." }));
    if (source.evidence) {
      drawer.append(h("div", { class: "evidence" }, h("p", { class: "small fg-2", text: EVIDENCE_NAMES[source.evidence.kind] ?? source.evidence.kind }), h("p", { class: "node-id", text: source.evidence.ref }), source.evidence.note ? h("p", { text: source.evidence.note }) : null));
    }
    if (source.status === "stale") drawer.append(h("p", { text: `Went stale: ${source.stale_reason ?? "the code it relied on changed"}` }));
    if (source.status === "unexplored") drawer.append(h("p", { class: "muted", text: "Not explored yet." }));
    if (hasCaseChildren(node)) {
      const isExpanded = state.expandedIds.has(node.nodeId);
      drawer.append(h("button", { class: "button framed", type: "button", onclick: () => expandNode(node.nodeId, !isExpanded) }, isExpanded ? "Hide cases" : "Show cases"));
    }
  }
  if (nodeKind === "door") {
    drawer.append(countChips(statusCountsOf(state.graph, node.nodeId)));
    if (source.door_removed_at) drawer.append(h("p", { text: `Removed from the code on ${dayFormat.format(new Date(source.door_removed_at))}` }));
    if (node.isAlias) {
      const target = state.graph.nodesById.get(node.parentId);
      drawer.append(h("button", { class: "button framed", type: "button", onclick: () => revealNode(target.nodeId) }, `Shares its checks with ${target.label}`));
    }
    if (hasCaseChildren(node)) {
      const isExpanded = state.expandedIds.has(node.nodeId);
      drawer.append(h("button", { class: "button framed", type: "button", onclick: () => expandNode(node.nodeId, !isExpanded) }, isExpanded ? "Hide cases" : "Show cases"));
    }
  }
  if (nodeKind === "sector" || nodeKind === "door_kind") {
    if (nodeKind === "sector") {
      drawer.append(h("p", { class: "small", text: source.attacker_goal }), coverageBar(source.coverage_pct), h("p", { class: "small fg-2", text: `${source.coverage_pct}% covered: ${source.done_case_count} of ${source.case_count} cases` }));
      const holes = holeSummary(source);
      if (holes) drawer.append(h("p", { class: "hole-text", text: holes }), h("p", { class: "muted", text: "Details stay hidden until it's fixed." }));
    } else {
      const doorCount = node.childIds.length;
      drawer.append(h("p", { text: `${doorCount} ${doorCount === 1 ? "door" : "doors"}` }));
    }
    drawer.append(countChips(statusCountsOf(state.graph, node.nodeId)));
    const result = expandEverythingUnder(state.graph, node.nodeId, state.expandedIds);
    drawer.append(h("button", { class: "button framed", type: "button", disabled: !result.isAllowed, onclick: () => (state.expandedIds = result.expandedIds, applyLayout(true), renderDrawer()) }, "Show every case"));
    if (!result.isAllowed) drawer.append(h("p", { class: "muted", text: `Too many cases to show at once (${result.visibleNodeCount}). Open doors one by one.` }));
    drawer.append(h("button", { class: "button framed", type: "button", onclick: () => hideCasesUnder(node.nodeId) }, "Hide every case"));
  }
}

function hideCasesUnder(nodeId) {
  const walk = (id) => {
    state.expandedIds.delete(id);
    for (const childId of state.graph.nodesById.get(id).childIds) walk(childId);
  };
  walk(nodeId);
  applyLayout(true);
  renderDrawer();
}

// ---------------------------------------------------------------- the text view

function renderTextViewState() {
  const view = byId("text-view");
  view.classList.toggle("sr-only", !state.isTextViewOn);
  byId("text-toggle").setAttribute("aria-pressed", String(state.isTextViewOn));
  byId("text-toggle").textContent = state.isTextViewOn ? "Graph view" : "Text view";
  if (app.dataset.state === "ready" || app.dataset.state === "text") {
    canvasWrap.style.visibility = state.isTextViewOn ? "hidden" : "";
  }
}

function buildTextView() {
  const view = byId("text-view");
  clear(view);
  view.append(h("h1", { text: "Security map as text" }));
  for (const sector of state.exportData.sectors) {
    const holes = holeSummary(sector);
    const section = h("div", { class: "text-sector" });
    section.append(h("h2", { text: `${sector.sector_name}: ${sector.coverage_pct}% covered, ${sector.done_case_count} of ${sector.case_count} cases${holes ? `, ${holes}` : ""}` }), h("p", { class: "muted", text: sector.attacker_goal }));
    const details = h("details", {}, h("summary", { text: `${sector.doors.length} doors` }));
    let isBuilt = false;
    details.addEventListener("toggle", () => {
      if (!details.open || isBuilt) return;
      isBuilt = true;
      const list = h("ul");
      for (const door of sector.doors) {
        const counts = statusCountsOf(state.graph, `door:${door.door_id}`);
        const summary = STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => `${counts[status]} ${status}`).join(", ");
        list.append(h("li", { text: `${door.door_name} (${door.door_id}): ${summary || "no cases"}` }));
      }
      details.append(list);
    });
    section.append(details);
    view.append(section);
  }
}

// ---------------------------------------------------------------- the check hook

window.securityMapCheck = {
  visibleNodeCount: () => state.visibleIds.size,
  screenPointOf: (nodeId) => {
    const position = state.layout?.positionsById.get(nodeId);
    if (!position) return null;
    const rect = canvasWrap.getBoundingClientRect();
    return { x: rect.left + position.x * state.view.scale + state.view.offsetX, y: rect.top + position.y * state.view.scale + state.view.offsetY };
  },
  selectedNodeId: () => state.selectedId,
  drawTimeMs: () => {
    const started = performance.now();
    drawStatic();
    return Math.round((performance.now() - started) * 100) / 100;
  },
};

load();
