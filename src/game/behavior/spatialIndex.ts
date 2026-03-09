import type { BehaviorState } from "./types";

const BUCKET_SIZE = 5; // Same as tunnel segment length

export class SpatialIndex {
	private buckets: Map<number, BehaviorState[]> = new Map();

	clear(): void {
		this.buckets.clear();
	}

	insert(entity: BehaviorState): void {
		const key = Math.floor(entity.position.z / BUCKET_SIZE);
		let bucket = this.buckets.get(key);
		if (!bucket) {
			bucket = [];
			this.buckets.set(key, bucket);
		}
		bucket.push(entity);
	}

	/** Get neighbors within radius. Checks current bucket + adjacent. */
	query(entity: BehaviorState, radius: number): BehaviorState[] {
		const key = Math.floor(entity.position.z / BUCKET_SIZE);
		const bucketsToCheck = Math.ceil(radius / BUCKET_SIZE);
		const results: BehaviorState[] = [];
		const radiusSq = radius * radius;

		for (let offset = -bucketsToCheck; offset <= bucketsToCheck; offset++) {
			const bucket = this.buckets.get(key + offset);
			if (!bucket) continue;
			for (let i = 0; i < bucket.length; i++) {
				const other = bucket[i];
				if (other === entity) continue;
				const dx = other.position.x - entity.position.x;
				const dy = other.position.y - entity.position.y;
				const dz = other.position.z - entity.position.z;
				if (dx * dx + dy * dy + dz * dz < radiusSq) {
					results.push(other);
				}
			}
		}
		return results;
	}
}
