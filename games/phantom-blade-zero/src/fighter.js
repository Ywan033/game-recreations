// Procedural articulated fighters (player swordfighter and the dual-blade boss) and their pose animation.
import * as THREE from 'three/webgpu';
import { ATTACKS, DODGE, currentSeg } from './sim.js';

const JOINTS = ['body', 'torso', 'head', 'armR', 'foreR', 'handR', 'armL', 'foreL', 'handL', 'legR', 'shinR', 'legL', 'shinL'];
const Z3 = [0, 0, 0];

function mirror(p) {
  const o = { y: p.y, yaw: p.yaw };
  for (const j of JOINTS) {
    if (!p[j]) continue;
    let n = j;
    if (j.endsWith('R')) n = j.slice(0, -1) + 'L';
    else if (j.endsWith('L')) n = j.slice(0, -1) + 'R';
    o[n] = [p[j][0], -p[j][1], -p[j][2]];
  }
  return o;
}
function mix(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  const o = { y: (a.y || 0) * (1 - t) + (b.y || 0) * t, yaw: (a.yaw || 0) * (1 - t) + (b.yaw || 0) * t };
  for (const j of JOINTS) {
    const x = a[j] || Z3;
    const y = b[j] || Z3;
    if (x === Z3 && y === Z3) continue;
    o[j] = [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
  }
  return o;
}
function add(a, d) {
  const o = { ...a };
  for (const k in d) {
    if (k === 'y' || k === 'yaw') o[k] = (a[k] || 0) + d[k];
    else { const x = a[k] || Z3; o[k] = [x[0] + d[k][0], x[1] + d[k][1], x[2] + d[k][2]]; }
  }
  return o;
}
const ease = (t) => t * t * (3 - 2 * t);
const sat = (t) => Math.max(0, Math.min(1, t));

// ------------------------------------------------------------------ poses

const PP = {
  idle: {
    y: -0.06, body: [0, -0.35, 0], torso: [0.1, 0.1, 0], head: [0, 0.25, 0],
    armR: [-0.55, 0, -0.25], foreR: [-0.9, 0, 0], handR: [0.55, 0, 0],
    armL: [-0.3, 0, 0.3], foreL: [-0.9, 0, 0],
    legL: [-0.32, 0, 0.08], shinL: [0.35, 0, 0], legR: [0.22, 0, -0.1], shinR: [0.3, 0, 0],
  },
  run: {
    y: -0.08, torso: [0.3, 0, 0],
    armR: [0.35, 0, -0.3], foreR: [-0.7, 0, 0], handR: [0.3, 0, 0],
    armL: [-0.2, 0, 0.2], foreL: [-0.8, 0, 0],
  },
  s1a: {
    y: -0.1, torso: [0.1, -0.95, 0], head: [0, 0.7, 0],
    armR: [-1.2, 0, -0.95], foreR: [-0.4, 0, 0], handR: [0.9, 0, 0],
    armL: [-0.5, 0, 0.5], foreL: [-1.0, 0, 0],
    legL: [-0.45, 0, 0.1], shinL: [0.5, 0, 0], legR: [0.3, 0, -0.12], shinR: [0.3, 0, 0],
  },
  s1b: {
    y: -0.14, torso: [0.22, 0.85, 0], head: [0, -0.6, 0],
    armR: [-1.3, 0, 0.55], foreR: [-0.15, 0, 0], handR: [1.1, 0, 0],
    armL: [0.5, 0, 0.5], foreL: [-0.6, 0, 0],
    legL: [-0.6, 0, 0.1], shinL: [0.7, 0, 0], legR: [0.4, 0, -0.12], shinR: [0.25, 0, 0],
  },
  s2a: {
    y: -0.12, torso: [0.15, 0.95, 0.1], head: [0, -0.7, 0],
    armR: [-1.0, 0, 0.75], foreR: [-0.5, 0, 0], handR: [1.0, 0, 0],
    armL: [0.3, 0, 0.4], foreL: [-0.7, 0, 0],
    legL: [-0.5, 0, 0.1], shinL: [0.6, 0, 0], legR: [0.35, 0, -0.12], shinR: [0.3, 0, 0],
  },
  s2b: {
    y: -0.1, torso: [0.05, -0.8, -0.1], head: [0, 0.6, 0],
    armR: [-1.55, 0, -0.9], foreR: [-0.1, 0, 0], handR: [0.9, 0, 0],
    armL: [-0.6, 0, 0.3], foreL: [-1.1, 0, 0],
    legL: [-0.35, 0, 0.1], shinL: [0.4, 0, 0], legR: [0.45, 0, -0.14], shinR: [0.4, 0, 0],
  },
  s3a: {
    y: 0.04, torso: [-0.3, -0.2, 0], head: [0.2, 0.1, 0],
    armR: [-2.9, 0, -0.15], foreR: [-0.6, 0, 0], handR: [-0.2, 0, 0],
    armL: [-2.6, 0, 0.2], foreL: [-0.8, 0, 0],
    legL: [-0.3, 0, 0.08], shinL: [0.2, 0, 0], legR: [0.25, 0, -0.1], shinR: [0.2, 0, 0],
  },
  s3b: {
    y: -0.26, torso: [0.6, 0.1, 0], head: [-0.3, 0, 0],
    armR: [-0.85, 0, 0.1], foreR: [-0.1, 0, 0], handR: [1.3, 0, 0],
    armL: [-0.8, 0, -0.1], foreL: [-0.3, 0, 0],
    legL: [-0.9, 0, 0.1], shinL: [1.0, 0, 0], legR: [0.5, 0, -0.12], shinR: [0.5, 0, 0],
  },
  guard: {
    y: -0.16, body: [0, -0.25, 0], torso: [0.12, 0.15, 0], head: [0.05, 0.1, 0],
    armR: [-1.15, 0, -0.1], foreR: [-1.2, 0, 0], handR: [0.85, 0.75, 0],
    armL: [-1.25, 0, -0.25], foreL: [-1.0, 0, 0],
    legL: [-0.5, 0, 0.14], shinL: [0.6, 0, 0], legR: [0.3, 0, -0.16], shinR: [0.45, 0, 0],
  },
  dodge: {
    y: -0.34, torso: [0.55, 0, 0], head: [-0.3, 0, 0],
    armR: [0.5, 0, -0.5], foreR: [-0.9, 0, 0], handR: [0.8, 0, 0],
    armL: [0.2, 0, 0.6], foreL: [-1.0, 0, 0],
    legL: [-0.9, 0, 0.2], shinL: [1.3, 0, 0], legR: [-0.2, 0, -0.3], shinR: [1.0, 0, 0],
  },
  hurt: {
    y: -0.1, torso: [-0.5, 0.3, 0], head: [-0.4, 0, 0],
    armR: [-0.4, 0, -0.9], foreR: [-0.5, 0, 0], handR: [0.4, 0, 0],
    armL: [-0.2, 0, 1.0], foreL: [-0.6, 0, 0],
    legL: [-0.3, 0, 0.1], shinL: [0.5, 0, 0], legR: [0.4, 0, -0.1], shinR: [0.5, 0, 0],
  },
  dead: {
    y: -0.72, body: [-1.45, 0, 0], torso: [-0.1, 0, 0], head: [-0.2, 0.4, 0],
    armR: [-0.3, 0, -1.2], foreR: [-0.3, 0, 0], handR: [0.2, 0, 0],
    armL: [-0.2, 0, 1.1], foreL: [-0.4, 0, 0],
    legL: [-0.15, 0, 0.2], shinL: [0.2, 0, 0], legR: [0.1, 0, -0.15], shinR: [0.1, 0, 0],
  },
};

const BP = {
  wait: {
    torso: [0.05, 0, 0], head: [0.25, 0, 0],
    armR: [0, 0, -0.14], foreR: [-0.1, 0, 0], handR: [1.25, 0, 0],
    armL: [0, 0, 0.14], foreL: [-0.1, 0, 0], handL: [1.25, 0, 0],
  },
  idle: {
    y: -0.14, torso: [0.2, 0, 0], head: [-0.1, 0, 0],
    armR: [-0.45, 0, -0.55], foreR: [-0.55, 0, 0], handR: [0.45, -0.3, 0],
    armL: [-0.45, 0, 0.55], foreL: [-0.55, 0, 0], handL: [0.45, 0.3, 0],
    legL: [-0.35, 0, 0.16], shinL: [0.5, 0, 0], legR: [0.2, 0, -0.18], shinR: [0.4, 0, 0],
  },
  chainWind: {
    y: -0.24, torso: [0.3, 0, 0], head: [-0.2, 0, 0],
    armR: [-1.25, 0, 0.55], foreR: [-1.25, 0, 0], handR: [0.5, 0.8, 0],
    armL: [-1.25, 0, -0.55], foreL: [-1.25, 0, 0], handL: [0.5, -0.8, 0],
    legL: [-0.5, 0, 0.18], shinL: [0.7, 0, 0], legR: [0.25, 0, -0.2], shinR: [0.5, 0, 0],
  },
  slashRa: {
    y: -0.18, torso: [0.12, -1.0, 0], head: [0, 0.8, 0],
    armR: [-1.2, 0, -1.0], foreR: [-0.35, 0, 0], handR: [0.95, 0, 0],
    armL: [-0.9, 0, -0.2], foreL: [-1.2, 0, 0], handL: [0.5, -0.6, 0],
    legL: [-0.5, 0, 0.14], shinL: [0.6, 0, 0], legR: [0.3, 0, -0.16], shinR: [0.35, 0, 0],
  },
  slashRb: {
    y: -0.22, torso: [0.25, 0.9, 0], head: [0, -0.7, 0],
    armR: [-1.3, 0, 0.6], foreR: [-0.1, 0, 0], handR: [1.15, 0, 0],
    armL: [0.5, 0, 0.5], foreL: [-0.5, 0, 0], handL: [0.9, 0, 0],
    legL: [-0.65, 0, 0.14], shinL: [0.75, 0, 0], legR: [0.4, 0, -0.16], shinR: [0.3, 0, 0],
  },
  spinWind: {
    y: -0.34, torso: [0.3, -1.25, 0], head: [0, 1.0, 0],
    armR: [-0.9, 0, -1.3], foreR: [-0.2, 0, 0], handR: [1.4, 0, 0],
    armL: [-1.3, 0, -0.9], foreL: [-0.6, 0, 0], handL: [1.2, 0, 0],
    legL: [-0.7, 0, 0.2], shinL: [1.0, 0, 0], legR: [0.1, 0, -0.25], shinR: [0.8, 0, 0],
  },
  spin: {
    y: -0.2, torso: [0.1, 0, 0],
    armR: [-0.25, 0, -1.5], foreR: [0, 0, 0], handR: [1.5, 0, 0],
    armL: [-0.25, 0, 1.5], foreL: [0, 0, 0], handL: [1.5, 0, 0],
    legL: [-0.3, 0, 0.25], shinL: [0.4, 0, 0], legR: [0.2, 0, -0.25], shinR: [0.4, 0, 0],
  },
  delayWind: {
    y: 0.05, torso: [-0.32, 0, 0], head: [0.25, 0, 0],
    armR: [-2.85, 0, -0.3], foreR: [-0.35, 0, 0], handR: [-0.35, 0, 0],
    armL: [-2.85, 0, 0.3], foreL: [-0.35, 0, 0], handL: [-0.35, 0, 0],
    legL: [-0.3, 0, 0.12], shinL: [0.25, 0, 0], legR: [0.25, 0, -0.12], shinR: [0.25, 0, 0],
  },
  slam: {
    y: -0.36, torso: [0.75, 0, 0], head: [-0.4, 0, 0],
    armR: [-0.75, 0, 0.1], foreR: [-0.05, 0, 0], handR: [1.3, 0, 0],
    armL: [-0.75, 0, -0.1], foreL: [-0.05, 0, 0], handL: [1.3, 0, 0],
    legL: [-1.0, 0, 0.14], shinL: [1.1, 0, 0], legR: [0.5, 0, -0.14], shinR: [0.6, 0, 0],
  },
  lungeWind: {
    y: -0.45, torso: [0.7, 0, 0], head: [-0.55, 0, 0],
    armR: [0.95, 0, -0.45], foreR: [-0.1, 0, 0], handR: [1.3, 0, 0],
    armL: [0.95, 0, 0.45], foreL: [-0.1, 0, 0], handL: [1.3, 0, 0],
    legL: [-1.1, 0, 0.14], shinL: [1.4, 0, 0], legR: [0.5, 0, -0.14], shinR: [0.9, 0, 0],
  },
  dash: {
    y: -0.3, torso: [0.85, 0, 0], head: [-0.7, 0, 0],
    armR: [-1.6, 0, 0.35], foreR: [0, 0, 0], handR: [1.5, 0.3, 0],
    armL: [-1.6, 0, -0.35], foreL: [0, 0, 0], handL: [1.5, -0.3, 0],
    legL: [-1.0, 0, 0.1], shinL: [0.5, 0, 0], legR: [0.9, 0, -0.1], shinR: [0.6, 0, 0],
  },
  revWind: {
    y: -0.28, torso: [0.3, 1.35, 0], head: [0, -1.0, 0],
    armR: [-1.0, 0, 0.95], foreR: [-0.7, 0, 0], handR: [1.0, 0, 0],
    armL: [0.4, 0, 0.5], foreL: [-0.6, 0, 0], handL: [1.0, 0, 0],
    legL: [-0.4, 0, 0.2], shinL: [0.7, 0, 0], legR: [0.3, 0, -0.2], shinR: [0.7, 0, 0],
  },
  revHit: {
    y: -0.2, torso: [0.15, -1.1, 0], head: [0, 0.8, 0],
    armR: [-1.4, 0, -1.2], foreR: [-0.05, 0, 0], handR: [1.3, 0, 0],
    armL: [-0.6, 0, 0.4], foreL: [-0.9, 0, 0], handL: [0.7, 0, 0],
    legL: [-0.55, 0, 0.16], shinL: [0.6, 0, 0], legR: [0.35, 0, -0.18], shinR: [0.4, 0, 0],
  },
  recover: {
    y: -0.3, torso: [0.5, 0, 0], head: [0.15, 0, 0],
    armR: [-0.25, 0, -0.2], foreR: [-0.2, 0, 0], handR: [1.2, 0, 0],
    armL: [-0.25, 0, 0.2], foreL: [-0.2, 0, 0], handL: [1.2, 0, 0],
    legL: [-0.6, 0, 0.16], shinL: [0.9, 0, 0], legR: [0.2, 0, -0.16], shinR: [0.7, 0, 0],
  },
  kneel: {
    y: -0.5, torso: [0.8, 0, 0], head: [0.4, 0, 0],
    armR: [-0.5, 0, -0.3], foreR: [-0.3, 0, 0], handR: [1.5, 0, 0],
    armL: [-0.5, 0, 0.3], foreL: [-0.3, 0, 0], handL: [1.5, 0, 0],
    legL: [-1.35, 0, 0.1], shinL: [1.45, 0, 0], legR: [0.25, 0, -0.1], shinR: [1.35, 0, 0],
  },
  roar: {
    y: 0.04, torso: [-0.45, 0, 0], head: [-0.5, 0, 0],
    armR: [-0.3, 0, -1.9], foreR: [-0.2, 0, 0], handR: [1.45, 0, 0],
    armL: [-0.3, 0, 1.9], foreL: [-0.2, 0, 0], handL: [1.45, 0, 0],
    legL: [-0.2, 0, 0.3], shinL: [0.2, 0, 0], legR: [0.15, 0, -0.3], shinR: [0.2, 0, 0],
  },
  dead: {
    y: -0.74, body: [1.4, 0, 0], torso: [0.15, 0, 0], head: [0.2, 0.5, 0],
    armR: [-2.4, 0, -0.6], foreR: [-0.3, 0, 0], handR: [0.6, 0, 0],
    armL: [-2.0, 0, 0.9], foreL: [-0.5, 0, 0], handL: [0.6, 0, 0],
    legL: [0.1, 0, 0.2], shinL: [0.2, 0, 0], legR: [0.2, 0, -0.15], shinR: [0.5, 0, 0],
  },
};
BP.slashLa = mirror(BP.slashRa);
BP.slashLb = mirror(BP.slashRb);

// ------------------------------------------------------------------ rig

function capsule(len, r, mat) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 2), 3, 8), mat);
  m.position.y = -len / 2;
  m.castShadow = true;
  return m;
}
function part(geo, mat, x, y, z, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function buildRig(c) {
  const root = new THREE.Group();
  const J = {};
  const g = (name, parent, x, y, z) => {
    const o = new THREE.Group();
    o.position.set(x, y, z);
    parent.add(o);
    J[name] = o;
    return o;
  };
  const hipH = 0.94;
  const body = g('body', root, 0, hipH, 0);
  part(new THREE.BoxGeometry(0.36, 0.2, 0.22), c.legs, 0, 0.02, 0, body);
  const torso = g('torso', body, 0, 0.1, 0);
  part(new THREE.BoxGeometry(0.44, 0.5, 0.25), c.cloth, 0, 0.28, 0, torso);
  part(new THREE.BoxGeometry(0.46, 0.09, 0.27), c.sash, 0, 0.04, 0, torso);
  const head = g('head', torso, 0, 0.6, 0);
  part(new THREE.SphereGeometry(0.125, 10, 8), c.skin, 0, 0.1, 0, head);
  part(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 6), c.skin, 0, -0.02, 0, head);
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'R' : 'L';
    const arm = g('arm' + n, torso, s * 0.275, 0.47, 0);
    arm.add(capsule(0.32, 0.068, c.cloth));
    const fore = g('fore' + n, arm, 0, -0.3, 0);
    fore.add(capsule(0.3, 0.058, c.bracer));
    g('hand' + n, fore, 0, -0.29, 0);
    part(new THREE.SphereGeometry(0.055, 6, 5), c.skin, 0, 0, 0, J['hand' + n]);
    const leg = g('leg' + n, body, s * 0.12, 0, 0);
    leg.add(capsule(0.47, 0.085, c.legs));
    const shin = g('shin' + n, leg, 0, -0.45, 0);
    shin.add(capsule(0.47, 0.07, c.boots));
    part(new THREE.BoxGeometry(0.11, 0.07, 0.24), c.boots, 0, -0.45, 0.05, shin);
  }
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.025;
  blob.renderOrder = 2;
  root.add(blob);
  const rig = {
    root, J, blades: [], cur: {}, target: PP.idle, rate: 16, yawExtra: 0, hipH, flashMats: [], blob,
    apply(dt) {
      const k = 1 - Math.exp(-dt * this.rate);
      const t = this.target;
      for (const j of JOINTS) {
        const want = t[j] || Z3;
        const cur = this.cur[j] || (this.cur[j] = [0, 0, 0]);
        cur[0] += (want[0] - cur[0]) * k; cur[1] += (want[1] - cur[1]) * k; cur[2] += (want[2] - cur[2]) * k;
        J[j].rotation.set(cur[0], cur[1], cur[2]);
      }
      this.curY = (this.curY || 0) + ((t.y || 0) - (this.curY || 0)) * k;
      J.body.position.y = hipH + this.curY;
      this.yawExtra = t.yaw || 0;
    },
  };
  return rig;
}

function addBlade(rig, hand, meshes, len) {
  const holder = new THREE.Group();
  for (const m of meshes) holder.add(m);
  hand.add(holder);
  const base = new THREE.Object3D();
  base.position.z = len * 0.42;
  const tip = new THREE.Object3D();
  tip.position.z = len;
  holder.add(base, tip);
  rig.blades.push({ base, tip, holder });
}

export function makePlayer() {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const c = {
    cloth: S({ color: 0x3d6672, roughness: 0.7, emissive: 0x0a1a20 }),
    sash: S({ color: 0xbfeef2, roughness: 0.5, emissive: 0x2a5a60 }),
    legs: S({ color: 0x232c36, roughness: 0.8 }),
    boots: S({ color: 0x14181e, roughness: 0.6 }),
    bracer: S({ color: 0x8c9aa8, roughness: 0.4, metalness: 0.6 }),
    skin: S({ color: 0xd9b08c, roughness: 0.7 }),
  };
  const rig = buildRig(c);
  const { J } = rig;
  // hair knot + ribbon
  const hair = S({ color: 0x0c0c10, roughness: 0.6 });
  part(new THREE.SphereGeometry(0.132, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.11, -0.012, J.head);
  part(new THREE.SphereGeometry(0.055, 6, 5), hair, 0, 0.25, -0.03, J.head);
  // short rain cape over the shoulders
  const cape = S({ color: 0x6f8598, roughness: 0.6, emissive: 0x0c1218, side: THREE.DoubleSide });
  part(new THREE.CylinderGeometry(0.15, 0.4, 0.3, 10, 1, true), cape, 0, 0.43, 0, J.torso);
  // trailing scarf: keeps the silhouette readable in the rain
  const scarfM = S({ color: 0xd8f4f6, roughness: 0.6, emissive: 0x3a7078, side: THREE.DoubleSide });
  rig.scarf = [];
  let parent = J.torso;
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Group();
    s.position.set(i === 0 ? 0.08 : 0, i === 0 ? 0.52 : -0.26, i === 0 ? -0.14 : 0);
    parent.add(s);
    part(new THREE.BoxGeometry(0.11 - i * 0.015, 0.26, 0.015), scarfM, 0, -0.13, 0, s);
    rig.scarf.push(s);
    parent = s;
  }
  // tunic skirt
  part(new THREE.CylinderGeometry(0.22, 0.3, 0.3, 8, 1, true), c.cloth, 0, -0.12, 0, J.body).material = S({ color: 0x3d6672, roughness: 0.7, side: THREE.DoubleSide });
  // straight sword
  const steel = S({ color: 0xe6eef6, roughness: 0.22, metalness: 0.85, emissive: 0x40606c });
  const bl = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.055, 0.98), steel);
  bl.position.z = 0.6;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.12, 4), steel);
  tip.rotation.x = Math.PI / 2; tip.scale.x = 0.3; tip.position.z = 1.15;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.03), S({ color: 0xb08a3c, metalness: 0.9, roughness: 0.35 }));
  guard.position.z = 0.1;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.24, 6), S({ color: 0x1a2a30, roughness: 0.8 }));
  grip.rotation.x = Math.PI / 2; grip.position.z = -0.02;
  addBlade(rig, J.handR, [bl, tip, guard, grip], 1.2);
  rig.steel = steel;
  rig.target = PP.idle;
  rig.phase = 0;
  return rig;
}

export function makeBoss() {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const c = {
    cloth: S({ color: 0x6a1f1a, roughness: 0.65, emissive: 0x1a0504 }),
    sash: S({ color: 0xb08a3c, roughness: 0.35, metalness: 0.9 }),
    legs: S({ color: 0x1c1616, roughness: 0.8 }),
    boots: S({ color: 0x3a2a1c, roughness: 0.5, metalness: 0.4 }),
    bracer: S({ color: 0xa87a34, roughness: 0.3, metalness: 0.95 }),
    skin: S({ color: 0x15161a, roughness: 0.4, metalness: 0.7 }),
  };
  const rig = buildRig(c);
  const { J } = rig;
  rig.root.scale.setScalar(1.24);
  rig.blob.scale.setScalar(1.25);
  const brass = c.bracer;
  const iron = S({ color: 0x22262c, roughness: 0.4, metalness: 0.9 });
  // wide iron rain hat
  part(new THREE.CylinderGeometry(0.1, 0.44, 0.13, 14), iron, 0, 0.22, 0, J.head);
  part(new THREE.CylinderGeometry(0.45, 0.45, 0.02, 14), brass, 0, 0.155, 0, J.head);
  // mask slit that glows
  rig.eyeMat = new THREE.MeshBasicMaterial({ color: 0x8fe4ff, fog: false });
  part(new THREE.BoxGeometry(0.16, 0.022, 0.02), rig.eyeMat, 0, 0.11, 0.118, J.head);
  // pauldrons with cog rims
  for (const s of [-1, 1]) {
    const p = part(new THREE.SphereGeometry(0.13, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), brass, s * 0.3, 0.5, 0, J.torso);
    p.rotation.z = -s * 0.4;
    const cog = part(new THREE.CylinderGeometry(0.11, 0.11, 0.04, 8), iron, s * 0.37, 0.47, 0, J.torso);
    cog.rotation.z = Math.PI / 2;
  }
  // long coat skirt
  const coat = S({ color: 0x5a1915, roughness: 0.7, side: THREE.DoubleSide, emissive: 0x140403 });
  part(new THREE.CylinderGeometry(0.24, 0.42, 0.62, 10, 1, true), coat, 0, -0.26, 0, J.body);
  // back-mounted pressure pack with two vents
  part(new THREE.CylinderGeometry(0.1, 0.1, 0.36, 8), brass, 0, 0.3, -0.19, J.torso);
  for (const s of [-1, 1]) part(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6), iron, s * 0.09, 0.56, -0.2, J.torso);
  rig.vent = new THREE.Object3D();
  rig.vent.position.set(0, 0.75, -0.2);
  J.torso.add(rig.vent);
  rig.packGlow = new THREE.MeshBasicMaterial({ color: 0x5ac8ff, fog: false });
  part(new THREE.BoxGeometry(0.06, 0.2, 0.02), rig.packGlow, 0, 0.3, -0.295, J.torso);
  // waist lantern
  part(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 6), new THREE.MeshBasicMaterial({ color: 0xffb050, fog: false }), -0.2, -0.1, 0.12, J.body);
  // twin curved sabres
  rig.edgeMat = S({ color: 0xd4e2f0, roughness: 0.2, metalness: 0.8, emissive: 0x2c6c90, emissiveIntensity: 1 });
  for (const n of ['R', 'L']) {
    const meshes = [];
    const segs = 4;
    for (let i = 0; i < segs; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.085 - i * 0.012, 0.3), rig.edgeMat);
      const a = i * 0.07;
      m.position.set(0, -i * i * 0.012, 0.25 + i * 0.285);
      m.rotation.x = a;
      m.castShadow = true;
      meshes.push(m);
    }
    const gd = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.025, 8), brass);
    gd.rotation.x = Math.PI / 2; gd.position.z = 0.09;
    const gr = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 6), iron);
    gr.rotation.x = Math.PI / 2; gr.position.z = -0.02;
    meshes.push(gd, gr);
    addBlade(rig, J['hand' + n], meshes, 1.28);
  }
  rig.target = BP.wait;
  rig.phase = 0;
  rig.cloth = c.cloth;
  return rig;
}

// ------------------------------------------------------------------ animation

function walkCycle(pose, ph, amp) {
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  return add(pose, {
    legL: [-s * amp, 0, 0], shinL: [Math.max(0, c) * amp * 1.1, 0, 0],
    legR: [s * amp, 0, 0], shinR: [Math.max(0, -c) * amp * 1.1, 0, 0],
    armL: [s * amp * 0.6, 0, 0],
    y: Math.abs(c) * 0.04 * amp,
  });
}

export function animatePlayer(rig, p, dt, time) {
  let pose = PP.idle;
  let rate = 18;
  rig.trail = false;
  if (p.st === 'dead') {
    pose = mix(PP.hurt, PP.dead, ease(sat(p.t / 0.9)));
    rate = 10;
  } else if (p.st === 'hurt') {
    pose = PP.hurt; rate = 30;
  } else if (p.st === 'dodge') {
    const side = p.dodgeX * Math.cos(p.yaw) - p.dodgeZ * Math.sin(p.yaw); // + = toward local +x
    const fwd = p.dodgeX * Math.sin(p.yaw) + p.dodgeZ * Math.cos(p.yaw);
    const u = sat(p.t / DODGE.dur);
    pose = add(PP.dodge, { body: [fwd * 0.35, 0, -side * 0.55] });
    if (u > 0.75) pose = mix(pose, PP.idle, (u - 0.75) * 4);
    rate = 28;
  } else if (p.st === 'attack') {
    const A = ATTACKS[p.combo];
    const a = [PP.s1a, PP.s2a, PP.s3a][p.combo];
    const b = [PP.s1b, PP.s2b, PP.s3b][p.combo];
    const t0 = A.wind * 0.55;
    const t1 = A.wind + A.act + 0.05;
    if (p.t < t0) { pose = a; rate = 45; }
    else if (p.t < t1) { pose = mix(a, b, ease((p.t - t0) / (t1 - t0))); rate = 70; rig.trail = true; }
    else { pose = mix(b, PP.idle, sat((p.t - t1) / (A.rec - 0.05)) ** 2); rate = 30; rig.trail = p.t < t1 + 0.06; }
  } else if (p.guard) {
    pose = PP.guard; rate = 30;
    if (p.moving) { rig.phase += dt * 7; pose = walkCycle(pose, rig.phase, 0.3); }
  } else if (p.moving) {
    rig.phase += dt * 13;
    pose = walkCycle(PP.run, rig.phase, 0.85);
    rate = 24;
  } else {
    pose = add(PP.idle, { y: Math.sin(time * 2.2) * 0.012, torso: [Math.sin(time * 2.2) * 0.02, 0, 0] });
  }
  rig.target = pose; rig.rate = rate;
  rig.apply(dt);
  // scarf drag
  const sp = p.moving || p.st === 'dodge' ? 1 : 0;
  rig.scarfV = (rig.scarfV || 0) + (sp - (rig.scarfV || 0)) * Math.min(1, dt * 6);
  for (let i = 0; i < rig.scarf.length; i++) {
    rig.scarf[i].rotation.x = (i === 0 ? 0.25 : 0.1) + rig.scarfV * (i === 0 ? 0.9 : 0.25) + Math.sin(time * 5 + i * 1.3) * (0.08 + rig.scarfV * 0.1);
    rig.scarf[i].rotation.z = Math.sin(time * 3.1 + i) * 0.08;
  }
}

export function animateBoss(rig, b, dt, time) {
  let pose = BP.idle;
  let rate = 14;
  rig.trailR = false; rig.trailL = false;
  const breathe = { y: Math.sin(time * 2.6) * 0.015, torso: [Math.sin(time * 2.6) * 0.03, 0, 0] };
  const s = currentSeg(b);
  if (b.st === 'wait') {
    pose = add(BP.wait, breathe); rate = 6;
  } else if (b.st === 'intro') {
    pose = mix(BP.wait, BP.idle, ease(sat((b.t - 0.5) / 0.8))); rate = 10;
  } else if (b.st === 'dead') {
    pose = b.t < 0.9 ? mix(BP.recover, BP.kneel, ease(b.t / 0.9)) : mix(BP.kneel, BP.dead, ease(sat((b.t - 0.9) / 0.8)));
    rate = 9;
  } else if (b.st === 'phase') {
    if (b.t < 1.25) pose = add(mix(BP.recover, BP.kneel, ease(sat(b.t / 0.5))), { torso: [Math.sin(time * 40) * 0.02 * sat(b.t), 0, 0] });
    else if (b.t < 2.4) pose = add(BP.roar, { torso: [0, 0, Math.sin(time * 50) * 0.02] });
    else pose = mix(BP.roar, BP.idle, (b.t - 2.4) / 0.4);
    rate = b.t < 1.25 ? 10 : 22;
  } else if (b.st === 'idle') {
    pose = add(BP.idle, breathe);
    if (b.moving) { rig.phase += dt * 8.5; pose = walkCycle(pose, rig.phase, 0.55); }
  } else if (s) {
    const u = sat(b.segT / s.d);
    const next = b.move.segs[b.si + 1];
    const prev = b.move.segs[b.si - 1];
    const pre = (anim) => ({ slashR: BP.slashRa, slashL: BP.slashLa, slam: BP.delayWind, spin: BP.spinWind, reverse: BP.revWind, dash: BP.lungeWind }[anim]);
    const post = (anim) => ({ slashR: BP.slashRb, slashL: BP.slashLb, slam: BP.slam, spin: BP.spin, reverse: BP.revHit, dash: BP.dash }[anim]);
    if (s.k === 'wind') {
      if (s.tele === 'chain') { pose = u < 0.72 ? BP.chainWind : mix(BP.chainWind, BP.slashRa, (u - 0.72) / 0.28); rate = u < 0.72 ? 14 : 40; }
      else if (s.tele === 'delay') { pose = mix(s.again ? BP.slam : BP.idle, BP.delayWind, ease(u)); rate = s.again ? 30 : 16; }
      else if (s.tele === 'lunge') { pose = mix(BP.idle, BP.lungeWind, ease(sat(u * 1.6))); rate = 18; }
    } else if (s.k === 'hold') {
      if (s.tele === 'delayHold') { pose = add(BP.delayWind, { armR: [Math.sin(time * 60) * 0.015, 0, 0], armL: [Math.cos(time * 60) * 0.015, 0, 0] }); rate = 30; }
      else if (s.tele === 'spin') { pose = BP.spinWind; rate = 18; }
      else if (s.tele === 'reverse') { pose = BP.revWind; rate = 22; }
    } else if (s.k === 'gap') {
      pose = u < 0.35 ? post(prev.anim) : mix(post(prev.anim), pre(next.anim), (u - 0.35) / 0.5);
      rate = 45;
    } else if (s.k === 'hit') {
      pose = mix(pre(s.anim), post(s.anim), ease(u));
      if (s.anim === 'spin') pose = add(pose, { yaw: Math.PI * 2 * sat(b.segT / 0.36) });
      rate = 80;
      if (s.anim === 'slashR' || s.anim === 'reverse') rig.trailR = true;
      else if (s.anim === 'slashL') rig.trailL = true;
      else { rig.trailR = true; rig.trailL = true; }
    } else if (s.k === 'dash') {
      pose = BP.dash; rate = 50; rig.trailR = true; rig.trailL = true;
    } else if (s.k === 'rec') {
      const lastAnim = prev ? prev.anim : null;
      const tail = s.d - b.segT;
      if (b.segT < 0.22 && lastAnim) {
        pose = post(lastAnim);
        if (lastAnim === 'spin') pose = add(pose, { yaw: Math.PI * 2 * sat((prev.d + b.segT) / 0.36) });
        rate = 40;
        rig.trailR = b.segT < 0.12 && lastAnim !== 'slashL';
        rig.trailL = b.segT < 0.12 && lastAnim !== 'slashR' && lastAnim !== 'reverse';
      } else if (tail < 0.3) { pose = mix(BP.idle, BP.recover, tail / 0.3); rate = 14; }
      else { pose = add(BP.recover, { y: Math.sin(time * 7) * 0.03, torso: [Math.sin(time * 7) * 0.06, 0, 0] }); rate = 12; }
    }
  }
  rig.target = pose; rig.rate = rate;
  rig.apply(dt);
}
