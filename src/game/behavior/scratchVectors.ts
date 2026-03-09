import * as THREE from "three";

// Pre-allocated vectors for zero-allocation steering math.
// Each drive function uses one or two of these. Since drives
// are computed sequentially, 16 is more than enough.
const pool: THREE.Vector3[] = [];
for (let i = 0; i < 16; i++) {
	pool.push(new THREE.Vector3());
}

let nextIndex = 0;

/** Get a scratch vector (reset to 0,0,0). Call resetPool() at the start of each frame. */
export function scratch(): THREE.Vector3 {
	const v = pool[nextIndex % pool.length];
	nextIndex++;
	return v.set(0, 0, 0);
}

/** Reset the pool index. Call once per frame before any drive calculations. */
export function resetPool(): void {
	nextIndex = 0;
}
