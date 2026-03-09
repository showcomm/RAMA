import * as THREE from "three";
import type { BehaviorContext, BehaviorState, EntityKind, MoodState } from "./types";
import { PERSONALITY_DEFAULTS, MAX_ACCELERATION, VELOCITY_DAMPING, NEIGHBOR_RADIUS } from "./profiles";
import { SpatialIndex } from "./spatialIndex";
import { resetPool } from "./scratchVectors";
import {
	separation,
	alignment,
	cohesion,
	curiosityDrive,
	aggressionDrive,
	avoidanceDrive,
	fearDrive,
	territoryDrive,
	murmurationDrive,
	tunnelConstraint,
	quarkAvoidanceDrive,
	updateMurmuration,
	isMurmurationActive,
} from "./drives";

const _steeringAccum = new THREE.Vector3();

export class BehaviorSystem {
	private entities: BehaviorState[] = [];
	private spatialIndex = new SpatialIndex();

	/** Create and register a new behavior state for an entity. */
	register(
		kind: EntityKind,
		position: THREE.Vector3,
		groupId: string | null = null,
	): BehaviorState {
		const defaults = PERSONALITY_DEFAULTS[kind];
		// Add slight per-entity variation (+-10%) for organic feel
		const vary = (base: number) => Math.max(0, Math.min(1, base + (Math.random() - 0.5) * 0.2));

		const state: BehaviorState = {
			kind,
			position: position.clone(),
			velocity: new THREE.Vector3(
				(Math.random() - 0.5) * 0.5,
				(Math.random() - 0.5) * 0.5,
				0,
			),
			personality: {
				curiosity: vary(defaults.curiosity),
				aggression: vary(defaults.aggression),
				sociability: vary(defaults.sociability),
				territoriality: vary(defaults.territoriality),
				fearfulness: vary(defaults.fearfulness),
			},
			mood: { alertness: 0, anger: 0, fear: 0, excitement: 0 },
			groupId,
			birthTime: Date.now(),
			lastReactionTime: 0,
			tunnelAngle: 0,
			tunnelRadius: 0,
		};

		this.entities.push(state);
		return state;
	}

	/** Remove an entity from the behavior system. */
	unregister(state: BehaviorState): void {
		const idx = this.entities.indexOf(state);
		if (idx >= 0) {
			// Swap with last for O(1) removal
			this.entities[idx] = this.entities[this.entities.length - 1];
			this.entities.pop();
		}
	}

	/** Run one frame of behavior updates. */
	update(ctx: BehaviorContext): void {
		resetPool();

		// Phase 1: Rebuild spatial index
		this.spatialIndex.clear();
		for (let i = 0; i < this.entities.length; i++) {
			this.spatialIndex.insert(this.entities[i]);
		}

		// Phase 2: Compute global mood
		let totalAnger = 0;
		let totalFear = 0;
		let totalExcitement = 0;
		for (let i = 0; i < this.entities.length; i++) {
			const m = this.entities[i].mood;
			totalAnger += m.anger;
			totalFear += m.fear;
			totalExcitement += m.excitement;
		}
		const count = this.entities.length || 1;
		ctx.globalMood = {
			avgAnger: totalAnger / count,
			avgFear: totalFear / count,
			avgExcitement: totalExcitement / count,
		};

		// Phase 2.5: Update murmuration (directly sets positions for recruited motes)
		updateMurmuration(ctx, this.entities);

		// Phase 3 & 4: Per-entity steering + apply
		for (let i = 0; i < this.entities.length; i++) {
			const entity = this.entities[i];
			const radius = NEIGHBOR_RADIUS[entity.kind];
			const neighbors = this.spatialIndex.query(entity, radius);

			// Skip steering for corkscrew entities in a group —
			// their formation is managed by TunnelGame's helix math.
			if (entity.kind === "corkscrew" && entity.groupId) {
				this.updateMood(entity, ctx, neighbors);
				continue;
			}

			// Skip steering for motes in murmuration —
			// their position is directly set by updateMurmuration.
			if (isMurmurationActive(entity)) {
				this.updateMood(entity, ctx, neighbors);
				continue;
			}

			// Accumulate steering from all drives
			_steeringAccum.set(0, 0, 0);

			const sep = separation(entity, neighbors);
			const ali = alignment(entity, neighbors);
			const coh = cohesion(entity, neighbors);
			const cur = curiosityDrive(entity, ctx);
			const agg = aggressionDrive(entity, ctx);
			const avo = avoidanceDrive(entity, ctx);
			const fea = fearDrive(entity, ctx);
			const ter = territoryDrive(entity, neighbors);
			const qav = quarkAvoidanceDrive(entity, ctx);
			const mur = murmurationDrive(entity, neighbors, ctx);
			const tun = tunnelConstraint(entity, ctx);

			// Weight each drive
			const p = entity.personality;
			_steeringAccum.x += sep.x * 1.5;
			_steeringAccum.y += sep.y * 1.5;
			_steeringAccum.z += sep.z * 1.5;

			_steeringAccum.x += ali.x * p.sociability * 0.5;
			_steeringAccum.y += ali.y * p.sociability * 0.5;
			_steeringAccum.z += ali.z * p.sociability * 0.5;

			_steeringAccum.x += coh.x * p.sociability * 0.8;
			_steeringAccum.y += coh.y * p.sociability * 0.8;
			_steeringAccum.z += coh.z * p.sociability * 0.8;

			_steeringAccum.x += cur.x;
			_steeringAccum.y += cur.y;
			_steeringAccum.z += cur.z;

			_steeringAccum.x += agg.x;
			_steeringAccum.y += agg.y;
			_steeringAccum.z += agg.z;

			_steeringAccum.x += avo.x * 2.0;
			_steeringAccum.y += avo.y * 2.0;
			_steeringAccum.z += avo.z * 2.0;

			_steeringAccum.x += fea.x * 2.0;
			_steeringAccum.y += fea.y * 2.0;
			_steeringAccum.z += fea.z * 2.0;

			_steeringAccum.x += ter.x;
			_steeringAccum.y += ter.y;
			_steeringAccum.z += ter.z;

			_steeringAccum.x += qav.x * 3.0;
			_steeringAccum.y += qav.y * 3.0;
			_steeringAccum.z += qav.z * 3.0;

			_steeringAccum.x += mur.x;
			_steeringAccum.y += mur.y;
			_steeringAccum.z += mur.z;

			_steeringAccum.x += tun.x;
			_steeringAccum.y += tun.y;
			_steeringAccum.z += tun.z;

			// Clamp steering to max acceleration
			const maxAccel = MAX_ACCELERATION[entity.kind];
			const steerLen = _steeringAccum.length();
			if (steerLen > maxAccel) {
				_steeringAccum.multiplyScalar(maxAccel / steerLen);
			}

			// Apply steering to velocity
			entity.velocity.x += _steeringAccum.x * ctx.deltaTime;
			entity.velocity.y += _steeringAccum.y * ctx.deltaTime;
			// Don't steer in z for most entities — z movement is the tunnel scroll
			if (entity.kind === "mote") {
				entity.velocity.z += _steeringAccum.z * ctx.deltaTime * 0.3;
			}

			// Apply damping
			const damping = VELOCITY_DAMPING[entity.kind];
			entity.velocity.x *= damping;
			entity.velocity.y *= damping;
			entity.velocity.z *= damping;

			// Update position from behavior velocity
			entity.position.x += entity.velocity.x * ctx.deltaTime;
			entity.position.y += entity.velocity.y * ctx.deltaTime;

			// Hard clamp to tunnel (safety net)
			const distFromCenter = Math.sqrt(
				entity.position.x ** 2 + entity.position.y ** 2,
			);
			if (distFromCenter > ctx.tunnelRadius * 0.95) {
				const scale = (ctx.tunnelRadius * 0.95) / distFromCenter;
				entity.position.x *= scale;
				entity.position.y *= scale;
			}

			// Phase 5: Update mood
			this.updateMood(entity, ctx, neighbors);
		}
	}

	/** Get the current global mood averages. */
	getGlobalMood(): { avgAnger: number; avgFear: number; avgExcitement: number } {
		if (this.entities.length === 0) {
			return { avgAnger: 0, avgFear: 0, avgExcitement: 0 };
		}
		let anger = 0, fear = 0, excitement = 0;
		for (let i = 0; i < this.entities.length; i++) {
			anger += this.entities[i].mood.anger;
			fear += this.entities[i].mood.fear;
			excitement += this.entities[i].mood.excitement;
		}
		const n = this.entities.length;
		return { avgAnger: anger / n, avgFear: fear / n, avgExcitement: excitement / n };
	}

	/** Get all registered entities. */
	getEntities(): readonly BehaviorState[] {
		return this.entities;
	}

	/** Clear all entities. */
	clear(): void {
		this.entities.length = 0;
	}

	private updateMood(entity: BehaviorState, ctx: BehaviorContext, neighbors: BehaviorState[]): void {
		const mood = entity.mood;
		const dt = ctx.deltaTime;

		// Alertness: rises when player is nearby, decays otherwise
		const playerDist = Math.sqrt(
			(entity.position.x - ctx.playerPosition.x) ** 2 +
			(entity.position.y - ctx.playerPosition.y) ** 2 +
			(entity.position.z - ctx.playerPosition.z) ** 2,
		);
		if (playerDist < 15) {
			mood.alertness = Math.min(1, mood.alertness + dt * 0.3);
		} else {
			mood.alertness = Math.max(0, mood.alertness - dt * 0.1);
		}

		// Anger: influenced by global rage level, decays slowly
		const rageInfluence = ctx.rageNormalized * entity.personality.aggression;
		mood.anger = Math.min(1, mood.anger + rageInfluence * dt * 0.2);
		mood.anger = Math.max(0, mood.anger - dt * 0.167); // ~6s to calm

		// Fear: spikes from nearby flares, decays
		let maxFlareThreat = 0;
		for (let i = 0; i < ctx.activeFlarePositions.length; i++) {
			const flare = ctx.activeFlarePositions[i];
			const flareDist = Math.sqrt(
				(entity.position.x - flare.x) ** 2 +
				(entity.position.y - flare.y) ** 2 +
				(entity.position.z - flare.z) ** 2,
			);
			if (flareDist < 20) {
				maxFlareThreat = Math.max(maxFlareThreat, 1 - flareDist / 20);
			}
		}
		if (maxFlareThreat > mood.fear) {
			mood.fear = Math.min(1, mood.fear + maxFlareThreat * dt * 2.0);
		} else {
			mood.fear = Math.max(0, mood.fear - dt * 0.2); // ~5s to calm
		}

		// Excitement: rises from nearby angry/excited neighbors
		let neighborExcitement = 0;
		for (let i = 0; i < neighbors.length; i++) {
			neighborExcitement += neighbors[i].mood.anger + neighbors[i].mood.excitement;
		}
		if (neighbors.length > 0) {
			neighborExcitement /= neighbors.length;
		}
		mood.excitement = Math.min(1, mood.excitement + neighborExcitement * dt * 0.3);
		mood.excitement = Math.max(0, mood.excitement - dt * 0.15);
	}
}
