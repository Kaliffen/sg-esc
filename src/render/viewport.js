// Camera and screen<->world mapping. The only place that knows about pixels.
import * as THREE from 'three';

export class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    this.camera.up.set(0, 0, -1);           // +Z is down on screen
    this.center = { x: 80, z: 55 };
    this.ppm = 9;                             // pixels per metre (zoom)
    this.minPpm = 3; this.maxPpm = 40;
    this.w = 1; this.h = 1;
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._v = new THREE.Vector3();
    this.resize();
  }
  resize() {
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.update();
  }
  update() {
    const c = this.camera;
    const hw = this.w / 2 / this.ppm, hh = this.h / 2 / this.ppm;
    c.left = -hw; c.right = hw; c.top = hh; c.bottom = -hh;
    c.position.set(this.center.x, 200, this.center.z);
    c.lookAt(this.center.x, 0, this.center.z);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }
  screenToWorld(px, py) {
    const ndc = new THREE.Vector2((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.plane, this._v);
    return hit ? { x: hit.x, z: hit.z } : { x: this.center.x, z: this.center.z };
  }
  worldToScreen(x, z) {
    this._v.set(x, 0, z).project(this.camera);
    return { x: (this._v.x + 1) / 2 * this.w, y: (1 - this._v.y) / 2 * this.h };
  }
  zoomAt(px, py, factor) {
    const before = this.screenToWorld(px, py);
    this.ppm = Math.min(this.maxPpm, Math.max(this.minPpm, this.ppm * factor));
    this.update();
    const after = this.screenToWorld(px, py);
    this.center.x += before.x - after.x; this.center.z += before.z - after.z;
    this.update();
  }
  panPixels(dx, dy) { this.center.x -= dx / this.ppm; this.center.z -= dy / this.ppm; this.update(); }
  centerOn(x, z) { this.center.x = x; this.center.z = z; this.update(); }
  /** Smoothly move center toward target (call per frame). */
  easeTo(x, z, k = 0.12) { this.center.x += (x - this.center.x) * k; this.center.z += (z - this.center.z) * k; this.update(); }
}
