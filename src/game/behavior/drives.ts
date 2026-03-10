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

/** Steer away from quark shard positions. Non-quark entities give them wide berth.
 *  Motes get a tangential swirl force instead — they orbit the quarks. */
export function quarkAvoidanceDrive(entity: BehaviorState, ctx: BehaviorContext): THREE.Vector3 {
	const steer = scratch();
	if (entity.kind === "quarkShard") return steer;
	if (ctx.quarkShardPositions.length === 0) return steer;

	const avoidRadius = entity.kind === "mote" ? 5.0 : 10.0; // motes swirl zone, others flee wide
	const avoidRadiusSq = avoidRadius * avoidRadius;

	for (let i = 0; i < ctx.quarkShardPositions.length; i++) {
		const shard = ctx.quarkShardPositions[i];
		const dx = entity.position.x - shard.x;
		const dy = entity.position.y - shard.y;
		const dz = entity.position.z - shard.z;
		const distSq = dx * dx + dy * dy + dz * dz;
		if (distSq < avoidRadiusSq && distSq > 0.01) {
			const dist = Math.sqrt(distSq);
			const urgency = 1 - dist / avoidRadius;

			if (entity.kind === "mote") {
				// Tangential swirl — motes orbit around the quark pair
				// Base swirl always present, treble energy amplifies it (flourishes)
				const flourish = 0.4 + ctx.trebleEnergy * 1.2; // base 0.4, up to 1.6 on treble
				const swirlStrength = urgency * urgency * flourish;
				// Cross product of (dx,dy,0) with (0,0,1) = (dy, -dx, 0)
				steer.x += dy / dist * swirlStrength;
				steer.y += -dx / dist * swirlStrength;
				// Gentle inward pull to keep them in orbit
				const pullStrength = urgency * 0.3;
				steer.x -= dx / dist * pullStrength;
				steer.y -= dy / dist * pullStrength;
			} else {
				// Other entities: strong repulsion
				steer.x += (dx / dist) * urgency * 1.5;
				steer.y += (dy / dist) * urgency * 1.5;
				steer.z += (dz / dist) * urgency;
			}
		}
	}
	return steer;
}

// --- Murmuration state ---
let _murmNextTrigger = 0;
let _murmActive = false;
let _murmStartTime = 0;
let _murmJustTriggered = false; // true for one frame when a new murmuration starts

/** Returns true once when a new murmuration event starts, then resets. */
export function didMurmurationJustTrigger(): boolean {
	if (_murmJustTriggered) {
		_murmJustTriggered = false;
		return true;
	}
	return false;
}
// Per-mote data for recruited motes
interface MurmData {
	startX: number;       // position when recruited
	startY: number;
	cloudAngle: number;   // mote's fixed angle within the cloud shape
	cloudRadius: number;  // mote's fixed distance from cloud center (compact)
	zBoost: number;
}
const _murmData = new WeakMap<BehaviorState, MurmData>();

// Helix path parameters for the flock center
let _helixRadius = 0;     // how far from tunnel center the helix orbits
let _helixSpeed = 0;       // angular speed of the helix (rad/s)
let _helixPhase = 0;       // starting angle

const FIRST_EVENT_DELAY = 60000; // 60s before first murmuration
const MIN_IDLE = 15000;
const MAX_IDLE = 30000;

// Per-event parameters — randomized at trigger time
let _evGatherDuration = 2000;
let _evFlyDuration = 5000;
let _evZBoostBase = 6;      // initial z speed
let _evZBoostFlock = 14;    // faster once flocked
let _evCloudRadius = 0.8;   // how compact the cloud is

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
 * Murmuration: periodically, motes ahead form a compact cloud that
 * spirals through the tunnel on a helix path (like a loose corkscrew).
 * All motes move in unison — same rotational velocity, same center —
 * just distributed at fixed positions within the cloud shape.
 * The flock compacts and accelerates once gathered.
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
		_murmJustTriggered = true;

		// Helix path: flock center spirals through the tunnel
		_helixRadius = 1.5 + Math.random() * 2.5;  // 1.5-4.0 from tunnel center
		_helixSpeed = 1.2 + Math.random() * 1.8;    // 1.2-3.0 rad/s (loose spiral)
		_helixPhase = Math.random() * Math.PI * 2;

		// Randomize per-event shape
		_evGatherDuration = 1500 + Math.random() * 1000;  // 1.5-2.5s gather
		_evFlyDuration = 4000 + Math.random() * 4000;     // 4-8s flight
		_evZBoostBase = 4 + Math.random() * 4;            // 4-8 initial speed
		_evZBoostFlock = 10 + Math.random() * 8;          // 10-18 once flocked
		_evCloudRadius = 0.4 + Math.random() * 0.6;       // 0.4-1.0 cloud compactness

		// Recruit motes in the z-range
		// Distribute them evenly throughout the cloud shape
		let recruitIndex = 0;
		for (let i = 0; i < entities.length; i++) {
			const e = entities[i];
			if (e.kind !== "mote") continue;
			const z = e.position.z;
			if (z < -35 && z > -65) {
				// Golden angle distribution for even cloud fill
				const golden = 2.399963; // golden angle in radians
				const angle = recruitIndex * golden;
				// Sqrt distribution for even area coverage
				const r = _evCloudRadius * Math.sqrt((recruitIndex + 1) / 30); // normalize assuming ~30 motes
				_murmData.set(e, {
					startX: e.position.x,
					startY: e.position.y,
					cloudAngle: angle,
					cloudRadius: Math.min(r, _evCloudRadius),
					zBoost: 0,
				});
				recruitIndex++;
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
		for (let i = 0; i < entities.length; i++) {
			_murmData.delete(entities[i]);
		}
		return;
	}

	const elapsedSec = elapsed / 1000;

	// --- Compute flock center on helix path ---
	// The whole flock center spirals through the tunnel like a loose corkscrew
	const helixAngle = _helixPhase + _helixSpeed * elapsedSec;
	const flockCX = Math.cos(helixAngle) * _helixRadius;
	const flockCY = Math.sin(helixAngle) * _helixRadius;

	// Cloud rotation: the entire cloud shape rotates as a unit (slower than helix)
	const cloudRotation = elapsedSec * 1.5; // shared rotation for all motes

	// Cloud compaction: starts loose, compresses once flocked
	const flyProgress = Math.max(0, (elapsed - _evGatherDuration) / _evFlyDuration);
	const compaction = elapsed < _evGatherDuration
		? 1.0  // normal during gather
		: 1.0 - flyProgress * 0.4; // compress to 60% radius during flight

	// --- Find z-extent of recruited motes (for wave) ---
	let minZ = Infinity, maxZ = -Infinity;
	for (let i = 0; i < entities.length; i++) {
		if (!_murmData.has(entities[i])) continue;
		const z = entities[i].position.z;
		if (z < minZ) minZ = z;
		if (z > maxZ) maxZ = z;
	}
	const zSpan = maxZ - minZ;

	// --- Invisible wavefront: bounces back and forth along the recruited line ---
	// Ping-pong position within [minZ, maxZ]
	const wavePeriod = 1.2; // seconds for one full pass
	const waveT = (elapsedSec % (wavePeriod * 2)) / wavePeriod; // 0→2 sawtooth
	const wavePingPong = waveT < 1 ? waveT : 2 - waveT; // 0→1→0 triangle
	const wavefrontZ = minZ + wavePingPong * zSpan;
	const waveWidth = Math.max(zSpan * 0.25, 3); // wavefront influence width
	const waveAmp = 1.2; // max radial displacement

	// --- Update each recruited mote ---
	for (let i = 0; i < entities.length; i++) {
		const e = entities[i];
		const data = _murmData.get(e);
		if (!data) continue;

		// Each mote has a fixed position in the cloud, rotated by the shared cloudRotation
		const rotatedAngle = data.cloudAngle + cloudRotation;
		const r = data.cloudRadius * compaction;
		const moteTargetX = flockCX + Math.cos(rotatedAngle) * r;
		const moteTargetY = flockCY + Math.sin(rotatedAngle) * r;

		if (elapsed < _evGatherDuration) {
			// GATHER: lerp from start position toward cloud position
			const t = elapsed / _evGatherDuration;
			const ease = t * t * (3 - 2 * t); // smoothstep

			e.position.x = data.startX + (moteTargetX - data.startX) * ease;
			e.position.y = data.startY + (moteTargetY - data.startY) * ease;

			// Gradually increase speed during gather
			data.zBoost = _evZBoostBase * ease;
		} else {
			// FLY: all motes move in unison on the helix, accelerating
			e.position.x = moteTargetX;
			e.position.y = moteTargetY;

			// --- Wave displacement: push outward as wavefront passes ---
			const dz = Math.abs(e.position.z - wavefrontZ);
			if (dz < waveWidth) {
				// Smooth bell curve falloff — strongest at wavefront center
				const proximity = 1 - (dz / waveWidth);
				const wavePush = proximity * proximity * waveAmp;
				// Push radially outward from flock center
				const dx = e.position.x - flockCX;
				const dy = e.position.y - flockCY;
				const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
				e.position.x += (dx / dist) * wavePush;
				e.position.y += (dy / dist) * wavePush;
			}

			// Accelerate as the flock tightens — figure skater effect
			const speedRamp = _evZBoostBase + (_evZBoostFlock - _evZBoostBase) * flyProgress;
			data.zBoost = speedRamp;
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
