import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Étalonnage final : vignette douce, teinte chaude, léger grain.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uWarm: { value: new THREE.Vector3(1.03, 1.0, 0.96) },
    uFade: { value: 0 },
    uFadeColor: { value: new THREE.Color(0xfff4ea) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform vec3 uWarm;
    uniform float uFade;
    uniform vec3 uFadeColor;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uWarm;
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(d * vec2(1.1, 1.0)));
      col *= mix(1.0 - uVignette, 1.0, v);
      col += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.012;
      col = mix(col, uFadeColor, uFade);
      gl_FragColor = vec4(col, c.a);
    }
  `,
};

export class Renderer {
  constructor(container, { test = false } = {}) {
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: test });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, test ? 1 : 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.05, 1500);
    this.scene = new THREE.Scene();

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.28, 0.65, 0.92);
    composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    composer.addPass(new OutputPass());
    this.composer = composer;

    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  render(dt, time) {
    this.grade.uniforms.uTime.value = time;
    this.composer.render(dt);
  }

  setFade(v) {
    this.grade.uniforms.uFade.value = v;
  }
}
