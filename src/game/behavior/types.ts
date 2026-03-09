import type * as THREE from "three";

export type EntityKind = "cloudBeing" | "rollingSphere" | "corkscrew" | "mote" | "quarkShard";

export interface PersonalityProfile {
	curiosity: number;      // 0-1, attraction to player
	aggression: number;     // 0-1, tendency to charge player
	sociability: number;    // 0-1, flocking strength with same kind
	territoriality: number; // 0-1, repulsion from other entity types
	fearfulness: number;    // 0-1, avoidance of flares/threats
}

export interface MoodState {
	alertness: number;   // 0-1, awareness of player proximity
	anger: number;       // 0-1, current anger level
	fear: number;        // 0-1, from flare proximity
	excitement: number;  // 0-1, from nearby group activity
}

export interface BehaviorState {
	kind: EntityKind;
	position: THREE.Vector3;
	velocity: THREE.Vector3;
	personality: PersonalityProfile;
	mood: MoodState;
	groupId: string | null;
	birthTime: number;
	lastReactionTime: number;
	// For tunnel-surface entities (rolling spheres)
	tunnelAngle: number;
	tunnelRadius: number;
}

export interface BehaviorContext {
	rageLevel: number;
	rageNormalized: number;
	playerPosition: THREE.Vector3;
	tunnelRadius: number;
	gameSpeed: number;
	deltaTime: number;
	currentTime: number;
	activeFlarePositions: THREE.Vector3[];
	quarkShardPositions: THREE.Vector3[];
	globalMood: {
		avgAnger: number;
		avgFear: number;
		avgExcitement: number;
	};
}
