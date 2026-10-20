// A Three.js sample for Zaisma's engine tests: a 3D scene with shadows, fog, a few hundred instanced
// glass crystals, a few of them glowing and pulsing (bloom from three's add-ons, through the import map), and a camera that
// orbits with the mouse, a touch or the arrow keys.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1018);
scene.fog = new THREE.Fog(0x0c1018, 20, 70);
// Reflections for the glass, from a room three makes itself (no picture to load).
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);

scene.add(new THREE.HemisphereLight(0x8090b0, 0x202020, 0.6));
const sun = new THREE.DirectionalLight(0xffe0c0, 1.4);
sun.position.set(12, 20, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 });
scene.add(sun);

const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Most crystals are dark glass that reflects the room; a few dozen are bright cores that glow and pulse.
const crystalCount = 400;
const glowingCount = 40;
const glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0x0a1a2c, metalness: 0.2, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.35 });
const crystalMaterial = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x30b0ff, emissiveIntensity: 3 });
const crystalShape = new THREE.OctahedronGeometry(0.6);
const glass = new THREE.InstancedMesh(crystalShape, glassMaterial, crystalCount - glowingCount);
const glowing = new THREE.InstancedMesh(crystalShape, crystalMaterial, glowingCount);
const place = new THREE.Object3D();
for (const [mesh, count] of [[glass, crystalCount - glowingCount], [glowing, glowingCount]]) {
  mesh.castShadow = true;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2, radius = 4 + Math.random() * 30;
    place.position.set(Math.cos(angle) * radius, 0.6 + Math.random() * 3, Math.sin(angle) * radius);
    place.scale.setScalar(0.5 + Math.random() * 1.5);
    place.rotation.set(Math.random(), Math.random(), Math.random());
    place.updateMatrix();
    mesh.setMatrixAt(i, place.matrix);
  }
  scene.add(mesh);
}

const tower = new THREE.Mesh(new THREE.CylinderGeometry(1, 2, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc08050, emissive: 0xff6010, emissiveIntensity: 0.25 }));
tower.position.y = 4;
tower.castShadow = true;
scene.add(tower);

let yaw = 0.6, pitch = 0.35, dragging = false, lastX = 0, lastY = 0;
const keys = new Set();
addEventListener("keydown", (e) => keys.add(e.key));
addEventListener("keyup", (e) => keys.delete(e.key));
addEventListener("pointerdown", (e) => ((dragging = true), (lastX = e.clientX), (lastY = e.clientY)));
addEventListener("pointerup", () => (dragging = false));
addEventListener("pointermove", (e) => {
  if (!dragging) return;
  yaw -= (e.clientX - lastX) * 0.005;
  pitch = Math.min(1.3, Math.max(0.05, pitch + (e.clientY - lastY) * 0.005));
  lastX = e.clientX;
  lastY = e.clientY;
});
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.8, 0.35, 1));
composer.addPass(new OutputPass());

const timer = new THREE.Timer();
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const delta = timer.getDelta();
  if (keys.has("ArrowLeft")) yaw += delta * 1.5;
  if (keys.has("ArrowRight")) yaw -= delta * 1.5;
  tower.rotation.y += delta * 0.4;
  crystalMaterial.emissiveIntensity = 3 + Math.sin(timer.getElapsed() * 2) * 1.5;
  camera.position.set(Math.sin(yaw) * Math.cos(pitch) * 28, Math.sin(pitch) * 28, Math.cos(yaw) * Math.cos(pitch) * 28);
  camera.lookAt(0, 2, 0);
  composer.render(delta);
});
window.zaismaEngineSample = { engine: "three", version: THREE.REVISION, started: true };
