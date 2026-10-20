// A Three.js sample for Zaisma's engine tests: a lit 3D scene with shadows, fog, a few hundred
// instanced crystals and a camera that orbits with the mouse, a touch or the arrow keys.
import * as THREE from "three";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1018);
scene.fog = new THREE.Fog(0x0c1018, 20, 70);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);

scene.add(new THREE.HemisphereLight(0x8090b0, 0x202020, 0.6));
const sun = new THREE.DirectionalLight(0xffe0c0, 2.2);
sun.position.set(12, 20, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 });
scene.add(sun);

const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const crystalCount = 400;
const crystals = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.6), new THREE.MeshStandardMaterial({ color: 0x60b0e0, metalness: 0.3, roughness: 0.2 }), crystalCount);
crystals.castShadow = true;
const place = new THREE.Object3D();
for (let i = 0; i < crystalCount; i++) {
  const angle = Math.random() * Math.PI * 2, radius = 4 + Math.random() * 30;
  place.position.set(Math.cos(angle) * radius, 0.6 + Math.random() * 3, Math.sin(angle) * radius);
  place.scale.setScalar(0.5 + Math.random() * 1.5);
  place.rotation.set(Math.random(), Math.random(), Math.random());
  place.updateMatrix();
  crystals.setMatrixAt(i, place.matrix);
}
scene.add(crystals);

const tower = new THREE.Mesh(new THREE.CylinderGeometry(1, 2, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc08050 }));
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
});

const timer = new THREE.Timer();
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const delta = timer.getDelta();
  if (keys.has("ArrowLeft")) yaw += delta * 1.5;
  if (keys.has("ArrowRight")) yaw -= delta * 1.5;
  tower.rotation.y += delta * 0.4;
  camera.position.set(Math.sin(yaw) * Math.cos(pitch) * 28, Math.sin(pitch) * 28, Math.cos(yaw) * Math.cos(pitch) * 28);
  camera.lookAt(0, 2, 0);
  renderer.render(scene, camera);
});
window.zaismaEngineSample = { engine: "three", version: THREE.REVISION, started: true };
