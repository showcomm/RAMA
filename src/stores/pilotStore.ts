import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PilotStyle = "cautious" | "bold" | "aggressive";

export interface PilotSettings {
	autopilot: boolean;
	pilotStyle: PilotStyle; // cautious=safe, bold=investigate+dodge, aggressive=investigate+reduced dodge
	speedMultiplier: number; // 0.5-2.0, default 1.0
	tempoSync: boolean; // sync speed to music tempo
	entityDensity: number; // 0.2-2.0, multiplier on spawn rates
	flareCooldown: number; // 0.5-3.0 seconds
	musicReactivity: number; // 0-3.0, multiplier on music-driven effects
	ignoreDeath: boolean; // keep flying even after death conditions
	skipIntro: boolean; // skip story transmission, go straight to pilot init
}

const DEFAULTS: PilotSettings = {
	autopilot: false,
	pilotStyle: "cautious" as PilotStyle,
	speedMultiplier: 1.0,
	tempoSync: false,
	entityDensity: 1.0,
	flareCooldown: 1.0,
	musicReactivity: 1.0,
	ignoreDeath: false,
	skipIntro: false,
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
			version: 6,
			migrate: (persisted) => {
				const old = persisted as { settings?: Partial<PilotSettings> & { pilotBoldness?: boolean } };
				const migrated = { ...DEFAULTS, ...old?.settings };
				// Migrate old boolean pilotBoldness to new pilotStyle
				if (old?.settings && "pilotBoldness" in old.settings) {
					migrated.pilotStyle = old.settings.pilotBoldness ? "bold" : "cautious";
					delete (migrated as Record<string, unknown>).pilotBoldness;
				}
				return { settings: migrated };
			},
		},
	),
);
