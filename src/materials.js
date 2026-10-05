import * as THREE from 'three';

// Palette d'aube : blancs chauds, corail pour guider le regard, verts tendres.
export const COLORS = {
  stone: 0xf3ece6,
  stoneShade: 0xe6dcd6,
  plaster: 0xf7f1ea,
  accent: 0xff8a6a,
  accentSoft: 0xffb497,
  wood: 0xc9a07e,
  trunk: 0x8d6e60,
  blossom: 0xf6b4c6,
  leaf: 0x9fc79b,
  water: 0x9fd6e2,
  glow: 0xffd9a8,
};

export function createMaterials() {
  const m = {
    stone: new THREE.MeshStandardMaterial({ color: COLORS.stone, roughness: 0.88, metalness: 0 }),
    stoneShade: new THREE.MeshStandardMaterial({ color: COLORS.stoneShade, roughness: 0.9, metalness: 0 }),
    plaster: new THREE.MeshStandardMaterial({ color: COLORS.plaster, roughness: 0.8, metalness: 0 }),
    accent: new THREE.MeshStandardMaterial({ color: COLORS.accent, roughness: 0.6, metalness: 0, emissive: COLORS.accent, emissiveIntensity: 0.08 }),
    wood: new THREE.MeshStandardMaterial({ color: COLORS.wood, roughness: 0.75 }),
    trunk: new THREE.MeshStandardMaterial({ color: COLORS.trunk, roughness: 0.9 }),
    blossom: new THREE.MeshStandardMaterial({ color: COLORS.blossom, roughness: 0.7, flatShading: true }),
    leaf: new THREE.MeshStandardMaterial({ color: COLORS.leaf, roughness: 0.8, flatShading: true }),
    water: new THREE.MeshStandardMaterial({ color: COLORS.water, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85 }),
    glow: new THREE.MeshStandardMaterial({ color: COLORS.glow, emissive: COLORS.glow, emissiveIntensity: 1.1, roughness: 0.5 }),
  };
  return m;
}
