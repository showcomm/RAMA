import type { EntityKind, PersonalityProfile } from "./types";

export const PERSONALITY_DEFAULTS: Record<EntityKind, PersonalityProfile> = {
	cloudBeing: {
		curiosity: 0.7,
		aggression: 0.2,
		sociability: 0.8,
		territoriality: 0.1,
		fearfulness: 0.5,
	},
	rollingSphere: {
		curiosity: 0.1,
		aggression: 0.8,
		sociability: 0.3,
		territoriality: 0.6,
		fearfulness: 0.2,
	},
	corkscrew: {
		curiosity: 0.0,
		aggression: 0.4,
		sociability: 1.0,
		territoriality: 0.9,
		fearfulness: 0.1,
	},
	mote: {
		curiosity: 0.3,
		aggression: 0.0,
		sociability: 0.6,
		territoriality: 0.0,
		fearfulness: 0.8,
	},
	quarkShard: {
		curiosity: 0.4,
		aggression: 0.1,
		sociability: 0.2,
		territoriality: 0.3,
		fearfulness: 0.6,
	},
};

// Max steering acceleration per entity type
export const MAX_ACCELERATION: Record<EntityKind, number> = {
	cloudBeing: 6.0,
	rollingSphere: 3.0,
	corkscrew: 1.5,
	mote: 8.0,
	quarkShard: 4.0,
};

// Velocity damping per entity type (higher = more friction)
export const VELOCITY_DAMPING: Record<EntityKind, number> = {
	cloudBeing: 0.92,
	rollingSphere: 0.95,
	corkscrew: 0.88,
	mote: 0.90,
	quarkShard: 0.93,
};

// Neighbor query radius per entity type
export const NEIGHBOR_RADIUS: Record<EntityKind, number> = {
	cloudBeing: 8.0,
	rollingSphere: 6.0,
	corkscrew: 10.0,
	mote: 25.0,
	quarkShard: 6.0,
};
