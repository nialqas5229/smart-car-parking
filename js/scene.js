/**
 * js/scene.js
 * Manages the Three.js 3D world, symmetric parking lot builder, GLTF car loader,
 * auto-normalization, material recoloring, and smooth enter/exit animations.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SmartParking } from './parking.js';

// Easy-to-read configuration object for a university student
export const CONFIG = {
  // Change this one number (e.g. 90, 180, -90) if your car.glb faces the wrong way
  CAR_YAW_OFFSET_DEGREES: 0,

  // Slot and road dimensions in 3D world units (meters)
  SLOT_WIDTH: 3.4,
  SLOT_LENGTH: 5.8,
  SLOT_GAP: 0.45,
  ROAD_WIDTH: 7.2,

  // Car length will be scaled to 70% of a slot's length
  CAR_LENGTH_RATIO: 0.70,

  // Animation speeds
  DRIVE_SPEED: 8.5, // units per second on the road
  PARK_TURN_DURATION: 1.2, // seconds to turn smoothly into/out of a slot
  GATE_OPEN_DURATION: 0.35, // seconds to lift the barrier arm
  HIGHLIGHT_DURATION: 1.6, // seconds to pulse a newly parked slot

  // Curated bright color palette for cars (never dark)
  PALETTE: [
    '#2ec4b6', // Teal
    '#ff6b6b', // Coral Red
    '#ffd166', // Sunny Yellow
    '#4cc9f0', // Sky Blue
    '#f72585', // Vibrant Pink
    '#a8eb12', // Lime Green
    '#ff9f1c', // Bright Orange
    '#b5179e', // Purple Magenta
    '#06d6a0', // Mint Emerald
    '#60a5fa', // Soft Blue
    '#f472b6', // Rose Pink
    '#fbbf24'  // Amber Gold
  ]
};

export class ParkingScene {
  /**
   * @param {HTMLElement} container - The DOM element that holds the Three.js canvas
   */
  constructor(container) {
    this.container = container;

    // Core Three.js objects
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.clock = new THREE.Clock();

    // Groups to organize 3D objects cleanly
    this.lotGroup = new THREE.Group();
    this.carsGroup = new THREE.Group();

    // Loaded car template and fallback flag
    this.carTemplate = null;
    this.usingFallbackModel = false;
    this.colorCounter = 0;

    // Slot metadata map: parkingID -> { id, row, indexInRow, x, z, entryZ, facingYaw, frameMesh, labelSprite, state }
    this.slots = new Map();

    // Active parked car 3D objects: carID -> { group, slotId, color }
    this.carObjects = new Map();

    // Gate barrier meshes for smooth opening/closing
    this.entryBarrierPivot = null;
    this.exitBarrierPivot = null;
    this.entryGateX = -10;
    this.exitGateX = 10;
    this.lotWidth = 24;
    this.lotDepth = 20;

    // Active animation tasks updated every frame with delta time
    this.activeAnimations = [];
    this.cameraFocusAnim = null;
    this.cameraFocusResolve = null;
    this.onCarClicked = null;
    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.pointerDown = null;

    this.initWorld();
  }

  /**
   * Sets up the scene, renderer, camera, lights, sky tone, and resize listener.
   */
  initWorld() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0c131c');
    this.scene.fog = new THREE.FogExp2('#0c131c', 0.008);

    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 500;

    // Perspective camera at a tilted isometric-like angle
    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.5, 350);
    this.camera.position.set(0, 28, 32);

    // WebGL Renderer with soft shadows and pixel ratio capped at 2
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // OrbitControls with damping, zoom limits, panning, and vertical angle limit
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 140;
    // Never allow camera to go below the ground plane
    this.controls.maxPolarAngle = Math.PI / 2 - 0.06;
    this.controls.minPolarAngle = 0.15;
    this.renderer.domElement.addEventListener('pointerdown', (event) => {
      this.pointerDown = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    });
    this.renderer.domElement.addEventListener('pointermove', (event) => {
      if (!this.pointerDown || this.pointerDown.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y) > 7) this.pointerDown.moved = true;
    });
    this.renderer.domElement.addEventListener('pointerup', (event) => {
      const down = this.pointerDown;
      this.pointerDown = null;
      if (!down || down.id !== event.pointerId || down.moved) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointerNdc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      const hit = this.raycaster.intersectObjects(this.carsGroup.children, true).find((item) => this.findCarId(item.object));
      const carID = hit && this.findCarId(hit.object);
      if (carID && this.onCarClicked) this.onCarClicked(carID);
    });

    // Ambient and Directional lighting for soft shadows and glossy car paint
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.85);
    hemiLight.position.set(0, 50, 0);
    this.scene.add(hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.35);
    this.dirLight.position.set(22, 38, 24);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 2;
    this.dirLight.shadow.camera.far = 140;
    this.dirLight.shadow.bias = -0.0005;
    this.scene.add(this.dirLight);

    const fillLight = new THREE.DirectionalLight(0x2ec4b6, 0.35);
    fillLight.position.set(-25, 18, -20);
    this.scene.add(fillLight);

    this.scene.add(this.lotGroup);
    this.scene.add(this.carsGroup);

    // Handle window and container resize
    window.addEventListener('resize', () => this.handleResize());
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.handleResize());
      ro.observe(this.container);
    }

    // Start the render loop
    this.animate();
  }

  findCarId(object) {
    let node = object;
    while (node && node !== this.carsGroup) {
      if (node.userData.carID) return node.userData.carID;
      node = node.parent;
    }
    return null;
  }

  /**
   * Loads assets/car.glb once using GLTFLoader, normalizes its bounding box,
   * aligns its longest horizontal axis along local +Z, and centers its base at Y=0.
   * If loading fails, creates a clean stylized fallback car and sets usingFallbackModel = true.
   *
   * @returns {Promise<{ usingFallback: boolean }>}
   */
  async loadCarModel() {
    const loader = new GLTFLoader();

    try {
      const gltf = await new Promise((resolve, reject) => {
        loader.load(
          'assets/car.glb',
          (data) => resolve(data),
          undefined,
          (err) => reject(err)
        );
      });

      const rawModel = gltf.scene || gltf.scenes[0];
      this.carTemplate = this.normalizeLoadedCar(rawModel);
      this.usingFallbackModel = false;
      return { usingFallback: false };
    } catch (err) {
      console.warn('assets/car.glb could not be loaded. Using built-in 3D fallback car.', err);
      this.carTemplate = this.createFallbackCarTemplate();
      this.usingFallbackModel = true;
      return { usingFallback: true };
    }
  }

  /**
   * Auto-normalizes the loaded GLTF model:
   * 1. Detects the longest horizontal axis (X or Z) and rotates so forward is local +Z.
   * 2. Applies CONFIG.CAR_YAW_OFFSET_DEGREES so a reversed model can be fixed with one number.
   * 3. Scales the model uniformly so its length is CONFIG.CAR_LENGTH_RATIO (70%) of a slot's length.
   * 4. Centers X and Z at 0, and places the bottom of the tires at Y = 0.
   *
   * @param {THREE.Object3D} rawModel
   * @returns {THREE.Group}
   */
  normalizeLoadedCar(rawModel) {
    rawModel.updateMatrixWorld(true);
    const initialBox = new THREE.Box3().setFromObject(rawModel);
    const initialSize = new THREE.Vector3();
    initialBox.getSize(initialSize);

    // Pivot group that holds the oriented mesh
    const orientedGroup = new THREE.Group();
    orientedGroup.add(rawModel);

    // If the car's horizontal X dimension is longer than Z, rotate 90 degrees so length is along Z
    let autoYaw = 0;
    if (initialSize.x > initialSize.z) {
      autoYaw = Math.PI / 2;
    }
    const userOffsetRad = THREE.MathUtils.degToRad(CONFIG.CAR_YAW_OFFSET_DEGREES);
    rawModel.rotation.y += autoYaw + userOffsetRad;

    orientedGroup.updateMatrixWorld(true);
    const rotatedBox = new THREE.Box3().setFromObject(orientedGroup);
    const rotatedSize = new THREE.Vector3();
    rotatedBox.getSize(rotatedSize);

    const horizontalLength = Math.max(rotatedSize.x, rotatedSize.z, 0.001);
    const targetLength = CONFIG.SLOT_LENGTH * CONFIG.CAR_LENGTH_RATIO;
    const scaleFactor = targetLength / horizontalLength;

    orientedGroup.scale.setScalar(scaleFactor);
    orientedGroup.updateMatrixWorld(true);

    // Recompute bounding box after scaling so we can center X/Z and sit bottom on Y=0
    const finalBox = new THREE.Box3().setFromObject(orientedGroup);
    const finalCenter = new THREE.Vector3();
    finalBox.getCenter(finalCenter);

    orientedGroup.position.x -= finalCenter.x;
    orientedGroup.position.z -= finalCenter.z;
    orientedGroup.position.y -= finalBox.min.y;

    // Enable shadows on all child meshes
    orientedGroup.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    const wrapper = new THREE.Group();
    wrapper.add(orientedGroup);
    return wrapper;
  }

  /**
   * Builds a fallback 3D box-shaped car when assets/car.glb is absent.
   * Includes named 'CarBodyPaint', 'CabinGlass', 'WheelTire', and 'Headlight' materials
   * so the exact same material recoloring logic works seamlessly.
   *
   * @returns {THREE.Group}
   */
  createFallbackCarTemplate() {
    const carRoot = new THREE.Group();

    const paintMat = new THREE.MeshStandardMaterial({
      name: 'CarBodyPaint',
      color: 0x2ec4b6,
      metalness: 0.45,
      roughness: 0.28
    });

    const glassMat = new THREE.MeshStandardMaterial({
      name: 'CabinWindowGlass',
      color: 0x1e293b,
      metalness: 0.8,
      roughness: 0.15
    });

    const tireMat = new THREE.MeshStandardMaterial({
      name: 'WheelTireRubber',
      color: 0x111827,
      metalness: 0.1,
      roughness: 0.85
    });

    const headLightMat = new THREE.MeshStandardMaterial({
      name: 'FrontHeadLight',
      color: 0xfef08a,
      emissive: 0xfef08a,
      emissiveIntensity: 0.45
    });

    const tailLightMat = new THREE.MeshStandardMaterial({
      name: 'RearTailLamp',
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 0.35
    });

    // Lower chassis
    const bodyGeo = new THREE.BoxGeometry(1.85, 0.62, 4.0);
    const bodyMesh = new THREE.Mesh(bodyGeo, paintMat);
    bodyMesh.position.y = 0.56;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    carRoot.add(bodyMesh);

    // Upper cabin paint roof
    const cabinGeo = new THREE.BoxGeometry(1.58, 0.52, 2.15);
    const cabinMesh = new THREE.Mesh(cabinGeo, paintMat);
    cabinMesh.position.set(0, 1.1, -0.15);
    cabinMesh.castShadow = true;
    cabinMesh.receiveShadow = true;
    carRoot.add(cabinMesh);

    // Windshield / windows band
    const glassGeo = new THREE.BoxGeometry(1.62, 0.42, 2.2);
    const glassMesh = new THREE.Mesh(glassGeo, glassMat);
    glassMesh.position.set(0, 1.08, -0.15);
    carRoot.add(glassMesh);

    // Four wheels
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 20);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelPositions = [
      [-0.92, 0.36, 1.25],
      [0.92, 0.36, 1.25],
      [-0.92, 0.36, -1.25],
      [0.92, 0.36, -1.25]
    ];
    for (const [wx, wy, wz] of wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeo, tireMat);
      wheel.position.set(wx, wy, wz);
      wheel.castShadow = true;
      carRoot.add(wheel);
    }

    // Headlights (front is +Z)
    const lampGeo = new THREE.BoxGeometry(0.34, 0.16, 0.08);
    const leftHead = new THREE.Mesh(lampGeo, headLightMat);
    leftHead.position.set(-0.6, 0.62, 2.01);
    const rightHead = new THREE.Mesh(lampGeo, headLightMat);
    rightHead.position.set(0.6, 0.62, 2.01);
    carRoot.add(leftHead, rightHead);

    // Taillights (back is -Z)
    const leftTail = new THREE.Mesh(lampGeo, tailLightMat);
    leftTail.position.set(-0.6, 0.64, -2.01);
    const rightTail = new THREE.Mesh(lampGeo, tailLightMat);
    rightTail.position.set(0.6, 0.64, -2.01);
    carRoot.add(leftTail, rightTail);

    return this.normalizeLoadedCar(carRoot);
  }

  /**
   * Clones the normalized car template, clones all materials so cars never share material instances,
   * and recolors only the body paint materials according to the specification rules.
   *
   * @param {string} hexColor
   * @returns {THREE.Group}
   */
  createCarInstance(hexColor) {
    const clone = this.carTemplate.clone(true);
    const threeColor = new THREE.Color(hexColor);

    const includeRegex = /body|paint|carpaint|exterior/i;
    const excludeRegex = /glass|window|tire|tyre|wheel|rubber|light|lamp|chrome|interior/i;

    const matchedMaterials = [];
    let largestMesh = null;
    let largestVolume = -1;

    // Step 1: Clone materials per mesh and look for matching paint material names
    clone.traverse((node) => {
      if (!node.isMesh || !node.material) return;

      // Clone material(s) so each car has its own independent materials
      if (Array.isArray(node.material)) {
        node.material = node.material.map((mat) => mat.clone());
      } else {
        node.material = node.material.clone();
      }

      // Compute mesh bounding box volume in case we need the fallback largest mesh
      if (node.geometry) {
        if (!node.geometry.boundingBox) {
          node.geometry.computeBoundingBox();
        }
        const bb = node.geometry.boundingBox;
        const size = new THREE.Vector3();
        bb.getSize(size);
        const vol = size.x * size.y * size.z;
        if (vol > largestVolume) {
          largestVolume = vol;
          largestMesh = node;
        }
      }

      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of materials) {
        const matName = mat.name || node.name || '';
        if (includeRegex.test(matName) && !excludeRegex.test(matName)) {
          matchedMaterials.push(mat);
        }
      }
    });

    // Step 2: Recolor matched body materials, or fallback to largest mesh's non-excluded material
    if (matchedMaterials.length > 0) {
      for (const mat of matchedMaterials) {
        this.applyGlossyPaint(mat, threeColor);
      }
    } else if (largestMesh && largestMesh.material) {
      const mats = Array.isArray(largestMesh.material)
        ? largestMesh.material
        : [largestMesh.material];
      for (const mat of mats) {
        if (!excludeRegex.test(mat.name || '')) {
          this.applyGlossyPaint(mat, threeColor);
        }
      }
    }

    return clone;
  }

  /**
   * Applies the target color to a material while keeping glossy metalness/roughness.
   * @param {THREE.Material} material
   * @param {THREE.Color} threeColor
   */
  applyGlossyPaint(material, threeColor) {
    if (material.color) {
      material.color.copy(threeColor);
    }
    if ('metalness' in material) {
      material.metalness = Math.max(material.metalness ?? 0.4, 0.35);
    }
    if ('roughness' in material) {
      material.roughness = Math.min(material.roughness ?? 0.3, 0.35);
    }
    material.needsUpdate = true;
  }

  /**
   * Generates a unique bright color that is not currently used by any parked car.
   * Uses the curated palette first, then golden-angle HSL colors.
   *
   * @param {string[]} usedColors
   * @returns {string}
   */
  pickUniqueCarColor(usedColors = []) {
    const usedSet = new Set(usedColors.map((c) => c.toLowerCase()));

    // First try the curated bright palette
    for (const color of CONFIG.PALETTE) {
      if (!usedSet.has(color.toLowerCase())) {
        return color;
      }
    }

    // Fallback: Golden-angle HSL colors with high saturation and bright lightness
    let attempt = this.colorCounter++;
    while (attempt < 500) {
      const hue = Math.round((attempt * 137.508) % 360);
      const threeCol = new THREE.Color().setHSL(hue / 360, 0.82, 0.58);
      const hex = `#${threeCol.getHexString()}`;
      if (!usedSet.has(hex.toLowerCase())) {
        return hex;
      }
      attempt++;
    }

    return '#2ec4b6';
  }

  /**
   * Builds the entire 3D parking lot symmetrically from the capacity (1 to 40).
   * Top row gets ceil(N/2) slots, bottom row gets floor(N/2) slots, both centered on X = 0.
   * Numbered P-01, P-02, ... left to right on the top row first, then bottom row.
   *
   * @param {number} capacity
   */
  buildParkingLot(capacity) {
    this.clearSceneObjects();

    const topCount = Math.ceil(capacity / 2);
    const bottomCount = Math.floor(capacity / 2);
    const maxColumns = Math.max(topCount, 1);

    const stepX = CONFIG.SLOT_WIDTH + CONFIG.SLOT_GAP;
    const rowSpanWidth = maxColumns * stepX;

    this.lotWidth = Math.max(rowSpanWidth + 14, 22);
    this.lotDepth = CONFIG.ROAD_WIDTH + CONFIG.SLOT_LENGTH * 2 + 8;

    // 1. Surrounding ground skirt
    const outerGroundGeo = new THREE.PlaneGeometry(this.lotWidth + 40, this.lotDepth + 40);
    const outerGroundMat = new THREE.MeshStandardMaterial({
      color: 0x0f1720,
      roughness: 0.95,
      metalness: 0.05
    });
    const outerGround = new THREE.Mesh(outerGroundGeo, outerGroundMat);
    outerGround.rotation.x = -Math.PI / 2;
    outerGround.position.y = -0.04;
    outerGround.receiveShadow = true;
    this.lotGroup.add(outerGround);

    // 2. Main asphalt pad
    const asphaltGeo = new THREE.BoxGeometry(this.lotWidth, 0.12, this.lotDepth);
    const asphaltMat = new THREE.MeshStandardMaterial({
      color: 0x1c2632,
      roughness: 0.88,
      metalness: 0.08
    });
    const asphaltMesh = new THREE.Mesh(asphaltGeo, asphaltMat);
    asphaltMesh.position.y = -0.06;
    asphaltMesh.receiveShadow = true;
    this.lotGroup.add(asphaltMesh);

    // 3. Center road strip with yellow dashed center line
    const roadLength = this.lotWidth - 2;
    const roadGeo = new THREE.PlaneGeometry(roadLength, CONFIG.ROAD_WIDTH);
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x141d26,
      roughness: 0.85
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.rotation.x = -Math.PI / 2;
    roadMesh.position.y = 0.005;
    roadMesh.receiveShadow = true;
    this.lotGroup.add(roadMesh);

    // Yellow dashed road center line
    const dashLength = 1.6;
    const dashGap = 1.4;
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    for (let x = -roadLength / 2 + 2; x <= roadLength / 2 - 2; x += dashLength + dashGap) {
      const dashGeo = new THREE.PlaneGeometry(dashLength, 0.18);
      const dash = new THREE.Mesh(dashGeo, dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x, 0.012, 0);
      this.lotGroup.add(dash);
    }

    // 4. Create Top Row Slots (Z < 0, numbered 1 .. topCount)
    const topCenterZ = -(CONFIG.ROAD_WIDTH / 2 + CONFIG.SLOT_LENGTH / 2);
    const topStartX = -((topCount - 1) * stepX) / 2;

    let slotCounter = 1;
    for (let i = 0; i < topCount; i++) {
      const x = topStartX + i * stepX;
      const slotId = SmartParking.formatSlotId(slotCounter++);
      this.createSlotObject({
        id: slotId,
        row: 'top',
        indexInRow: i,
        x,
        z: topCenterZ,
        // Car drives into top slot facing -Z (Math.PI)
        facingYaw: Math.PI
      });
    }

    // 5. Create Bottom Row Slots (Z > 0, numbered topCount + 1 .. capacity)
    const bottomCenterZ = CONFIG.ROAD_WIDTH / 2 + CONFIG.SLOT_LENGTH / 2;
    const bottomStartX = -((bottomCount - 1) * stepX) / 2;

    for (let i = 0; i < bottomCount; i++) {
      const x = bottomStartX + i * stepX;
      const slotId = SmartParking.formatSlotId(slotCounter++);
      this.createSlotObject({
        id: slotId,
        row: 'bottom',
        indexInRow: i,
        x,
        z: bottomCenterZ,
        // Car drives into bottom slot facing +Z (0)
        facingYaw: 0
      });
    }

    // 6. ENTRY Gate on the left end and EXIT Gate on the right end
    this.entryGateX = -roadLength / 2 + 0.8;
    this.exitGateX = roadLength / 2 - 0.8;

    this.entryBarrierPivot = this.createGateStructure(this.entryGateX, 'ENTRY', '#2ec4b6', true);
    this.exitBarrierPivot = this.createGateStructure(this.exitGateX, 'EXIT', '#f59e0b', false);

    // Update shadow camera frustum to cover the entire lot cleanly
    const shadowHalf = Math.max(this.lotWidth, this.lotDepth) * 0.75;
    this.dirLight.shadow.camera.left = -shadowHalf;
    this.dirLight.shadow.camera.right = shadowHalf;
    this.dirLight.shadow.camera.top = shadowHalf;
    this.dirLight.shadow.camera.bottom = -shadowHalf;
    this.dirLight.shadow.camera.updateProjectionMatrix();

    // Fit camera to the newly built lot
    this.fitCameraToLot(false);
  }

  /**
   * Builds a single parking slot with ground paint lines, status indicator pad, and floating ID label.
   */
  createSlotObject({ id, row, indexInRow, x, z, facingYaw }) {
    const slotGroup = new THREE.Group();
    slotGroup.position.set(x, 0.01, z);

    const w = CONFIG.SLOT_WIDTH;
    const l = CONFIG.SLOT_LENGTH;
    const lineThickness = 0.12;

    // Inner status glow mat (Free = teal, Occupied = red, Target = yellow)
    const padGeo = new THREE.PlaneGeometry(w - 0.35, l - 0.35);
    const padMat = new THREE.MeshBasicMaterial({
      color: 0x2ec4b6,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide
    });
    const padMesh = new THREE.Mesh(padGeo, padMat);
    padMesh.rotation.x = -Math.PI / 2;
    padMesh.position.y = 0.005;
    slotGroup.add(padMesh);

    // White/Teal U-shaped ground paint lines
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x9db0c4 });

    const leftLine = new THREE.Mesh(new THREE.PlaneGeometry(lineThickness, l), lineMat);
    leftLine.rotation.x = -Math.PI / 2;
    leftLine.position.set(-w / 2, 0.01, 0);

    const rightLine = new THREE.Mesh(new THREE.PlaneGeometry(lineThickness, l), lineMat);
    rightLine.rotation.x = -Math.PI / 2;
    rightLine.position.set(w / 2, 0.01, 0);

    const backZ = row === 'top' ? -l / 2 : l / 2;
    const backLine = new THREE.Mesh(new THREE.PlaneGeometry(w + lineThickness, lineThickness), lineMat);
    backLine.rotation.x = -Math.PI / 2;
    backLine.position.set(0, 0.01, backZ);

    slotGroup.add(leftLine, rightLine, backLine);

    // Floating label with its Parking ID (e.g., P-01)
    const labelSprite = this.createTextSprite(id, {
      bgColor: 'rgba(23, 34, 48, 0.92)',
      borderColor: '#2ec4b6',
      textColor: '#e8eef5'
    });
    const labelZ = row === 'top' ? -l * 0.32 : l * 0.32;
    labelSprite.position.set(0, 2.25, labelZ);
    labelSprite.scale.set(2.2, 0.9, 1);
    slotGroup.add(labelSprite);

    this.lotGroup.add(slotGroup);

    this.slots.set(id, {
      id,
      row,
      indexInRow,
      x,
      z,
      facingYaw,
      padMesh,
      labelSprite,
      state: 'free'
    });
  }

  /**
   * Builds an ENTRY or EXIT gate with pillar, barrier arm, and floating sign.
   */
  createGateStructure(xPos, labelText, accentHex, isEntry) {
    const gateGroup = new THREE.Group();
    const zPillar = CONFIG.ROAD_WIDTH / 2 + 0.55;
    gateGroup.position.set(xPos, 0, zPillar);

    // Pillar post
    const pillarGeo = new THREE.BoxGeometry(0.55, 2.1, 0.55);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x263646,
      roughness: 0.5,
      metalness: 0.4
    });
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.y = 1.05;
    pillar.castShadow = true;
    gateGroup.add(pillar);

    // Barrier pivot at top of pillar
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.85, 0);

    const armLength = CONFIG.ROAD_WIDTH * 0.72;
    const armGeo = new THREE.BoxGeometry(0.16, 0.16, armLength);
    const armMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accentHex),
      roughness: 0.35
    });
    const armMesh = new THREE.Mesh(armGeo, armMat);
    armMesh.position.set(0, 0, -armLength / 2);
    armMesh.castShadow = true;
    pivot.add(armMesh);
    gateGroup.add(pivot);

    // Floating gate label ("ENTRY" or "EXIT")
    const gateSprite = this.createTextSprite(labelText, {
      bgColor: 'rgba(15, 23, 32, 0.95)',
      borderColor: accentHex,
      textColor: accentHex
    });
    gateSprite.position.set(0, 3.25, -CONFIG.ROAD_WIDTH / 2);
    gateSprite.scale.set(2.8, 1.1, 1);
    gateGroup.add(gateSprite);

    this.lotGroup.add(gateGroup);
    return pivot;
  }

  /**
   * Creates a crisp 2D canvas texture sprite for slot IDs and gate labels.
   */
  createTextSprite(text, { bgColor, borderColor, textColor }) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 104;
    const ctx = canvas.getContext('2d');

    // Rounded pill background
    ctx.fillStyle = bgColor;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 6;
    this.roundRect(ctx, 8, 8, 240, 88, 22);
    ctx.fill();
    ctx.stroke();

    // Crisp label text
    ctx.fillStyle = textColor;
    ctx.font = '800 44px Manrope, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 54);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false
    });
    return new THREE.Sprite(material);
  }

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /**
   * Updates the visual color of a slot pad ('free', 'occupied', or 'target').
   * @param {string} slotId
   * @param {'free'|'occupied'|'target'} state
   */
  setSlotVisualState(slotId, state) {
    const slot = this.slots.get(slotId);
    if (!slot) return;
    slot.state = state;

    if (state === 'free') {
      slot.padMesh.material.color.setHex(0x2ec4b6);
      slot.padMesh.material.opacity = 0.16;
    } else if (state === 'occupied') {
      slot.padMesh.material.color.setHex(0xef4444);
      slot.padMesh.material.opacity = 0.28;
    } else if (state === 'target') {
      slot.padMesh.material.color.setHex(0xfacc15);
      slot.padMesh.material.opacity = 0.42;
    }
  }

  /**
   * Finds the free slot nearest to the ENTRY gate.
   * Distance is Euclidean distance from (entryGateX, 0) to the slot center (x, z).
   * Ties are broken by the lower Parking ID (e.g. P-01 before P-07).
   *
   * @param {string[]} occupiedSlotIds
   * @returns {string|null}
   */
  findNearestFreeSlot(occupiedSlotIds) {
    const occupiedSet = new Set(occupiedSlotIds);
    let bestSlotId = null;
    let bestDistance = Infinity;

    for (const [slotId, slot] of this.slots.entries()) {
      if (occupiedSet.has(slotId)) continue;

      const dx = slot.x - this.entryGateX;
      const dz = slot.z - 0;
      const dist = Math.hypot(dx, dz);

      if (dist < bestDistance - 1e-4) {
        bestDistance = dist;
        bestSlotId = slotId;
      }
      // Because slots are inserted in order P-01, P-02..., strict '<' automatically gives ties to the lower Parking ID
    }

    return bestSlotId;
  }

  /**
   * Places a car immediately in its slot without animation (used when restoring from localStorage).
   * @param {string} carID
   * @param {string} slotId
   * @param {string} color
   */
  placeCarInstant(carID, slotId, color) {
    const slot = this.slots.get(slotId);
    if (!slot) return;

    const carGroup = this.createCarInstance(color);
    carGroup.userData.carID = carID;
    carGroup.position.set(slot.x, 0, slot.z);
    carGroup.rotation.y = slot.facingYaw;

    this.carsGroup.add(carGroup);
    this.carObjects.set(carID, { group: carGroup, slotId, color });
    this.setSlotVisualState(slotId, 'occupied');
  }

  /**
   * Smoothly animates a car entering from the ENTRY gate, driving along the road centerline
   * to the slot's X position, turning smoothly into the slot, and stopping centered.
   *
   * @param {string} carID
   * @param {string} slotId
   * @param {string} color
   * @returns {Promise<void>}
   */
  animateCarEnter(carID, slotId, color) {
    const slot = this.slots.get(slotId);
    if (!slot) return Promise.resolve();

    const carGroup = this.createCarInstance(color);
    carGroup.userData.carID = carID;
    const startX = this.entryGateX - 1.5;
    carGroup.position.set(startX, 0, 0);
    // Facing +X (down the road from left to right) corresponds to rotation.y = Math.PI / 2
    const roadYaw = Math.PI / 2;
    carGroup.rotation.y = roadYaw;

    this.carsGroup.add(carGroup);
    this.carObjects.set(carID, { group: carGroup, slotId, color });
    this.setSlotVisualState(slotId, 'target');

    // Open entry barrier briefly
    this.animateBarrier(this.entryBarrierPivot, true);

    // Compute road travel distance and duration
    const turnStartX = slot.x;
    const roadDist = Math.max(Math.abs(turnStartX - startX), 0.5);
    const roadDuration = Math.max(roadDist / CONFIG.DRIVE_SPEED, 0.45);
    const turnDuration = CONFIG.PARK_TURN_DURATION;

    // Quadratic Bezier control points for turning smoothly from road into the slot
    const p0 = new THREE.Vector3(turnStartX - 1.1, 0, 0);
    const p1 = new THREE.Vector3(slot.x, 0, slot.z * 0.25);
    const p2 = new THREE.Vector3(slot.x, 0, slot.z);

    return new Promise((resolve) => {
      let elapsed = 0;
      let barrierClosed = false;

      const task = (dt) => {
        elapsed += dt;

        if (!barrierClosed && elapsed > 0.65) {
          barrierClosed = true;
          this.animateBarrier(this.entryBarrierPivot, false);
        }

        if (elapsed <= roadDuration) {
          // Phase 1: Drive smoothly along road centerline to just before the slot X
          const t = Math.min(elapsed / roadDuration, 1);
          const eased = this.easeInOutSine(t);
          carGroup.position.x = THREE.MathUtils.lerp(startX, p0.x, eased);
          carGroup.position.z = 0;
          carGroup.rotation.y = roadYaw;
          return false;
        }

        const turnElapsed = elapsed - roadDuration;
        if (turnElapsed <= turnDuration) {
          // Phase 2: Smooth curve and rotation into the slot
          const t = Math.min(turnElapsed / turnDuration, 1);
          const eased = this.easeInOutCubic(t);

          // Quadratic Bezier position
          const oneMinusT = 1 - eased;
          carGroup.position.x =
            oneMinusT * oneMinusT * p0.x +
            2 * oneMinusT * eased * p1.x +
            eased * eased * p2.x;
          carGroup.position.z =
            oneMinusT * oneMinusT * p0.z +
            2 * oneMinusT * eased * p1.z +
            eased * eased * p2.z;

          carGroup.rotation.y = this.lerpAngle(roadYaw, slot.facingYaw, eased);
          return false;
        }

        // Finalize exact parked position and orientation
        carGroup.position.set(slot.x, 0, slot.z);
        carGroup.rotation.y = slot.facingYaw;
        this.pulseSlotHighlight(slotId, 'occupied');
        resolve();
        return true;
      };

      this.activeAnimations.push(task);
    });
  }

  /**
   * Smoothly animates a parked car backing/driving out of its slot onto the road,
   * driving along the road to the EXIT gate, fading out, and disposing its 3D resources.
   *
   * @param {string} carID
   * @returns {Promise<void>}
   */
  animateCarExit(carID) {
    const record = this.carObjects.get(carID);
    if (!record) return Promise.resolve();

    const { group: carGroup, slotId } = record;
    const slot = this.slots.get(slotId);
    if (!slot) return Promise.resolve();

    this.setSlotVisualState(slotId, 'target');

    const startPos = new THREE.Vector3(slot.x, 0, slot.z);
    const roadMergePos = new THREE.Vector3(slot.x + 1.1, 0, 0);
    const controlPos = new THREE.Vector3(slot.x, 0, slot.z * 0.25);

    const roadYaw = Math.PI / 2;
    const exitTargetX = this.exitGateX + 2.2;
    const roadDist = Math.max(Math.abs(exitTargetX - roadMergePos.x), 1.0);

    const pullOutDuration = CONFIG.PARK_TURN_DURATION;
    const roadDuration = Math.max(roadDist / CONFIG.DRIVE_SPEED, 0.5);
    const fadeDuration = 0.35;

    let barrierOpened = false;

    return new Promise((resolve) => {
      let elapsed = 0;

      const task = (dt) => {
        elapsed += dt;

        // Phase 1: Pull out from the slot onto the road centerline
        if (elapsed <= pullOutDuration) {
          const t = Math.min(elapsed / pullOutDuration, 1);
          const eased = this.easeInOutCubic(t);
          const oneMinusT = 1 - eased;

          carGroup.position.x =
            oneMinusT * oneMinusT * startPos.x +
            2 * oneMinusT * eased * controlPos.x +
            eased * eased * roadMergePos.x;
          carGroup.position.z =
            oneMinusT * oneMinusT * startPos.z +
            2 * oneMinusT * eased * controlPos.z +
            eased * eased * roadMergePos.z;

          carGroup.rotation.y = this.lerpAngle(slot.facingYaw, roadYaw, eased);
          return false;
        }

        // Phase 2: Drive along road to the EXIT gate
        const roadElapsed = elapsed - pullOutDuration;
        if (roadElapsed <= roadDuration) {
          if (!barrierOpened && roadElapsed > roadDuration * 0.45) {
            barrierOpened = true;
            this.animateBarrier(this.exitBarrierPivot, true);
          }

          const t = Math.min(roadElapsed / roadDuration, 1);
          const eased = this.easeInOutSine(t);
          carGroup.position.x = THREE.MathUtils.lerp(roadMergePos.x, exitTargetX, eased);
          carGroup.position.z = 0;
          carGroup.rotation.y = roadYaw;
          return false;
        }

        // Phase 3: Fade out at EXIT gate and remove
        const fadeElapsed = roadElapsed - roadDuration;
        if (fadeElapsed <= fadeDuration) {
          const t = Math.min(fadeElapsed / fadeDuration, 1);
          carGroup.position.x = exitTargetX + t * 1.6;
          this.setGroupOpacity(carGroup, 1 - t);
          return false;
        }

        // Close exit barrier, free the slot, and dispose geometries/materials
        this.animateBarrier(this.exitBarrierPivot, false);
        this.setSlotVisualState(slotId, 'free');
        this.removeAndDisposeCar(carID);
        resolve();
        return true;
      };

      this.activeAnimations.push(task);
    });
  }

  /**
   * Smoothly rotates a gate barrier arm open or closed.
   */
  animateBarrier(pivot, open) {
    if (!pivot) return;
    const startAngle = pivot.rotation.x;
    const targetAngle = open ? Math.PI / 2.2 : 0;
    const duration = CONFIG.GATE_OPEN_DURATION;
    let elapsed = 0;

    this.activeAnimations.push((dt) => {
      elapsed += dt;
      const t = Math.min(elapsed / duration, 1);
      pivot.rotation.x = THREE.MathUtils.lerp(startAngle, targetAngle, this.easeInOutSine(t));
      return t >= 1;
    });
  }

  /**
   * Briefly highlights a slot in yellow ("Target slot") then transitions to its final state.
   */
  pulseSlotHighlight(slotId, finalState = 'occupied') {
    const slot = this.slots.get(slotId);
    if (!slot) return;

    this.setSlotVisualState(slotId, 'target');
    let elapsed = 0;
    this.activeAnimations.push((dt) => {
      elapsed += dt;
      if (elapsed >= CONFIG.HIGHLIGHT_DURATION) {
        this.setSlotVisualState(slotId, finalState);
        return true;
      }
      return false;
    });
  }

  /**
   * Highlights a parked car and smoothly moves the camera to focus on it.
   * @param {string} carID
   */
  focusOnCar(carID) {
    const record = this.carObjects.get(carID);
    if (!record) return;

    const { group, slotId } = record;
    this.pulseSlotHighlight(slotId, 'occupied');

    const targetPos = group.position.clone();
    const desiredCamPos = new THREE.Vector3(
      targetPos.x + 5.5,
      11.5,
      targetPos.z + (targetPos.z >= 0 ? 11.5 : -11.5)
    );

    this.startCameraTransition(desiredCamPos, targetPos, 1.8);
  }

  /**
   * Zooms the camera in or out by a scale factor.
   * @param {number} factor - < 1 zooms in, > 1 zooms out
   */
  zoomByFactor(factor) {
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    const currentDist = offset.length();
    const newDist = THREE.MathUtils.clamp(
      currentDist * factor,
      this.controls.minDistance,
      this.controls.maxDistance
    );
    offset.setLength(newDist);
    const desiredCamPos = new THREE.Vector3().addVectors(this.controls.target, offset);
    this.startCameraTransition(desiredCamPos, this.controls.target.clone(), 0.28);
  }

  /**
   * Resets the camera position and target to fit the entire parking lot in view.
   * Adapts distance automatically to the lot size.
   * @param {boolean} animate
   */
  fitCameraToLot(animate = true) {
    const span = Math.max(this.lotWidth, this.lotDepth);
    // Leave extra room around both gates so Fit shows the full parking area.
    const dist = Math.max(span * 1.15, 30);
    const desiredCamPos = new THREE.Vector3(0, dist * 0.72, dist * 0.86);
    const desiredTarget = new THREE.Vector3(0, 0, 0);

    if (!animate) {
      if (this.cameraFocusResolve) this.cameraFocusResolve();
      this.cameraFocusResolve = null;
      this.cameraFocusAnim = null;
      this.camera.position.copy(desiredCamPos);
      this.controls.target.copy(desiredTarget);
      this.controls.update();
      return Promise.resolve();
    } else {
      return this.startCameraTransition(desiredCamPos, desiredTarget, 1.8);
    }
  }

  /**
   * Smoothly interpolates camera position and OrbitControls target.
   */
  startCameraTransition(desiredCamPos, desiredTarget, duration = 0.65) {
    if (this.cameraFocusResolve) this.cameraFocusResolve();
    const startCamPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    let elapsed = 0;

    return new Promise((resolve) => {
      this.cameraFocusResolve = resolve;
      this.cameraFocusAnim = (dt) => {
        elapsed += dt;
        const t = Math.min(elapsed / duration, 1);
        const eased = this.easeInOutCubic(t);
        this.camera.position.lerpVectors(startCamPos, desiredCamPos, eased);
        this.controls.target.lerpVectors(startTarget, desiredTarget, eased);
        this.controls.update();
        return t >= 1;
      };
    });
  }

  /**
   * Sets opacity across all meshes in a car group for smooth fade-out.
   */
  setGroupOpacity(group, opacity) {
    group.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
          mat.transparent = true;
          mat.opacity = Math.max(0, opacity);
        }
      }
    });
  }

  /**
   * Removes a car from the scene and disposes its geometries and materials.
   */
  removeAndDisposeCar(carID) {
    const record = this.carObjects.get(carID);
    if (!record) return;

    const { group } = record;
    this.carsGroup.remove(group);
    this.disposeObject3D(group);
    this.carObjects.delete(carID);
  }

  /**
   * Disposes all geometries, materials, and textures inside an Object3D hierarchy.
   */
  disposeObject3D(root) {
    root.traverse((node) => {
      if (node.geometry) {
        node.geometry.dispose();
      }
      if (node.material) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of materials) {
          if (mat.map) {
            mat.map.dispose();
          }
          mat.dispose();
        }
      }
    });
  }

  /**
   * Clears and disposes all current lot meshes and parked car meshes.
   */
  clearSceneObjects() {
    this.activeAnimations = [];
    this.cameraFocusAnim = null;

    for (const carID of Array.from(this.carObjects.keys())) {
      this.removeAndDisposeCar(carID);
    }

    while (this.lotGroup.children.length > 0) {
      const child = this.lotGroup.children[0];
      this.lotGroup.remove(child);
      this.disposeObject3D(child);
    }

    this.slots.clear();
  }

  /**
   * Handles window and viewport resize while capping pixel ratio at 2.
   */
  handleResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  }

  /**
   * Main requestAnimationFrame loop using delta time.
   */
  animate() {
    requestAnimationFrame(() => this.animate());

    const dt = Math.min(this.clock.getDelta(), 0.1);

    // Run active car and gate animations
    if (this.activeAnimations.length > 0) {
      this.activeAnimations = this.activeAnimations.filter((fn) => !fn(dt));
    }

    // Run smooth camera focus transition if active
    if (this.cameraFocusAnim) {
      const done = this.cameraFocusAnim(dt);
      if (done) {
        this.cameraFocusAnim = null;
        const resolve = this.cameraFocusResolve;
        this.cameraFocusResolve = null;
        if (resolve) resolve();
      }
    }

    if (this.controls) {
      this.controls.update();
    }

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // Smooth easing helpers
  easeInOutSine(t) {
    return -(Math.cos(Math.PI * t) - 1) / 2;
  }

  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  lerpAngle(a, b, t) {
    const diff = THREE.MathUtils.euclideanModulo(b - a + Math.PI, Math.PI * 2) - Math.PI;
    return a + diff * t;
  }
}
