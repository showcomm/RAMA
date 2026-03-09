import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PilotSettings {
	autopilot: boolean;
	speedMultiplier: number; // 0.5-2.0, default 1.0
	tempoSync: boolean; // sync speed to music tempo
	entityDensity: number; // 0.2-2.0, multiplier on spawn rates
	flareCooldown: number; // 0.5-3.0 seconds
	musicReactivity: number; // 0-3.0, multiplier on music-driven effects
}

const DEFAULTS: PilotSettings = {
	autopilot: false,
	speedMultiplier: 1.0,
	tempoSync: false,
	entityDensity: 1.0,
	flareCooldown: 1.0,
	musicReactivity: 1.0,
};

interface PilotStore {
	settings: PilotSettings;
	set: <K extends keyof PilotSettings>(key: K, value: PilotSettings[K]) => void;
	resetToDefaults: () => void;
}

export const usePilotStore = create<PilotStore>()(
	persist(
		(set) => ({
			settings: { ...DEFAULTS },
			set: (key, value) =>
				set((state) => ({
					settings: { ...state.settings, [key]: value },
				})),
			resetToDefaults: () => set({ settings: { ...DEFAULTS } }),
		}),
		{
			name: "rama-pilot-settings",
			version: 2,
			migrate: (persisted) => {
				const old = persisted as { settings?: Partial<PilotSettings> };
				return { settings: { ...DEFAULTS, ...old?.settings } };
			},
		},
	),
);
