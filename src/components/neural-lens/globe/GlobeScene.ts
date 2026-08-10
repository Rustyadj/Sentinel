// Neural Lens — the globe renderer.
//
// A self-contained Three.js scene: no force simulation, no per-node meshes,
// no library between us and the GPU. Node coordinates are fixed by
// computeGlobeLayout and never recomputed, so this class only ever answers
// two questions — where is the camera, and how should each node/edge look
// right now. The whole field is four draw calls (dust, edges, hub bloom,
// focus bloom) plus the scaffolding, which is what makes 12,000 nodes and
// ~100,000 edges feel like nothing.
//
// Division of labour with the React layer above it:
//   this class  — WebGL, camera, buffers, picking, framing
//   React       — chrome, labels, panels, and what the operator asked for
// State flows one way (setGraph/setState/setHover); nothing here reads React.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  CONNECTED_NODE_OPACITY,
  EDGE_ACTIVE_HEX,
  EDGE_BASE_ALPHA,
  EDGE_BASE_HEX,
  EDGE_LENS_ALPHA,
  EDGE_LENS_HEX,
  EDGE_LIT_ALPHA,
  EDGE_LIT_HEX,
  EDGE_OUT_OF_LENS_ALPHA,
  FOG,
  HUB_NODE,
  HUB_NODE_OPACITY,
  LENS_ACCENT,
  LENS_BG,
  LENS_HUB_NODE,
  NEUTRAL_NODE,
  NODE_RADIUS,
  OUT_OF_LENS_DIM,
  RELATED_NODE,
  SELECTED_GLOW,
  SELECTED_NODE,
  clusterColor,
  densityRank,
  normalNodeOpacity,
  normalNodeRadius,
  zoomLevelFor,
} from "../palette";
import type { ClusterId, LensGraph, LensNode, SemanticZoomLevel } from "../types";
import {
  ATMOSPHERE_FRAGMENT_SHADER,
  ATMOSPHERE_VERTEX_SHADER,
  EDGE_FRAGMENT_SHADER,
  EDGE_VERTEX_SHADER,
  GLOW_FRAGMENT_SHADER,
  NODE_FRAGMENT_SHADER,
  NODE_VERTEX_SHADER,
  PATH_VERTEX_SHADER,
} from "./shaders";
import { DEFAULT_GLOBE_SETTINGS, type GlobeSettings } from "../graphSettings";

export interface GlobeVisualState {
  selectedId: string | null;
  hoveredId: string | null;
  /** Nodes lit by live activity or pinned by the shell (active agents). */
  litIds: ReadonlySet<string>;
  /** Colour used for the focused/lit neighbourhood (workspace identity). */
  litColor: string;
  lensClusterId: ClusterId | null;
  lensOnly: boolean;
  /** Ordered node ids of the currently-running route, if any. */
  pathNodeIds: readonly string[] | null;
  settings: GlobeSettings;
}

export interface GlobeCameraState {
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
}

export interface ProjectedPoint {
  x: number;
  y: number;
  /** Camera-space distance — useful for scaling or ordering overlays. */
  distance: number;
  /** False when the point is behind the camera or outside the viewport. */
  onScreen: boolean;
}

export interface GlobeFrameApi {
  project: (x: number, y: number, z: number, out: ProjectedPoint) => ProjectedPoint;
  /** True when a point on the shell faces the camera — used to hide the
   * labels of regions that have rotated round the back. */
  facesCamera: (nx: number, ny: number, nz: number) => boolean;
  nodePosition: (id: string) => { x: number; y: number; z: number } | null;
  cameraDistance: number;
  zoomLevel: SemanticZoomLevel;
  width: number;
  height: number;
}

export interface GlobeSceneCallbacks {
  onZoomLevel?: (level: SemanticZoomLevel) => void;
  /** Fired once the camera has settled, not every frame. */
  onCameraSettled?: (camera: GlobeCameraState) => void;
}

const GLOBE_RADIUS = 1000;
/** Camera distance that maps to zoom scale 1.0 — see zoomLevelFor. */
const ZOOM_REFERENCE_DISTANCE = GLOBE_RADIUS * 0.35;
const DEFAULT_VIEW_DIRECTION = new THREE.Vector3(0.3, 0.24, 1).normalize();
const CAMERA_TWEEN_MS = 900;
const HUB_GLOW_SCALE = 9;
const FOCUS_GLOW_CAPACITY = 160;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface FogUniforms {
  uTime: { value: number };
  uDrift: { value: number };
  uFogNear: { value: number };
  uFogFar: { value: number };
  uFogStrength: { value: number };
}

function fogUniforms(): FogUniforms {
  return {
    uTime: { value: 0 },
    uDrift: { value: 0 },
    uFogNear: { value: GLOBE_RADIUS },
    uFogFar: { value: GLOBE_RADIUS * 3 },
    uFogStrength: { value: FOG.strength },
  };
}

export class GlobeScene {
  readonly radius = GLOBE_RADIUS;

  private readonly container: HTMLElement;
  private readonly callbacks: GlobeSceneCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;

  private width = 1;
  private height = 1;
  private frame = 0;
  private running = false;
  private clockStart = performance.now();
  private reducedMotion = false;

  // --- Graph data ----------------------------------------------------------
  private nodes: LensNode[] = [];
  private nodeIndex = new Map<string, number>();
  private links: Array<{ source: number; target: number; weight: number }> = [];
  /** Edge indices incident to each node — lets hover relight only what it touches. */
  private incident: number[][] = [];
  private neighbors: number[][] = [];

  // Positions and phases are fixed for the life of the graph. Everything
  // else exists twice: a CPU "base" array holding what the current state says
  // a node/edge should look like, and the GPU array the shader reads. Hover
  // writes only to the GPU side, so it can be undone exactly by copying the
  // base value back — no recomputation, no drift between the two.
  private nodePositions = new Float32Array(0);
  private nodePhases = new Float32Array(0);
  private nodeRestSizes = new Float32Array(0);
  private baseNodeColor = new Float32Array(0);
  private baseNodeSize = new Float32Array(0);
  private baseNodeAlpha = new Float32Array(0);
  private baseNodePulse = new Float32Array(0);
  private baseEdgeColor = new Float32Array(0);
  private baseEdgeAlpha = new Float32Array(0);

  private nodePoints: THREE.Points | null = null;
  private edgeLines: THREE.LineSegments | null = null;
  private hubGlow: THREE.Points | null = null;
  private focusGlow: THREE.Points | null = null;
  private pathLines: THREE.LineSegments | null = null;
  private hubIndices: number[] = [];

  // --- Materials -----------------------------------------------------------
  private readonly nodeUniforms = {
    ...fogUniforms(),
    uSizeScale: { value: 1 },
    uScreenScale: { value: 1000 },
    uPulse: { value: 1 },
  };
  private readonly glowUniforms = {
    ...fogUniforms(),
    uSizeScale: { value: 1 },
    uScreenScale: { value: 1000 },
    uPulse: { value: 1 },
  };
  private readonly starUniforms = {
    ...fogUniforms(),
    uSizeScale: { value: 1 },
    uScreenScale: { value: 1000 },
    uPulse: { value: 0 },
  };
  private readonly edgeUniforms = fogUniforms();
  private readonly scaffoldUniforms = fogUniforms();
  private readonly pathUniforms = {
    ...fogUniforms(),
    uPathSpeed: { value: 0.16 },
    uPathWidth: { value: 0.07 },
  };
  private readonly atmosphereUniforms = {
    uColor: { value: new THREE.Color("#5f7fd8") },
    uStrength: { value: 0.42 },
  };

  private readonly nodeMaterial: THREE.ShaderMaterial;
  private readonly glowMaterial: THREE.ShaderMaterial;
  private readonly starMaterial: THREE.ShaderMaterial;
  private readonly edgeMaterial: THREE.ShaderMaterial;
  private readonly scaffoldMaterial: THREE.ShaderMaterial;
  private readonly pathMaterial: THREE.ShaderMaterial;
  private readonly disposables: Array<{ dispose: () => void }> = [];

  // --- Visual state --------------------------------------------------------
  private state: GlobeVisualState = {
    selectedId: null,
    hoveredId: null,
    litIds: new Set(),
    litColor: "#7dd3fc",
    lensClusterId: null,
    lensOnly: false,
    pathNodeIds: null,
    settings: DEFAULT_GLOBE_SETTINGS,
  };
  private hoverSet: Set<number> = new Set();
  private lensVisible: Set<number> | null = null;
  private pathIndices: number[] = [];

  private tween: {
    fromPosition: THREE.Vector3;
    toPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    start: number;
    duration: number;
  } | null = null;
  private lastZoomLevel: SemanticZoomLevel | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private frameListeners = new Set<(api: GlobeFrameApi) => void>();
  private readonly frameApi: GlobeFrameApi;
  private readonly viewProjection = new THREE.Matrix4();
  private readonly scratchVector = new THREE.Vector3();
  private readonly scratchColor = new THREE.Color();
  private readonly scratchColorB = new THREE.Color();

  constructor(container: HTMLElement, callbacks: GlobeSceneCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(new THREE.Color(LENS_BG), 1);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.touchAction = "none";
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, 1, GLOBE_RADIUS * 0.01, GLOBE_RADIUS * 40);
    this.camera.position.copy(DEFAULT_VIEW_DIRECTION).multiplyScalar(this.defaultDistance());

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.5;
    this.controls.zoomSpeed = 0.8;
    // Panning is deliberately off: the globe stays centred on whatever the
    // operator selected, so rotating never loses spatial orientation.
    this.controls.enablePan = false;
    this.controls.minDistance = GLOBE_RADIUS * 0.1;
    this.controls.maxDistance = GLOBE_RADIUS * 7;
    this.controls.addEventListener("end", () => this.scheduleSettle());

    if (typeof window !== "undefined") {
      this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    const makeMaterial = (
      vertex: string,
      fragment: string,
      // Each layer owns a differently-shaped uniform object; three only cares
      // that the values are IUniform-like, so the cast happens once here.
      uniforms: object,
      extra: THREE.ShaderMaterialParameters = {},
    ) => {
      const material = new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: uniforms as THREE.ShaderMaterial["uniforms"],
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        ...extra,
      });
      this.disposables.push(material);
      return material;
    };

    this.nodeMaterial = makeMaterial(NODE_VERTEX_SHADER, NODE_FRAGMENT_SHADER, this.nodeUniforms);
    this.glowMaterial = makeMaterial(NODE_VERTEX_SHADER, GLOW_FRAGMENT_SHADER, this.glowUniforms);
    this.starMaterial = makeMaterial(NODE_VERTEX_SHADER, NODE_FRAGMENT_SHADER, this.starUniforms);
    this.edgeMaterial = makeMaterial(EDGE_VERTEX_SHADER, EDGE_FRAGMENT_SHADER, this.edgeUniforms);
    this.scaffoldMaterial = makeMaterial(EDGE_VERTEX_SHADER, EDGE_FRAGMENT_SHADER, this.scaffoldUniforms);
    this.pathMaterial = makeMaterial(PATH_VERTEX_SHADER, EDGE_FRAGMENT_SHADER, this.pathUniforms);

    // Stars sit far outside the fog band; fogging them would erase the sky.
    this.starUniforms.uFogStrength.value = 0;

    this.buildBackdrop();

    this.frameApi = {
      project: (x, y, z, out) => this.project(x, y, z, out),
      facesCamera: (nx, ny, nz) => this.facesCamera(nx, ny, nz),
      nodePosition: (id) => this.nodePosition(id),
      cameraDistance: this.defaultDistance(),
      zoomLevel: "galaxy",
      width: 1,
      height: 1,
    };

    this.resize();
    this.resetView(false);
  }

  // -------------------------------------------------------------------------
  // Scaffolding: starfield, atmosphere rim, graticule
  // -------------------------------------------------------------------------

  private buildBackdrop(): void {
    // Starfield — far behind the graph, unaffected by depth fog so it reads as
    // sky rather than as more graph.
    const starCount = 2600;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    const alphas = new Float32Array(starCount);
    const phases = new Float32Array(starCount);
    const pulses = new Float32Array(starCount);
    const star = new THREE.Color();
    for (let i = 0; i < starCount; i++) {
      const distance = GLOBE_RADIUS * (4 + Math.random() * 6);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = distance * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = distance * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = distance * Math.cos(phi);
      star.setHSL(0.58 + Math.random() * 0.08, 0.35, 0.6 + Math.random() * 0.3);
      colors[i * 3] = star.r;
      colors[i * 3 + 1] = star.g;
      colors[i * 3 + 2] = star.b;
      sizes[i] = 6 + Math.random() * 14;
      alphas[i] = 0.12 + Math.random() * 0.3;
      phases[i] = Math.random() * 100;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    starGeometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    starGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    starGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    starGeometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    starGeometry.setAttribute("aPulse", new THREE.BufferAttribute(pulses, 1));
    const starfield = new THREE.Points(starGeometry, this.starMaterial);
    starfield.frustumCulled = false;
    starfield.name = "starfield";
    this.scene.add(starfield);
    this.disposables.push(starGeometry);

    // Atmosphere rim — gives the field a silhouette without an outline.
    const shellGeometry = new THREE.SphereGeometry(GLOBE_RADIUS * 1.06, 64, 40);
    const shellMaterial = new THREE.ShaderMaterial({
      vertexShader: ATMOSPHERE_VERTEX_SHADER,
      fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
      uniforms: this.atmosphereUniforms as unknown as THREE.ShaderMaterial["uniforms"],
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    });
    const atmosphere = new THREE.Mesh(shellGeometry, shellMaterial);
    atmosphere.frustumCulled = false;
    this.scene.add(atmosphere);
    this.disposables.push(shellGeometry, shellMaterial);

    // Graticule — a handful of latitude/longitude arcs at the very floor of
    // visibility. They read as orientation, not as decoration, and they make
    // the rotation of the globe legible when the field is sparse.
    const segments = 128;
    const latitudes = [-0.9, -0.55, -0.2, 0.2, 0.55, 0.9];
    const meridians = 8;
    const lineCount = latitudes.length + meridians;
    const vertexCount = lineCount * segments * 2;
    const gridPositions = new Float32Array(vertexCount * 3);
    const gridColors = new Float32Array(vertexCount * 3);
    const gridAlphas = new Float32Array(vertexCount);
    const gridPhases = new Float32Array(vertexCount);
    const gridColor = new THREE.Color("#3f5c8f");
    let cursor = 0;
    const pushSegment = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      const base = cursor * 3;
      gridPositions[base] = ax;
      gridPositions[base + 1] = ay;
      gridPositions[base + 2] = az;
      gridPositions[base + 3] = bx;
      gridPositions[base + 4] = by;
      gridPositions[base + 5] = bz;
      for (let k = 0; k < 2; k++) {
        gridColors[(cursor + k) * 3] = gridColor.r;
        gridColors[(cursor + k) * 3 + 1] = gridColor.g;
        gridColors[(cursor + k) * 3 + 2] = gridColor.b;
        gridAlphas[cursor + k] = 0.05;
      }
      cursor += 2;
    };
    const shellRadius = GLOBE_RADIUS * 1.005;
    for (const sinLat of latitudes) {
      const y = sinLat * shellRadius;
      const ringRadius = Math.sqrt(Math.max(0, shellRadius * shellRadius - y * y));
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const b = ((i + 1) / segments) * Math.PI * 2;
        pushSegment(
          Math.cos(a) * ringRadius, y, Math.sin(a) * ringRadius,
          Math.cos(b) * ringRadius, y, Math.sin(b) * ringRadius,
        );
      }
    }
    for (let m = 0; m < meridians; m++) {
      const lon = (m / meridians) * Math.PI;
      const cos = Math.cos(lon);
      const sin = Math.sin(lon);
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const b = ((i + 1) / segments) * Math.PI * 2;
        pushSegment(
          Math.cos(a) * shellRadius * cos, Math.sin(a) * shellRadius, Math.cos(a) * shellRadius * sin,
          Math.cos(b) * shellRadius * cos, Math.sin(b) * shellRadius, Math.cos(b) * shellRadius * sin,
        );
      }
    }
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute("position", new THREE.BufferAttribute(gridPositions, 3));
    gridGeometry.setAttribute("aColor", new THREE.BufferAttribute(gridColors, 3));
    gridGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(gridAlphas, 1));
    gridGeometry.setAttribute("aPhase", new THREE.BufferAttribute(gridPhases, 1));
    const graticule = new THREE.LineSegments(gridGeometry, this.scaffoldMaterial);
    graticule.frustumCulled = false;
    graticule.name = "graticule";
    this.scene.add(graticule);
    this.disposables.push(gridGeometry);
  }

  // -------------------------------------------------------------------------
  // Graph buffers
  // -------------------------------------------------------------------------

  setGraph(graph: LensGraph): void {
    this.disposeGraphLayers();

    this.nodes = graph.nodes;
    this.nodeIndex = new Map(graph.nodes.map((node, index) => [node.id, index]));

    const count = graph.nodes.length;
    this.nodePositions = new Float32Array(count * 3);
    this.nodePhases = new Float32Array(count);
    this.nodeRestSizes = new Float32Array(count);
    this.baseNodeColor = new Float32Array(count * 3);
    this.baseNodeSize = new Float32Array(count);
    this.baseNodeAlpha = new Float32Array(count);
    this.baseNodePulse = new Float32Array(count);
    this.hubIndices = [];

    graph.nodes.forEach((node, index) => {
      this.nodePositions[index * 3] = node.x;
      this.nodePositions[index * 3 + 1] = node.y;
      this.nodePositions[index * 3 + 2] = node.z;
      this.nodeRestSizes[index] = node.isHub
        ? node.val >= 6
          ? NODE_RADIUS.majorHub
          : NODE_RADIUS.hub
        : normalNodeRadius(node.id);
      this.nodePhases[index] = (index % 997) * 0.731;
      if (node.isHub) this.hubIndices.push(index);
    });

    this.links = [];
    this.incident = Array.from({ length: count }, () => []);
    this.neighbors = Array.from({ length: count }, () => []);
    for (const link of graph.links) {
      const source = this.nodeIndex.get(link.source);
      const target = this.nodeIndex.get(link.target);
      if (source === undefined || target === undefined) continue;
      const edgeIndex = this.links.length;
      this.links.push({ source, target, weight: link.weight });
      this.incident[source].push(edgeIndex);
      this.incident[target].push(edgeIndex);
      this.neighbors[source].push(target);
      this.neighbors[target].push(source);
    }

    // --- dust field
    const nodeGeometry = new THREE.BufferGeometry();
    nodeGeometry.setAttribute("position", new THREE.BufferAttribute(this.nodePositions, 3));
    nodeGeometry.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    nodeGeometry.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(count), 1));
    nodeGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(count), 1));
    nodeGeometry.setAttribute("aPhase", new THREE.BufferAttribute(this.nodePhases, 1));
    nodeGeometry.setAttribute("aPulse", new THREE.BufferAttribute(new Float32Array(count), 1));
    this.nodePoints = new THREE.Points(nodeGeometry, this.nodeMaterial);
    this.nodePoints.frustumCulled = false;
    this.nodePoints.renderOrder = 3;
    this.scene.add(this.nodePoints);

    // --- edges
    const edgeCount = this.links.length;
    const edgePositions = new Float32Array(edgeCount * 6);
    this.baseEdgeColor = new Float32Array(edgeCount * 6);
    this.baseEdgeAlpha = new Float32Array(edgeCount * 2);
    const edgePhases = new Float32Array(edgeCount * 2);
    for (let i = 0; i < edgeCount; i++) {
      const { source, target } = this.links[i];
      edgePositions[i * 6] = this.nodePositions[source * 3];
      edgePositions[i * 6 + 1] = this.nodePositions[source * 3 + 1];
      edgePositions[i * 6 + 2] = this.nodePositions[source * 3 + 2];
      edgePositions[i * 6 + 3] = this.nodePositions[target * 3];
      edgePositions[i * 6 + 4] = this.nodePositions[target * 3 + 1];
      edgePositions[i * 6 + 5] = this.nodePositions[target * 3 + 2];
      // Matching the endpoint's drift phase keeps edges welded to their nodes.
      edgePhases[i * 2] = this.nodePhases[source];
      edgePhases[i * 2 + 1] = this.nodePhases[target];
    }
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.BufferAttribute(edgePositions, 3));
    edgeGeometry.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(edgeCount * 6), 3));
    edgeGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(edgeCount * 2), 1));
    edgeGeometry.setAttribute("aPhase", new THREE.BufferAttribute(edgePhases, 1));
    this.edgeLines = new THREE.LineSegments(edgeGeometry, this.edgeMaterial);
    this.edgeLines.frustumCulled = false;
    this.edgeLines.renderOrder = 1;
    this.scene.add(this.edgeLines);

    // --- hub bloom (fixed membership, alpha varies with state)
    this.hubGlow = this.createGlowLayer(this.hubIndices.length);
    this.writeGlowPositions(this.hubGlow, this.hubIndices);
    this.scene.add(this.hubGlow);

    // --- focus bloom (selection + live activity; membership varies)
    this.focusGlow = this.createGlowLayer(FOCUS_GLOW_CAPACITY);
    this.focusGlow.geometry.setDrawRange(0, 0);
    this.scene.add(this.focusGlow);

    this.applyState();
  }

  private createGlowLayer(capacity: number): THREE.Points {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(Math.max(capacity, 1) * 3), 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(Math.max(capacity, 1) * 3), 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(Math.max(capacity, 1)), 1));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(Math.max(capacity, 1)), 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(new Float32Array(Math.max(capacity, 1)), 1));
    geometry.setAttribute("aPulse", new THREE.BufferAttribute(new Float32Array(Math.max(capacity, 1)), 1));
    const points = new THREE.Points(geometry, this.glowMaterial);
    points.frustumCulled = false;
    points.renderOrder = 2;
    return points;
  }

  private writeGlowPositions(layer: THREE.Points, indices: number[]): void {
    const position = layer.geometry.getAttribute("position") as THREE.BufferAttribute;
    const phase = layer.geometry.getAttribute("aPhase") as THREE.BufferAttribute;
    const array = position.array as Float32Array;
    const phaseArray = phase.array as Float32Array;
    const limit = Math.min(indices.length, array.length / 3);
    for (let i = 0; i < limit; i++) {
      const node = indices[i];
      array[i * 3] = this.nodePositions[node * 3];
      array[i * 3 + 1] = this.nodePositions[node * 3 + 1];
      array[i * 3 + 2] = this.nodePositions[node * 3 + 2];
      phaseArray[i] = this.nodePhases[node];
    }
    position.clearUpdateRanges();
    phase.clearUpdateRanges();
    position.needsUpdate = true;
    phase.needsUpdate = true;
    layer.geometry.setDrawRange(0, limit);
  }

  // -------------------------------------------------------------------------
  // Appearance
  // -------------------------------------------------------------------------

  setState(next: GlobeVisualState): void {
    const hoverChangedOnly =
      next.selectedId === this.state.selectedId &&
      next.litIds === this.state.litIds &&
      next.litColor === this.state.litColor &&
      next.lensClusterId === this.state.lensClusterId &&
      next.lensOnly === this.state.lensOnly &&
      next.pathNodeIds === this.state.pathNodeIds &&
      next.settings === this.state.settings &&
      next.hoveredId !== this.state.hoveredId;

    this.state = next;
    if (hoverChangedOnly) {
      this.applyHover();
      return;
    }
    this.applyState();
  }

  /** Nodes the lens keeps visible in Lens Only mode: cluster members plus
   * anything directly wired to one, so cross-lens dependencies survive. */
  private computeLensVisible(): Set<number> | null {
    const { lensOnly, lensClusterId } = this.state;
    if (!lensOnly || !lensClusterId) return null;
    const visible = new Set<number>();
    this.nodes.forEach((node, index) => {
      if (node.clusterId === lensClusterId) visible.add(index);
    });
    for (const edge of this.links) {
      if (visible.has(edge.source)) visible.add(edge.target);
      else if (visible.has(edge.target)) visible.add(edge.source);
    }
    return visible;
  }

  /** Full rewrite of every node and edge attribute from the current state.
   * Runs on deliberate changes (selection, lens, density, settings) — never
   * per frame, and never on hover. */
  private applyState(): void {
    if (!this.nodePoints || !this.edgeLines) return;
    const { selectedId, litIds, litColor, lensClusterId, settings } = this.state;
    const selectedIndex = selectedId ? this.nodeIndex.get(selectedId) ?? -1 : -1;
    this.lensVisible = this.computeLensVisible();
    this.pathIndices = (this.state.pathNodeIds ?? [])
      .map((id) => this.nodeIndex.get(id) ?? -1)
      .filter((index) => index >= 0);
    const pathSet = new Set(this.pathIndices);

    const selectedNeighbors = new Set<number>();
    if (selectedIndex >= 0) {
      selectedNeighbors.add(selectedIndex);
      for (const neighbor of this.neighbors[selectedIndex]) selectedNeighbors.add(neighbor);
    }

    const lit = new Set<number>();
    for (const id of litIds) {
      const index = this.nodeIndex.get(id);
      if (index !== undefined) lit.add(index);
    }

    const focusColor = this.scratchColorB.set(litColor).clone();
    const neutral = new THREE.Color(NEUTRAL_NODE);
    const hubBase = new THREE.Color(HUB_NODE);
    const lensAccent = new THREE.Color(LENS_ACCENT);
    const lensHub = new THREE.Color(LENS_HUB_NODE);
    const selectedColor = new THREE.Color(SELECTED_NODE);
    const relatedColor = new THREE.Color(RELATED_NODE);
    const density = Math.max(0, Math.min(1, settings.density));

    for (let index = 0; index < this.nodes.length; index++) {
      const node = this.nodes[index];
      const isHub = node.isHub === true;
      const inLens = lensClusterId !== null && node.clusterId === lensClusterId;
      const isSelected = index === selectedIndex;
      const isNeighbor = selectedNeighbors.has(index);
      const isLit = lit.has(index);
      const onPath = pathSet.has(index);
      const protectedNode = isHub || isSelected || isNeighbor || isLit || onPath;

      let alpha: number;
      let size = this.nodeRestSizes[index];
      let pulse = 0;

      if (this.lensVisible && !this.lensVisible.has(index)) {
        alpha = 0;
      } else if (!protectedNode && densityRank(node.id) > density) {
        // Thinned out by the density control — deterministically, so the same
        // dots come back when it goes up again.
        alpha = 0;
      } else {
        const cluster = this.scratchColor.set(clusterColor(node.clusterId));
        if (isHub) {
          this.scratchColor.copy(hubBase).lerp(cluster, 0.5);
          alpha = HUB_NODE_OPACITY;
        } else {
          // Leaves carry enough of their region's hue to make the regions
          // legible from a distance, without any of them turning saturated.
          this.scratchColor.copy(neutral).lerp(cluster, node.accent ? 0.8 : 0.58);
          alpha = normalNodeOpacity(node.id);
        }

        if (lensClusterId !== null) {
          if (inLens) {
            this.scratchColor.lerp(isHub ? lensHub : lensAccent, isHub ? 0.75 : 0.45);
            alpha = Math.min(1, alpha * 1.25);
          } else {
            alpha *= OUT_OF_LENS_DIM;
          }
        }

        if (isLit) {
          this.scratchColor.lerp(focusColor, 0.7);
          alpha = CONNECTED_NODE_OPACITY;
          pulse = 1;
        }

        if (onPath) {
          alpha = Math.max(alpha, 0.9);
          pulse = 1;
        }

        if (selectedIndex >= 0) {
          if (isSelected) {
            this.scratchColor.copy(selectedColor);
            alpha = 1;
            size = NODE_RADIUS.selected;
            pulse = 1;
          } else if (isNeighbor) {
            this.scratchColor.lerp(relatedColor, 0.7);
            alpha = Math.max(alpha, CONNECTED_NODE_OPACITY);
            size *= 1.3;
          } else if (!onPath) {
            // Unrelated graph dims but never disappears — context is the point.
            alpha *= 0.45;
          }
        }

        this.baseNodeColor[index * 3] = this.scratchColor.r;
        this.baseNodeColor[index * 3 + 1] = this.scratchColor.g;
        this.baseNodeColor[index * 3 + 2] = this.scratchColor.b;
      }

      this.baseNodeAlpha[index] = alpha;
      this.baseNodeSize[index] = size;
      this.baseNodePulse[index] = settings.animate ? pulse : 0;
    }

    this.writeEdgeAppearance(selectedIndex, lit, density);
    this.commitNodeAttributes();
    this.hoverSet.clear();
    this.applyHover();
    this.updateGlowLayers(selectedIndex, lit);
    this.updatePathLayer();

    if (this.edgeLines) this.edgeLines.visible = settings.showEdges;
    this.atmosphereUniforms.uStrength.value = settings.glow ? 0.42 : 0.14;
  }

  private writeEdgeAppearance(selectedIndex: number, lit: Set<number>, density: number): void {
    const { lensClusterId } = this.state;
    const base = new THREE.Color(EDGE_BASE_HEX);
    const lensEdge = new THREE.Color(EDGE_LENS_HEX);
    const litEdge = new THREE.Color(EDGE_LIT_HEX);
    const activeEdge = new THREE.Color(EDGE_ACTIVE_HEX);

    for (let i = 0; i < this.links.length; i++) {
      const edge = this.links[i];
      const sourceNode = this.nodes[edge.source];
      const targetNode = this.nodes[edge.target];
      const sourceHidden = this.baseNodeAlpha[edge.source] === 0;
      const targetHidden = this.baseNodeAlpha[edge.target] === 0;
      const touchesSelection = selectedIndex >= 0 && (edge.source === selectedIndex || edge.target === selectedIndex);
      const touchesLit = lit.has(edge.source) || lit.has(edge.target);

      let alpha = EDGE_BASE_ALPHA * (0.6 + edge.weight * 0.8);
      let color = base;

      if (sourceHidden || targetHidden) {
        alpha = 0;
      } else if (touchesSelection) {
        alpha = EDGE_LIT_ALPHA;
        color = litEdge;
      } else if (touchesLit) {
        alpha = EDGE_LIT_ALPHA * 0.55;
        color = activeEdge;
      } else if (lensClusterId !== null) {
        const sourceInLens = sourceNode.clusterId === lensClusterId;
        const targetInLens = targetNode.clusterId === lensClusterId;
        if (sourceInLens && targetInLens) {
          alpha = EDGE_LENS_ALPHA;
          color = lensEdge;
        } else if (sourceInLens || targetInLens) {
          // A cross-lens dependency: still legible, so the lens never looks
          // like an island.
          alpha = EDGE_BASE_ALPHA * 1.5;
          color = lensEdge;
        } else {
          alpha = EDGE_OUT_OF_LENS_ALPHA;
        }
      } else if (selectedIndex >= 0) {
        alpha *= 0.4;
      }

      if (alpha > 0) {
        // Thinning the field has to thin its edges too, or lowering density
        // just leaves a ball of wire.
        alpha *= 0.45 + 0.55 * density;
      }

      for (let v = 0; v < 2; v++) {
        this.baseEdgeColor[i * 6 + v * 3] = color.r;
        this.baseEdgeColor[i * 6 + v * 3 + 1] = color.g;
        this.baseEdgeColor[i * 6 + v * 3 + 2] = color.b;
        this.baseEdgeAlpha[i * 2 + v] = alpha;
      }
    }

    this.commitEdgeAttributes();
  }

  /** Hover is incremental: it only touches the hovered node, its neighbours
   * and their edges, so moving the pointer over a 100,000-edge graph doesn't
   * re-upload the whole buffer. */
  private applyHover(): void {
    if (!this.nodePoints || !this.edgeLines) return;
    const nodeAlpha = this.nodePoints.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const nodeSize = this.nodePoints.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const edgeAlpha = this.edgeLines.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const edgeColor = this.edgeLines.geometry.getAttribute("aColor") as THREE.BufferAttribute;

    const previous = this.hoverSet;
    const hoveredIndex = this.state.hoveredId ? this.nodeIndex.get(this.state.hoveredId) ?? -1 : -1;
    const next = new Set<number>();
    if (hoveredIndex >= 0 && this.baseNodeAlpha[hoveredIndex] > 0) {
      next.add(hoveredIndex);
      for (const neighbor of this.neighbors[hoveredIndex]) next.add(neighbor);
    }
    if (previous.size === 0 && next.size === 0) return;

    const litEdge = new THREE.Color(EDGE_LIT_HEX);
    const touchNode = (index: number, hovered: boolean, active: boolean) => {
      const baseAlpha = this.baseNodeAlpha[index];
      if (baseAlpha === 0) return;
      const alpha = active ? Math.max(baseAlpha, hovered ? 1 : 0.8) : baseAlpha;
      const size = this.baseNodeSize[index] * (active && hovered ? 1.45 : 1);
      (nodeAlpha.array as Float32Array)[index] = alpha;
      (nodeSize.array as Float32Array)[index] = size;
      nodeAlpha.addUpdateRange(index, 1);
      nodeSize.addUpdateRange(index, 1);
    };

    // Restore whatever the previous hover lit, then light the new set.
    for (const index of previous) if (!next.has(index)) touchNode(index, false, false);
    for (const index of next) touchNode(index, index === hoveredIndex, true);

    const touchEdges = (index: number, active: boolean) => {
      for (const edgeIndex of this.incident[index]) {
        const stored = this.baseEdgeAlpha[edgeIndex * 2];
        if (stored === 0) continue;
        const alpha = active ? Math.max(stored, EDGE_LIT_ALPHA * 0.8) : stored;
        for (let v = 0; v < 2; v++) {
          (edgeAlpha.array as Float32Array)[edgeIndex * 2 + v] = alpha;
          if (active) {
            (edgeColor.array as Float32Array)[edgeIndex * 6 + v * 3] = litEdge.r;
            (edgeColor.array as Float32Array)[edgeIndex * 6 + v * 3 + 1] = litEdge.g;
            (edgeColor.array as Float32Array)[edgeIndex * 6 + v * 3 + 2] = litEdge.b;
          } else {
            (edgeColor.array as Float32Array)[edgeIndex * 6 + v * 3] = this.baseEdgeColor[edgeIndex * 6 + v * 3];
            (edgeColor.array as Float32Array)[edgeIndex * 6 + v * 3 + 1] = this.baseEdgeColor[edgeIndex * 6 + v * 3 + 1];
            (edgeColor.array as Float32Array)[edgeIndex * 6 + v * 3 + 2] = this.baseEdgeColor[edgeIndex * 6 + v * 3 + 2];
          }
        }
        edgeAlpha.addUpdateRange(edgeIndex * 2, 2);
        edgeColor.addUpdateRange(edgeIndex * 6, 6);
      }
    };
    if (hoveredIndex < 0) {
      for (const index of previous) touchEdges(index, false);
    } else {
      for (const index of previous) if (!next.has(index)) touchEdges(index, false);
      touchEdges(hoveredIndex, true);
    }

    nodeAlpha.needsUpdate = true;
    nodeSize.needsUpdate = true;
    edgeAlpha.needsUpdate = true;
    edgeColor.needsUpdate = true;
    this.hoverSet = next;
  }

  private commitNodeAttributes(): void {
    if (!this.nodePoints) return;
    const pairs: Array<[string, Float32Array]> = [
      ["aColor", this.baseNodeColor],
      ["aSize", this.baseNodeSize],
      ["aAlpha", this.baseNodeAlpha],
      ["aPulse", this.baseNodePulse],
    ];
    for (const [name, source] of pairs) {
      const attribute = this.nodePoints.geometry.getAttribute(name) as THREE.BufferAttribute;
      (attribute.array as Float32Array).set(source);
      attribute.clearUpdateRanges();
      attribute.needsUpdate = true;
    }
  }

  private commitEdgeAttributes(): void {
    if (!this.edgeLines) return;
    const pairs: Array<[string, Float32Array]> = [
      ["aColor", this.baseEdgeColor],
      ["aAlpha", this.baseEdgeAlpha],
    ];
    for (const [name, source] of pairs) {
      const attribute = this.edgeLines.geometry.getAttribute(name) as THREE.BufferAttribute;
      (attribute.array as Float32Array).set(source);
      attribute.clearUpdateRanges();
      attribute.needsUpdate = true;
    }
  }

  private updateGlowLayers(selectedIndex: number, lit: Set<number>): void {
    const { settings, lensClusterId } = this.state;
    const glowOn = settings.glow;

    if (this.hubGlow) {
      const geometry = this.hubGlow.geometry;
      const color = geometry.getAttribute("aColor") as THREE.BufferAttribute;
      const size = geometry.getAttribute("aSize") as THREE.BufferAttribute;
      const alpha = geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
      const scratch = new THREE.Color();
      this.hubIndices.forEach((nodeIndex, i) => {
        const node = this.nodes[nodeIndex];
        const inLens = lensClusterId !== null && node.clusterId === lensClusterId;
        scratch.set(clusterColor(node.clusterId));
        if (inLens) scratch.lerp(new THREE.Color(LENS_ACCENT), 0.5);
        (color.array as Float32Array)[i * 3] = scratch.r;
        (color.array as Float32Array)[i * 3 + 1] = scratch.g;
        (color.array as Float32Array)[i * 3 + 2] = scratch.b;
        const major = node.val >= 6;
        (size.array as Float32Array)[i] = NODE_RADIUS.hub * HUB_GLOW_SCALE * (major ? 2.1 : 1);
        const hidden = this.baseNodeAlpha[nodeIndex] === 0;
        let value = hidden || !glowOn ? 0 : major ? 0.3 : 0.13;
        if (inLens) value *= 2.1;
        else if (lensClusterId !== null) value *= 0.35;
        (alpha.array as Float32Array)[i] = value;
      });
      color.clearUpdateRanges();
      size.clearUpdateRanges();
      alpha.clearUpdateRanges();
      color.needsUpdate = true;
      size.needsUpdate = true;
      alpha.needsUpdate = true;
    }

    if (this.focusGlow) {
      const geometry = this.focusGlow.geometry;
      const position = geometry.getAttribute("position") as THREE.BufferAttribute;
      const color = geometry.getAttribute("aColor") as THREE.BufferAttribute;
      const size = geometry.getAttribute("aSize") as THREE.BufferAttribute;
      const alpha = geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
      const phase = geometry.getAttribute("aPhase") as THREE.BufferAttribute;
      const pulse = geometry.getAttribute("aPulse") as THREE.BufferAttribute;
      const entries: Array<{ index: number; color: string; size: number; alpha: number; pulse: number }> = [];
      if (selectedIndex >= 0) {
        entries.push({
          index: selectedIndex,
          color: SELECTED_GLOW,
          size: NODE_RADIUS.selected * 16,
          alpha: glowOn ? 0.55 : 0.28,
          pulse: 1,
        });
      }
      for (const index of lit) {
        if (entries.length >= FOCUS_GLOW_CAPACITY) break;
        if (index === selectedIndex) continue;
        entries.push({
          index,
          color: this.state.litColor,
          size: NODE_RADIUS.hub * 7,
          alpha: glowOn ? 0.3 : 0.14,
          pulse: 1,
        });
      }
      const scratch = new THREE.Color();
      entries.forEach((entry, i) => {
        (position.array as Float32Array)[i * 3] = this.nodePositions[entry.index * 3];
        (position.array as Float32Array)[i * 3 + 1] = this.nodePositions[entry.index * 3 + 1];
        (position.array as Float32Array)[i * 3 + 2] = this.nodePositions[entry.index * 3 + 2];
        scratch.set(entry.color);
        (color.array as Float32Array)[i * 3] = scratch.r;
        (color.array as Float32Array)[i * 3 + 1] = scratch.g;
        (color.array as Float32Array)[i * 3 + 2] = scratch.b;
        (size.array as Float32Array)[i] = entry.size;
        (alpha.array as Float32Array)[i] = entry.alpha;
        (phase.array as Float32Array)[i] = this.nodePhases[entry.index];
        (pulse.array as Float32Array)[i] = this.state.settings.animate ? entry.pulse : 0;
      });
      for (const attribute of [position, color, size, alpha, phase, pulse]) {
        attribute.clearUpdateRanges();
        attribute.needsUpdate = true;
      }
      geometry.setDrawRange(0, entries.length);
    }
  }

  /** The active route gets its own layer so only it animates. */
  private updatePathLayer(): void {
    if (this.pathLines) {
      this.scene.remove(this.pathLines);
      this.pathLines.geometry.dispose();
      this.pathLines = null;
    }
    const indices = this.pathIndices;
    if (indices.length < 2 || !this.state.settings.animate) return;

    const segments = indices.length - 1;
    const positions = new Float32Array(segments * 6);
    const colors = new Float32Array(segments * 6);
    const alphas = new Float32Array(segments * 2);
    const phases = new Float32Array(segments * 2);
    const arcs = new Float32Array(segments * 2);
    const color = new THREE.Color(LENS_ACCENT);

    // Arc length is measured in real distance so the pulse travels at an even
    // speed rather than jumping across long strands.
    const lengths: number[] = [];
    let total = 0;
    for (let i = 0; i < segments; i++) {
      const a = indices[i];
      const b = indices[i + 1];
      const length = Math.hypot(
        this.nodePositions[b * 3] - this.nodePositions[a * 3],
        this.nodePositions[b * 3 + 1] - this.nodePositions[a * 3 + 1],
        this.nodePositions[b * 3 + 2] - this.nodePositions[a * 3 + 2],
      );
      lengths.push(length);
      total += length;
    }
    let travelled = 0;
    for (let i = 0; i < segments; i++) {
      const a = indices[i];
      const b = indices[i + 1];
      positions[i * 6] = this.nodePositions[a * 3];
      positions[i * 6 + 1] = this.nodePositions[a * 3 + 1];
      positions[i * 6 + 2] = this.nodePositions[a * 3 + 2];
      positions[i * 6 + 3] = this.nodePositions[b * 3];
      positions[i * 6 + 4] = this.nodePositions[b * 3 + 1];
      positions[i * 6 + 5] = this.nodePositions[b * 3 + 2];
      arcs[i * 2] = total > 0 ? travelled / total : 0;
      travelled += lengths[i];
      arcs[i * 2 + 1] = total > 0 ? travelled / total : 1;
      phases[i * 2] = this.nodePhases[a];
      phases[i * 2 + 1] = this.nodePhases[b];
      for (let v = 0; v < 2; v++) {
        colors[i * 6 + v * 3] = color.r;
        colors[i * 6 + v * 3 + 1] = color.g;
        colors[i * 6 + v * 3 + 2] = color.b;
        alphas[i * 2 + v] = 0.5;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute("aArc", new THREE.BufferAttribute(arcs, 1));
    this.pathLines = new THREE.LineSegments(geometry, this.pathMaterial);
    this.pathLines.frustumCulled = false;
    this.pathLines.renderOrder = 4;
    this.scene.add(this.pathLines);
  }

  // -------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------

  /** Distance at which the whole globe is framed with a little margin. */
  private defaultDistance(): number {
    const vertical = Math.sin((this.camera?.fov ?? 45) * 0.5 * (Math.PI / 180)) || 0.38;
    const horizontal = vertical * Math.max(this.camera?.aspect ?? 1, 0.35);
    return (GLOBE_RADIUS * 1.16) / Math.min(vertical, horizontal);
  }

  resetView(animate = true): void {
    const position = DEFAULT_VIEW_DIRECTION.clone().multiplyScalar(this.defaultDistance());
    this.moveCamera(position, new THREE.Vector3(0, 0, 0), animate);
  }

  zoomBy(factor: number): void {
    const target = this.controls.target.clone();
    const offset = this.camera.position.clone().sub(target);
    const distance = THREE.MathUtils.clamp(
      offset.length() * factor,
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    this.moveCamera(target.clone().add(offset.setLength(distance)), target, true, 420);
  }

  focusNode(id: string, animate = true): void {
    const index = this.nodeIndex.get(id);
    if (index === undefined) return;
    const node = new THREE.Vector3(
      this.nodePositions[index * 3],
      this.nodePositions[index * 3 + 1],
      this.nodePositions[index * 3 + 2],
    );
    const depth = node.length() / GLOBE_RADIUS;
    // Deep nodes are framed by the whole globe; nodes out on the shell earn a
    // closer look. Either way the surroundings stay in shot.
    const distance = THREE.MathUtils.lerp(this.defaultDistance(), GLOBE_RADIUS * 0.85, Math.min(depth, 1));

    const current = this.camera.position.clone().sub(this.controls.target);
    let direction = current.lengthSq() > 0 ? current.normalize() : DEFAULT_VIEW_DIRECTION.clone();
    if (depth > 0.25) {
      // Square up part of the way toward the node's own outward normal, so the
      // camera turns toward what you picked without yanking the view around.
      direction = direction.lerp(node.clone().normalize(), 0.5).normalize();
    }
    this.moveCamera(node.clone().add(direction.multiplyScalar(distance)), node, animate);
  }

  focusRegion(target: { x: number; y: number; z: number }, animate = true): void {
    const anchor = new THREE.Vector3(target.x, target.y, target.z);
    const distance = GLOBE_RADIUS * 1.5;
    const direction = anchor.lengthSq() > 0 ? anchor.clone().normalize() : DEFAULT_VIEW_DIRECTION.clone();
    this.moveCamera(anchor.clone().add(direction.multiplyScalar(distance)), anchor, animate);
  }

  getCameraState(): GlobeCameraState {
    return {
      position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      lookAt: { x: this.controls.target.x, y: this.controls.target.y, z: this.controls.target.z },
    };
  }

  /** Restore a persisted camera, ignoring anything that couldn't frame this
   * globe (a position saved under a different layout scale). */
  restoreCamera(camera: GlobeCameraState | null): boolean {
    if (!camera) return false;
    const distance = Math.hypot(camera.position.x, camera.position.y, camera.position.z);
    if (!Number.isFinite(distance) || distance < GLOBE_RADIUS * 0.1 || distance > GLOBE_RADIUS * 8) return false;
    this.camera.position.set(camera.position.x, camera.position.y, camera.position.z);
    this.controls.target.set(camera.lookAt.x, camera.lookAt.y, camera.lookAt.z);
    this.controls.update();
    return true;
  }

  private moveCamera(position: THREE.Vector3, target: THREE.Vector3, animate: boolean, duration = CAMERA_TWEEN_MS): void {
    if (!animate || this.reducedMotion) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      this.scheduleSettle();
      return;
    }
    this.tween = {
      fromPosition: this.camera.position.clone(),
      toPosition: position,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      start: performance.now(),
      duration,
    };
    this.controls.enabled = false;
  }

  private scheduleSettle(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.callbacks.onCameraSettled?.(this.getCameraState());
    }, 400);
  }

  // -------------------------------------------------------------------------
  // Projection & picking
  // -------------------------------------------------------------------------

  private project(x: number, y: number, z: number, out: ProjectedPoint): ProjectedPoint {
    this.scratchVector.set(x, y, z);
    const distance = this.camera.position.distanceTo(this.scratchVector);
    this.scratchVector.applyMatrix4(this.viewProjection);
    const behind = this.scratchVector.z < -1 || this.scratchVector.z > 1;
    out.x = (this.scratchVector.x * 0.5 + 0.5) * this.width;
    out.y = (0.5 - this.scratchVector.y * 0.5) * this.height;
    out.distance = distance;
    out.onScreen =
      !behind && out.x >= -80 && out.x <= this.width + 80 && out.y >= -40 && out.y <= this.height + 40;
    return out;
  }

  private facesCamera(nx: number, ny: number, nz: number): boolean {
    const cameraDirection = this.camera.position.clone().normalize();
    return nx * cameraDirection.x + ny * cameraDirection.y + nz * cameraDirection.z > -0.12;
  }

  /** Direct neighbours of a node, in a stable order — arrow-key navigation
   * walks this so repeated presses are predictable. */
  neighborIdsOf(id: string): string[] {
    const index = this.nodeIndex.get(id);
    if (index === undefined) return [];
    const seen = new Set<string>();
    for (const neighbor of this.neighbors[index]) seen.add(this.nodes[neighbor].id);
    return [...seen].sort();
  }

  /** The first hub in the graph, used as a sensible starting point when the
   * operator reaches for the arrow keys before selecting anything. */
  firstHubId(): string | null {
    const index = this.hubIndices[0];
    return index === undefined ? null : this.nodes[index].id;
  }

  private nodePosition(id: string): { x: number; y: number; z: number } | null {
    const index = this.nodeIndex.get(id);
    if (index === undefined) return null;
    return {
      x: this.nodePositions[index * 3],
      y: this.nodePositions[index * 3 + 1],
      z: this.nodePositions[index * 3 + 2],
    };
  }

  /**
   * Screen-space nearest-node pick. Cheaper and more forgiving than
   * raycasting a scene full of proxy meshes: the dust field is a single
   * Points object, and a 1px dot needs a bigger hit area than its own
   * geometry anyway. Hidden nodes (thinned by density, filtered out by Lens
   * Only) are never pickable — you can't select what you can't see.
   */
  pick(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const elements = this.viewProjection.elements;
    const screenScale = this.nodeUniforms.uScreenScale.value;

    let bestIndex = -1;
    let bestScore = Infinity;
    for (let index = 0; index < this.nodes.length; index++) {
      if (this.baseNodeAlpha[index] <= 0.01) continue;
      const x = this.nodePositions[index * 3];
      const y = this.nodePositions[index * 3 + 1];
      const z = this.nodePositions[index * 3 + 2];
      const w = elements[3] * x + elements[7] * y + elements[11] * z + elements[15];
      if (w <= 0) continue;
      const ndcX = (elements[0] * x + elements[4] * y + elements[8] * z + elements[12]) / w;
      const ndcY = (elements[1] * x + elements[5] * y + elements[9] * z + elements[13]) / w;
      const sx = (ndcX * 0.5 + 0.5) * this.width;
      const sy = (0.5 - ndcY * 0.5) * this.height;
      const dx = sx - px;
      const dy = sy - py;
      const distance2 = dx * dx + dy * dy;
      const drawn = Math.min(26, (this.baseNodeSize[index] * screenScale) / Math.max(w, 1));
      const reach = drawn + 7;
      if (distance2 > reach * reach) continue;
      // Hubs win ties: at a distance their bloom is what the operator is
      // actually aiming at.
      const score = distance2 - (this.nodes[index].isHub ? 90 : 0);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    return bestIndex >= 0 ? this.nodes[bestIndex].id : null;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  addFrameListener(listener: (api: GlobeFrameApi) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // World radius -> pixels for this viewport, so a node's size means the
    // same thing at any window size.
    const screenScale = height * this.camera.projectionMatrix.elements[5];
    this.nodeUniforms.uScreenScale.value = screenScale;
    this.glowUniforms.uScreenScale.value = screenScale;
    this.starUniforms.uScreenScale.value = screenScale;
    this.frameApi.width = width;
    this.frameApi.height = height;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clockStart = performance.now();
    const loop = () => {
      if (!this.running) return;
      this.frame = requestAnimationFrame(loop);
      this.renderFrame();
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private renderFrame(): void {
    const now = performance.now();
    const seconds = (now - this.clockStart) / 1000;
    const { settings } = this.state;
    const animate = settings.animate && !this.reducedMotion;

    if (this.tween) {
      const t = Math.min(1, (now - this.tween.start) / this.tween.duration);
      const eased = easeInOutCubic(t);
      this.camera.position.lerpVectors(this.tween.fromPosition, this.tween.toPosition, eased);
      this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, eased);
      this.controls.update();
      if (t >= 1) {
        this.tween = null;
        this.controls.enabled = true;
        this.scheduleSettle();
      }
    } else {
      this.controls.update();
    }

    const distance = this.camera.position.length();
    // Fog is pinned to how far away the camera is, so the far side of the
    // globe recedes the same amount whether you're framing the planet or one
    // region.
    const strength = settings.depthFog ? FOG.strength : 0;
    const near = distance * FOG.near;
    const far = distance * FOG.far;
    for (const uniforms of [
      this.nodeUniforms,
      this.glowUniforms,
      this.edgeUniforms,
      this.scaffoldUniforms,
      this.pathUniforms,
    ]) {
      uniforms.uTime.value = seconds;
      uniforms.uDrift.value = animate ? 1.6 : 0;
      uniforms.uFogNear.value = near;
      uniforms.uFogFar.value = far;
      uniforms.uFogStrength.value = strength;
    }
    this.starUniforms.uTime.value = seconds;
    this.nodeUniforms.uPulse.value = animate ? 1 : 0;
    this.glowUniforms.uPulse.value = animate ? 1 : 0;

    const zoomLevel = zoomLevelFor(ZOOM_REFERENCE_DISTANCE / Math.max(distance, 1));
    if (zoomLevel !== this.lastZoomLevel) {
      this.lastZoomLevel = zoomLevel;
      this.callbacks.onZoomLevel?.(zoomLevel);
    }

    this.camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frameApi.cameraDistance = distance;
    this.frameApi.zoomLevel = zoomLevel;
    for (const listener of this.frameListeners) listener(this.frameApi);

    this.renderer.render(this.scene, this.camera);
  }

  private disposeGraphLayers(): void {
    for (const object of [this.nodePoints, this.edgeLines, this.hubGlow, this.focusGlow, this.pathLines]) {
      if (!object) continue;
      this.scene.remove(object);
      object.geometry.dispose();
    }
    this.nodePoints = null;
    this.edgeLines = null;
    this.hubGlow = null;
    this.focusGlow = null;
    this.pathLines = null;
  }

  dispose(): void {
    this.stop();
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.frameListeners.clear();
    this.disposeGraphLayers();
    this.controls.dispose();
    for (const disposable of this.disposables) disposable.dispose();
    this.scene.clear();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
