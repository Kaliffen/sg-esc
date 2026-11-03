// GPU fog of war. Per layer: visibility RT (fans rasterised white) → memory RT ping-pong (fade) → overlay plane.
import * as THREE from 'three';

const MAX_VERTS = 60000;

const memVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const memFrag = `
  uniform sampler2D prev; uniform sampler2D vis; uniform float dt; uniform float floorLevel; uniform float fadeTime;
  varying vec2 vUv;
  void main(){
    float m = texture2D(prev, vUv).r;
    float v = texture2D(vis, vUv).r;
    float faded = m > 0.001 ? max(m - dt / fadeTime, floorLevel) : 0.0;
    gl_FragColor = vec4(max(v, faded), 0.0, 0.0, 1.0);
  }`;
const overlayVert = `
  varying vec2 wuv; uniform vec2 size;
  void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); wuv = wp.xz / size; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const overlayFrag = `
  uniform sampler2D mem; uniform vec3 tint; varying vec2 wuv;
  void main(){
    float m = texture2D(mem, wuv).r;
    float dark = 1.0 - smoothstep(0.0, 1.0, m);
    float a = m < 0.001 ? 0.97 : mix(0.0, 0.78, dark);
    gl_FragColor = vec4(tint, a);
  }`;

export class FogLayer {
  constructor(renderer, worldW, worldH, resPerM = 6) {
    this.renderer = renderer;
    this.w = Math.ceil(worldW * resPerM); this.h = Math.ceil(worldH * resPerM);
    const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false };
    this.visRT = new THREE.WebGLRenderTarget(this.w, this.h, opts);
    this.memA = new THREE.WebGLRenderTarget(this.w, this.h, opts);
    this.memB = new THREE.WebGLRenderTarget(this.w, this.h, opts);
    // visibility scene (2D, x→u, z→v)
    this.visScene = new THREE.Scene();
    this.visCam = new THREE.OrthographicCamera(0, worldW, worldH, 0, -1, 1);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(MAX_VERTS * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setDrawRange(0, 0);
    this.visMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    this.visMesh.frustumCulled = false;
    this.visScene.add(this.visMesh);
    // memory pass
    this.memScene = new THREE.Scene();
    this.memCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.memMat = new THREE.ShaderMaterial({
      uniforms: { prev: { value: null }, vis: { value: this.visRT.texture }, dt: { value: 0 }, floorLevel: { value: 0.35 }, fadeTime: { value: 20 } },
      vertexShader: memVert, fragmentShader: memFrag, depthTest: false, depthWrite: false,
    });
    this.memScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.memMat));
    // overlay plane (in main scene)
    this.overlayMat = new THREE.ShaderMaterial({
      uniforms: { mem: { value: this.memA.texture }, size: { value: new THREE.Vector2(worldW, worldH) }, tint: { value: new THREE.Color(0x05070c) } },
      vertexShader: overlayVert, fragmentShader: overlayFrag, transparent: true, depthTest: false, depthWrite: false,
    });
    const pg = new THREE.PlaneGeometry(worldW, worldH);
    pg.rotateX(-Math.PI / 2);
    this.overlay = new THREE.Mesh(pg, this.overlayMat);
    this.overlay.position.set(worldW / 2, 6, worldH / 2);
    this.overlay.renderOrder = 50;
    this.overlay.frustumCulled = false;
    this.cur = this.memA; this.nxt = this.memB;
    this.clear();
  }
  clear() {
    const r = this.renderer;
    for (const rt of [this.memA, this.memB, this.visRT]) { r.setRenderTarget(rt); r.setClearColor(0x000000, 1); r.clear(); }
    r.setRenderTarget(null);
  }
  /** polys: array of fans [{x,z}...] (first is origin). */
  update(polys, dt) {
    const arr = this.posAttr.array;
    let n = 0;
    for (const poly of polys) {
      for (let i = 1; i + 1 < poly.length; i++) {
        if (n + 9 > arr.length) break;
        arr[n++] = poly[0].x; arr[n++] = poly[0].z; arr[n++] = 0;
        arr[n++] = poly[i].x; arr[n++] = poly[i].z; arr[n++] = 0;
        arr[n++] = poly[i + 1].x; arr[n++] = poly[i + 1].z; arr[n++] = 0;
      }
    }
    this.posAttr.needsUpdate = true;
    this.visMesh.geometry.setDrawRange(0, n / 3);
    const r = this.renderer;
    r.setRenderTarget(this.visRT); r.setClearColor(0x000000, 1); r.clear(); r.render(this.visScene, this.visCam);
    this.memMat.uniforms.prev.value = this.cur.texture;
    this.memMat.uniforms.dt.value = dt;
    r.setRenderTarget(this.nxt); r.render(this.memScene, this.memCam);
    r.setRenderTarget(null);
    [this.cur, this.nxt] = [this.nxt, this.cur];
    this.overlayMat.uniforms.mem.value = this.cur.texture;
  }
}
