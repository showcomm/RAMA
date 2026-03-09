import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SfxLevels {
	monitorReadout: number;
	proximity: number;
	collision: number;
	flareHit: number;
	flyby: number;
}

const DEFAULTS: SfxLevels = {
	monitorReadout: 0.08,
	proximity: 0.5,
	collision: 0.15,
	flareHit: 0.10,
	flyby: 0.3,
};

interface SfxStore {
	levels: SfxLevels;
	setLevel: (key: keyof SfxLevels, value: number) => void;
	resetToDefaults: () => void;
}

export const SFX_LABELS: Record<keyof SfxLevels, string> = {
	monitorReadout: "MONITOR.READOUT",
	proximity: "PROXIMITY.DRONE",
	collision: "COLLISION",
	flareHit: "FLARE.HIT",
	flyby: "FLYBY",
};

export const useSfxStore = create<SfxStore>()(
	persist(
		(set) => ({
			levels: { ...DEFAULTS },
			setLevel: (key, value) =>
				set((state) => ({
					levels: { ...state.levels, [key]: value },
				})),
			resetToDefaults: () => set({ levels: { ...DEFAULTS } }),
		}),
		{
			name: "rama-sfx-levels",
			version: 1,
		},
	),
);
