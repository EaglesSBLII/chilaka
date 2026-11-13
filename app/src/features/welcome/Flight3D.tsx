// The first-open flight, in real 3D: Chikki is a speck far off in the haze,
// weaves closer through the clouds on beating wings, hangs in front of the
// viewer for a beat, then spreads its wings and dives head-first straight
// into the camera until its face fills the screen.
//
// The camera never moves and looks straight down the flight path, so all of
// the growth on screen is true perspective: the bird really does travel
// eighty units towards the lens. Loaded only on first open (lazy chunk).
import { useEffect, useRef } from 'react';
import {
  AmbientLight,
  Color,
  ConeGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Shape,
  SphereGeometry,
  WebGLRenderer,
} from 'three';

import { FLIGHT_MS } from './timing';

const GREEN = 0x4cc97e;
const GREEN_DARK = 0x2e9158;
const GREEN_MID = 0x3cb46e;
const BELLY = 0xa8e6c1;
const BEAK = 0xf5a623;
const BEAK_DARK = 0xd88e0f;
const CREST = 0xff5c39;
const INK = 0x26221c;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutCubic = (v: number) => 1 - Math.pow(1 - v, 3);
const easeInCubic = (v: number) => v * v * v;
const smooth = (a: number, b: number, v: number) => {
  const x = clamp01((v - a) / (b - a));
  return x * x * (3 - 2 * x);
};

/** Soft, bright cartoon surface: lit by the scene, with a little of its own colour so shadows never go muddy. */
function mat(color: number, roughness = 0.6, glow = 0.2): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness: 0, emissive: color, emissiveIntensity: glow });
}

/** A sphere stretched into an ellipsoid. */
function blob(material: MeshStandardMaterial | MeshBasicMaterial, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(SPHERE, material);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
}
const SPHERE = new SphereGeometry(1, 40, 28);

/**
 * A flat wing panel with a scalloped feather edge, lying in the x–z plane: the
 * root is at x = 0, it reaches `len` along +x, the leading edge faces the
 * viewer (+z) and the feathers trail behind (−z).
 */
function wingPanel(len: number, rootChord: number, tipChord: number, feathers: number, color: number): Mesh {
  const sh = new Shape();
  sh.moveTo(0, 0);
  sh.quadraticCurveTo(len * 0.55, 0.16, len, -0.06 * len); // leading edge, gently arched
  for (let i = feathers; i > 0; i--) {
    // each feather: a rounded tip bulging past the trailing edge
    const x1 = (len * (i - 1)) / feathers;
    const xm = (len * (i - 0.5)) / feathers;
    const chord = rootChord + ((tipChord - rootChord) * (i - 0.5)) / feathers;
    sh.quadraticCurveTo(xm + len * 0.04, -chord * 1.16, x1, -(rootChord + ((tipChord - rootChord) * (i - 1)) / feathers) * 0.86);
  }
  sh.lineTo(0, 0);
  const geo = new ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 3, curveSegments: 10 });
  geo.rotateX(Math.PI / 2); // the shape's chord now runs along −z: feathers trail away from the viewer
  const m = new Mesh(geo, mat(color));
  m.material.side = 2; // DoubleSide: the mirrored wing shows its other face
  return m;
}

/** One wing: shoulder pivot → inner panel → elbow pivot → outer panel of long flight feathers. `side` is +1 or −1. */
function buildWing(side: 1 | -1): { shoulder: Group; elbow: Group } {
  const shoulder = new Group();
  shoulder.position.set(0.6 * side, 0.3, 0.15);
  const inner = wingPanel(1.7, 1.35, 1.2, 4, GREEN_MID);
  const elbow = new Group();
  elbow.position.set(1.62, 0, -0.08);
  const outer = wingPanel(2.0, 1.2, 0.5, 5, GREEN_DARK);
  elbow.add(outer);
  // built for the +x side, mirrored for the other
  const flip = new Group();
  flip.scale.x = side;
  // leading edge tipped up, so the broad underside of the wing faces the viewer
  flip.rotation.x = -0.62;
  flip.add(inner, elbow);
  shoulder.add(flip);
  // a rounded shoulder so the wing grows out of the body
  shoulder.add(blob(mat(GREEN), 0.42, 0.3, 0.5, 0.1 * side, -0.02, -0.1));
  return { shoulder, elbow };
}

/** Chikki, modelled facing +z (towards the camera). About 2 units tall, 6.5 wide with wings out. */
function buildBird() {
  const bird = new Group();
  const green = mat(GREEN);
  // body: leaning forward the way a flying bird does, belly underneath
  bird.add(blob(green, 0.95, 0.9, 1.45, 0, 0, -0.35));
  bird.add(blob(mat(BELLY), 0.74, 0.62, 1.05, 0, -0.33, -0.1));
  // tail fan trailing behind
  for (const [dx, col] of [[-0.28, GREEN_DARK], [0, GREEN_MID], [0.28, GREEN_DARK]] as const) {
    const t = blob(mat(col), 0.24, 0.06, 0.95, dx, 0.12, -2.1);
    t.rotation.y = -dx * 0.9;
    bird.add(t);
  }
  // head
  const head = new Group();
  head.position.set(0, 0.42, 0.95);
  head.add(blob(green, 0.8, 0.78, 0.8));
  // big front-facing eyes
  for (const s of [1, -1] as const) {
    head.add(blob(mat(0xffffff, 0.3, 0.75), 0.27, 0.3, 0.16, 0.34 * s, 0.14, 0.64));
    head.add(blob(mat(INK, 0.25, 0), 0.135, 0.155, 0.08, 0.33 * s, 0.13, 0.775));
    head.add(blob(new MeshBasicMaterial({ color: 0xffffff }), 0.045, 0.045, 0.03, 0.35 * s, 0.2, 0.84));
  }
  // beak: a hooked parrot beak pointing at the viewer, a darker lower half beneath it
  const upper = new Mesh(new ConeGeometry(0.3, 0.72, 48), mat(BEAK, 0.45));
  upper.rotation.x = Math.PI / 2 + 0.38;
  upper.position.set(0, -0.14, 0.98);
  upper.scale.set(1, 1, 0.82);
  head.add(upper);
  const lower = new Mesh(new ConeGeometry(0.2, 0.4, 40), mat(BEAK_DARK, 0.5));
  lower.rotation.x = Math.PI / 2 + 0.75;
  lower.position.set(0, -0.36, 0.78);
  head.add(lower);
  // crest: three red feathers swept back
  for (const [dx, h] of [[-0.17, 0.5], [0, 0.7], [0.17, 0.5]] as const) {
    const c = new Mesh(new ConeGeometry(0.14, h, 14), mat(CREST, 0.5));
    c.position.set(dx, 0.86, -0.02);
    c.rotation.x = -0.5;
    c.rotation.z = -dx * 1.6;
    head.add(c);
  }
  bird.add(head);
  // feet tucked up under the belly
  for (const s of [1, -1] as const) bird.add(blob(mat(BEAK_DARK), 0.09, 0.07, 0.24, 0.26 * s, -0.86, -0.25));
  const left = buildWing(1);
  const right = buildWing(-1);
  bird.add(left.shoulder, right.shoulder);
  return { bird, head, wings: [left, right] as const };
}

function buildCloud(material: MeshBasicMaterial): Group {
  const g = new Group();
  const puffs: [number, number, number, number][] = [[0, 0, 0, 1.5], [1.5, -0.2, 0.2, 1.1], [-1.5, -0.25, -0.1, 1.15], [0.6, 0.6, -0.2, 1], [-0.7, 0.5, 0.2, 0.9]];
  for (const [x, y, z, r] of puffs) g.add(blob(material, r * 1.25, r * 0.78, r, x, y, z));
  return g;
}

/** Where the bird is at progress p (0..1). The dive ends past the lens so the face fills the frame. */
export function flightPose(p: number): { x: number; y: number; z: number; roll: number; pitch: number; dive: number } {
  const approach = easeOutCubic(clamp01(p / 0.62)); // far → hovering in front of the viewer
  const dive = easeInCubic(clamp01((p - 0.78) / 0.22)); // the head-first rush
  const sway = (1 - approach) * (1 - approach);
  const bob = Math.sin(p * 38) * 0.12 * (1 - dive); // wingbeat lift while hovering
  const x = Math.sin(p * 9.5) * 13 * sway;
  const y = 1.15 * (1 - dive) + Math.sin(p * 6.5 + 1) * 5 * sway + bob - 0.42 * dive;
  const z = -85 + 77 * approach + 8.9 * dive;
  const roll = -Math.cos(p * 9.5) * 0.55 * sway; // banks into each turn
  const pitch = 0.12 * (1 - dive) - 0.05 * dive;
  return { x, y, z, roll, pitch, dive };
}

export default function Flight3D({ onReady, onFail }: { onReady: () => void; onFail: () => void }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) {
      console.error('welcome 3d: no WebGL', e);
      onFail();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    const scene = new Scene();
    scene.fog = new Fog(new Color(0x2f9f90), 30, 110); // distant things melt into the sky
    const camera = new PerspectiveCamera(52, 1, 0.05, 200);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);

    scene.add(new HemisphereLight(0xfffbee, 0x8fd9c6, 1.45));
    scene.add(new AmbientLight(0xffffff, 0.35));
    const key = new DirectionalLight(0xfff1cf, 1.7); // warm sun, high and to the right, slightly behind the viewer
    key.position.set(4, 7, 6);
    scene.add(key);
    const rim = new DirectionalLight(0xffd98a, 1.4); // glow from the sun behind the bird
    rim.position.set(-3, 2, -8);
    scene.add(rim);

    const { bird, head, wings } = buildBird();
    scene.add(bird);

    // clouds scattered along the route, kept off the centre line so the bird stays in view
    const cloudMat = new MeshBasicMaterial({ color: 0xfffaf0, fog: true });
    const clouds: Group[] = [];
    const spots: [number, number, number, number][] = [
      [-9, 5, -14, 1], [10, 2.5, -22, 1.2], [-13, 1, -34, 1.5], [12, 7, -44, 1.4], [-6, 9, -56, 1.6],
      [16, 3, -66, 1.9], [-18, 4, -78, 2.1], [8, -1, -50, 1.3], [-5, 8.5, -20, 0.9], [7, 10, -30, 1],
    ];
    for (const [x, y, z, s] of spots) {
      const c = buildCloud(cloudMat);
      c.position.set(x, y, z);
      c.scale.setScalar(s);
      scene.add(c);
      clouds.push(c);
    }

    const resize = () => {
      const w = el.clientWidth || window.innerWidth;
      const h = el.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // a tall phone screen sees less to the sides: widen the view a little so the wings fit
      camera.fov = w / h < 0.7 ? 62 : 52;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    let raf = 0;
    let start = 0;
    let last = 0;
    const frame = (now: number) => {
      if (!start) {
        start = now;
        last = now;
        onReady();
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const p = clamp01((now - start) / FLIGHT_MS);
      const pose = flightPose(p);
      bird.position.set(pose.x, pose.y, pose.z);
      bird.rotation.set(pose.pitch, 0, pose.roll);

      // wings: steady beats on the way in, quick hover beats, then held wide and swept back for the dive
      const secs = (now - start) / 1000;
      const hover = smooth(0.55, 0.7, p) * (1 - pose.dive);
      const beat = Math.sin(secs * (15 + 9 * hover));
      const amp = (0.72 - 0.2 * hover) * (1 - pose.dive);
      const lift = 0.12 + 0.3 * pose.dive; // dive: a shallow V
      wings.forEach((w, i) => {
        const s = i === 0 ? 1 : -1;
        w.shoulder.rotation.z = s * (beat * amp + lift);
        w.shoulder.rotation.y = s * 0.45 * pose.dive; // swept back
        w.elbow.rotation.z = s * (Math.sin(secs * (15 + 9 * hover) - 0.9) * amp * 0.55 + 0.05); // tips lag the beat
      });
      // the head stays level and fixed on the viewer while the body banks
      head.rotation.z = -pose.roll * 0.8;
      head.rotation.x = -pose.pitch;

      // the air rushes past: clouds drift at the viewer, fastest during the dive
      const wind = 5 + 9 * approachSpeed(p) + 70 * pose.dive;
      for (const c of clouds) {
        c.position.z += wind * dt;
        if (c.position.z > 4) c.position.z -= 90;
      }
      renderer.render(scene, camera);
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      scene.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) {
          if (m.geometry !== SPHERE) m.geometry.dispose();
          (m.material as MeshStandardMaterial).dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="welcome-stage" aria-hidden="true" />;
}

function approachSpeed(p: number): number {
  return 1 - clamp01(p / 0.62);
}
