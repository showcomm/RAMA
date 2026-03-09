import * as THREE from "three";
import type { BehaviorContext, BehaviorState } from "./types";
import { scratch } from "./scratchVectors";

/** Steer away from nearby entities to avoid overlap. */
export function separation(entity: BehaviorState, neighbors: BehaviorState[]): THREE.Vector3 {
	const steer = scratch();
	let count = 0;
	for (let i = 0; i < neighbors.length; i++) {
		const other = neighbors[i];
		const dx = entity.position.x - other.position.x;
		const dy = entity.position.y - other.position.y;
		const dz = entity.position.z - other.position.z;
		const distSq = dx * dx + dy * dy + dz * dz;
		if (distSq < 4.0 && distSq > 0.001) { // Within 2 units
			const invDist = 1 / Math.sqrt(distSq);
			// Stronger repulsion when closer
			steer.x += dx * invDist / Math.sqrt(distSq);
			steer.y += dy * invDist / Math.sqrt(distSq);
			steer.z += dz * invDist / Math.sqrt(distSq);
			count++;
		}
	}
	if (count > 0) {
		steer.divideScalar(count);
	}
	return steer;
}

/** Steer toward average velocity of same-kind neighbors. */
export function alignment(entity: BehaviorState, neighbors: BehaviorState[]): THREE.Vector3 {
	const steer = scratch();
	let count = 0;
	for (let i = 0; i < neighbors.length; i++) {
		const other = neighbors[i];
		if (other.kind !== entity.kind) continue;
		steer.x += other.velocity.x;
		steer.y += other.velocity.y;
		steer.z += other.velocity.z;
		count++;
	}
	if (count > 0) {
		steer.divideScalar(count);
		steer.sub(entity.velocity); // Steer toward average
	}
	return steer;
}

/** Steer toward center of mass of same-kind neighbors. */
export function cohesion(entity: BehaviorState, neighbors: BehaviorState[]): THREE.Vector3 {
	const steer = scratch();
	let count = 0;
	for (let i = 0; i < neighbors.length; i++) {
		const other = neighbors[i];
		if (other.kind !== entity.kind) continue;
		steer.x += other.position.x;
		steer.y += other.position.y;
		steer.z += other.position.z;
		count++;
	}
	if (count > 0) {
		steer.divideScalar(count);
		steer.sub(entity.position); // Direction toward center
	}
	return steer;
}

/** Steer toward the player. Strength scales with curiosity, reduced by rage. */
export function curiosityDrive(entity: BehaviorState, ctx: BehaviorContext): THREE.Vector3 {
	const steer = scratch();
	const strength = entity.personality.curiosity * (1 - ctx.rageNormalized * 0.7);
	if (strength < 0.01) return steer;

	steer.x = ctx.playerPosition.x - entity.position.x;
	steer.y = ctx.playerPosition.y - entity.position.y;
	steer.z = ctx.playerPosition.z - entity.position.z;
	const len = steer.length();
	if (len > 0.1) {
		steer.divideScalar(len);
		steer.multiplyScalar(strength);
	}
	return steer;
}

/** Steer to charge the player. Only activates at higher rage. */
export function aggressionDrive(entity: BehaviorState, ctx: BehaviorContext): THREE.Vector3 {
	const steer = scratch();
	const strength = entity.personality.aggression * ctx.rageNormalized;
	if (strength < 0.05 || ctx.rageNormalized < 0.3) return steer;

	steer.x = ctx.playerPosition.x - entity.position.x;
	steer.y = ctx.playerPosition.y - entity.position.y;
	steer.z = ctx.playerPosition.z - entity.position.z;
	const len = steer.length();
	if (len > 0.1) {
		steer.divideScalar(len);
		steer.multiplyScalar(strength * 2.0); // Aggression is more forceful
	}
	return steer;
}

/** Steer away from the player when too close. Scales with fearfulness. */
export function avoidanceDrive(entity: BehaviorState, ctx: BehaviorContext): THREE.Vector3 {
	const steer = scratch();
	const dx = entity.position.x - ctx.playerPosition.x;
	const dy = entity.position.y - ctx.playerPosition.y;
	const dz = entity.position.z - ctx.playerPosition.z;
	const distSq = dx * dx + dy * dy + dz * dz;
	const threshold = 25; // 5 units squared

	if (distSq < threshold && distSq > 0.01) {
		const dist = Math.sqrt(distSq);
		const urgency = 1 - dist / 5; // Stronger when closer
		const strength = entity.personality.fearfulness * urgency * entity.mood.fear;
		steer.set(dx / dist, dy / dist, dz / dist).multiplyScalar(strength);
	}
	return steer;
}

/** Steer away from active flare positions. */
export function fearDrive(entity: BehaviorState, ctx: BehaviorContext): THREE.Vector3 {
	const steer = scratch();
	if (ctx.activeFlarePositions.length === 0) return steer;

	const fearfulness = entity.personality.fearfulness;
	if (fearfulness < 0.01) return steer;

	for (let i = 0; i < ctx.activeFlarePositions.length; i++) {
		const flare = ctx.activeFlarePositions[i];
		const dx = entity.position.x - flare.x;
		const dy = entity.position.y - flare.y;
		const dz = entity.position.z - flare.z;
		const distSq = dx * dx + dy * dy + dz * dz;
		if (distSq < 400 && distSq > 0.01) { // Within 20 units
			const dist = Math.sqrt(distSq);
			const urgency = 1 - dist / 20;
			steer.x += (dx / dist) * urgency;
			steer.y += (dy / dist) * urgency;
			steer.z += (dz / dist) * urgency;
		}
	}
	steer.multiplyScalar(fearfulness);
	return steer;
}

/** Steer away from entities of different types. */
export function territoryDrive(entity: BehaviorState, neighbors: BehaviorState[]): THREE.Vector3 {
	const steer = scratch();
	const strength = entity.personality.territoriality;
	if (strength < 0.01) return steer;

	let count = 0;
	for (let i = 0; i < neighbors.length; i++) {
		const other = neighbors[i];
		if (other.kind === entity.kind) continue;
		const dx = entity.position.x - other.position.x;
		const dy = entity.position.y - other.position.y;
		const dz = entity.position.z - other.position.z;
		const distSq = dx * dx + dy * dy + dz * dz;
		if (distSq > 0.01) {
			const dist = Math.sqrt(distSq);
			steer.x += (dx / dist) * strength;
			steer.y += (dy / dist) * strength;
			steer.z += (dz / dist) * strength;
			count++;
		}
	}
	if (count > 0) steer.divideScalar(count);
	return steer;
}

/** Steer away from quark shard positions. Non-quark entities give them wide berth. */
export function quarkAvoidanceDrive(entity: BehaviorState, ctx: BehaviorContext): THREE.Vector3 {
	const steer = scratch();
	// Quark shards themselves and motes don't avoid
	if (entity.kind === "quarkShard" || entity.kind === "mote") return steer;
	if (ctx.quarkShardPositions.length === 0) return steer;

	const avoidRadius = 4.0; // entities steer away within 4 units
	const avoidRadiusSq = avoidRadius * avoidRadius;

	for (let i = 0; i < ctx.quarkShardPositions.length; i++) {
		const shard = ctx.quarkShardPositions[i];
		const dx = entity.position.x - shard.x;
		const dy = entity.position.y - shard.y;
		const dz = entity.position.z - shard.z;
		const distSq = dx * dx + dy * dy + dz * dz;
		if (distSq < avoidRadiusSq && distSq > 0.01) {
			const dist = Math.sqrt(distSq);
			const urgency = 1 - dist / avoidRadius; // stronger when closer
			steer.x += (dx / dist) * urgency;
			steer.y += (dy / dist) * urgency;
			steer.z += (dz / dist) * urgency;
		}
	}
	return steer;
}

// --- Murmuration state ---
let _murmNextTrigger = 0;
let _murmActive = false;
let _murmStartTime = 0;
// Per-mote data for recruited motes
interface MurmData {
	startX: number;       // position when recruited
	startY: number;
	swirlAngle: number;   // unique orbit phase per mote
	orbitRadius: number;   // unique orbit radius per mote (loose cloud)
	zBoost: number;
}
const _murmData = new WeakMap<BehaviorState, MurmData>();
// Sine wave params for the vortex center path
let _murmSineAngle = 0;   // direction the sine wave oscillates across
let _murmSineAmp = 0;
let _murmSineFreq = 0;

const FIRST_EVENT_DELAY = 60000; // 60s before first murmuration
const MIN_IDLE = 15000;
const MAX_IDLE = 30000;

// Per-event parameters — randomized at trigger time
let _evGatherDuration = 2000;
let _evFlyDuration = 5000;
let _evZBoost = 8;
let _evOrbitSpeed = 2.5;
let _evCloudMin = 0.3;
let _evCloudMax = 1.2;

/**
 * Get the extra z-speed for a mote in murmuration. Returns 0 if not recruited.
 * TunnelGame calls this and adds to the mote's z movement.
 */
export function getMurmurationZBoost(entity: BehaviorState): number {
	return _murmData.get(entity)?.zBoost ?? 0;
}

/**
 * Check if a mote is currently recruited into murmuration.
 * If true, the behavior system should skip normal steering for this entity.
 */
export function isMurmurationActive(entity: BehaviorState): boolean {
	return _murmData.has(entity);
}

/**
 * Murmuration: periodically, motes 7-13 panels ahead form a loose
 * swirling cloud that corkscrews toward the ship in a sine-wave path,
 * then flies past and off screen. Directly sets entity position —
 * bypasses normal steering entirely for recruited motes.
 */
export function updateMurmuration(ctx: BehaviorContext, entities: readonly BehaviorState[]): void {
	const now = ctx.currentTime;

	// Initialize timing — first event after 60s
	if (_murmNextTrigger === 0) {
		_murmNextTrigger = now + FIRST_EVENT_DELAY;
	}

	// --- Trigger new event ---
	if (!_murmActive && now >= _murmNextTrigger) {
		_murmActive = true;
		_murmStartTime = now;
		_murmSineAngle = Math.random() * Math.PI * 2;
		_murmSineAmp = 1.5 + Math.random() * 3.5;        // 1.5-5.0 (how wide the sine sweeps)
		_murmSineFreq = 0.6 + Math.random() * 1.4;        // 0.6-2.0 (how many oscillations)

		// Randomize per-event shape
		_evGatherDuration = 1500 + Math.random() * 1500;   // 1.5-3s gather
		_evFlyDuration = 3000 + Math.random() * 5000;      // 3-8s fly
		_evZBoost = 5 + Math.random() * 6;                 // 5-11 speed
		_evOrbitSpeed = 1.5 + Math.random() * 3.0;         // 1.5-4.5 rad/s swirl
		_evCloudMin = 0.15 + Math.random() * 0.3;          // 0.15-0.45 tight core
		_evCloudMax = 0.6 + Math.random() * 1.2;           // 0.6-1.8 outer edge

		// Recruit motes in the z-range
		for (let i = 0; i < entities.length; i++) {
			const e = entities[i];
			if (e.kind !== "mote") continue;
			const z = e.position.z;
			if (z < -35 && z > -65) {
				_murmData.set(e, {
					startX: e.position.x,
					startY: e.position.y,
					swirlAngle: Math.random() * Math.PI * 2,
					orbitRadius: _evCloudMin + Math.random() * (_evCloudMax - _evCloudMin),
					zBoost: 0,
				});
			}
		}
	}

	if (!_murmActive) return;

	const elapsed = now - _murmStartTime;
	const totalDuration = _evGatherDuration + _evFlyDuration;

	// --- End event ---
	if (elapsed > totalDuration) {
		_murmActive = false;
		_murmNextTrigger = now + MIN_IDLE + Math.random() * (MAX_IDLE - MIN_IDLE);
		// Clean up all recruited motes
		for (let i = 0; i < entities.length; i++) {
			_murmData.delete(entities[i]);
		}
		return;
	}

	// --- Compute vortex center (sine wave across tunnel cross-section) ---
	const flyProgress = Math.max(0, (elapsed - _evGatherDuration) / _evFlyDuration);
	const sineValue = Math.sin(flyProgress * _murmSineFreq * Math.PI * 2) * _murmSineAmp;
	const vortexCX = Math.cos(_murmSineAngle) * sineValue;
	const vortexCY = Math.sin(_murmSineAngle) * sineValue;

	const elapsedSec = elapsed / 1000;

	// --- Update each recruited mote ---
	for (let i = 0; i < entities.length; i++) {
		const e = entities[i];
		const data = _murmData.get(e);
		if (!data) continue;

		if (elapsed < _evGatherDuration) {
			// GATHER: lerp from start position toward vortex orbit position
			const t = elapsed / _evGatherDuration;
			// Ease-in-out
			const ease = t * t * (3 - 2 * t);

			// Where this mote will orbit on the cloud
			const angle = data.swirlAngle + _evOrbitSpeed * elapsedSec;
			const orbitX = vortexCX + Math.cos(angle) * data.orbitRadius;
			const orbitY = vortexCY + Math.sin(angle) * data.orbitRadius;

			// Blend from start to orbit position
			e.position.x = data.startX + (orbitX - data.startX) * ease;
			e.position.y = data.startY + (orbitY - data.startY) * ease;

			// Ramp up z-boost
			data.zBoost = _evZBoost * ease * 0.5;
		} else {
			// FLY: orbit the vortex center, which is tracing a sine wave
			const angle = data.swirlAngle + _evOrbitSpeed * elapsedSec;
			// Vary orbit radius slightly over time for organic feel
			const r = data.orbitRadius * (0.8 + 0.2 * Math.sin(angle * 0.6));

			e.position.x = vortexCX + Math.cos(angle) * r;
			e.position.y = vortexCY + Math.sin(angle) * r;

			// Full z-boost
			data.zBoost = _evZBoost;
		}
	}
}

// Keep the old function signature but as a no-op (drive is now updateMurmuration)
export function murmurationDrive(
	_entity: BehaviorState,
	_neighbors: BehaviorState[],
	_ctx: BehaviorContext,
): THREE.Vector3 {
	return scratch(); // always zero — murmuration is handled by updateMurmuration
}

/** Soft constraint: push inward when near the tunnel wall. */
export function tunnelConstraint(entity: BehaviorState, ctx: BehaviorContext): THREE.Vector3 {
	const steer = scratch();
	const x = entity.position.x;
	const y = entity.position.y;
	const distFromCenter = Math.sqrt(x * x + y * y);
	const wallThreshold = ctx.tunnelRadius * 0.85;

	if (distFromCenter > wallThreshold && distFromCenter > 0.1) {
		const overshoot = (distFromCenter - wallThreshold) / (ctx.tunnelRadius - wallThreshold);
		const pushStrength = Math.min(overshoot * 3.0, 5.0);
		steer.x = (-x / distFromCenter) * pushStrength;
		steer.y = (-y / distFromCenter) * pushStrength;
	}
	return steer;
}
