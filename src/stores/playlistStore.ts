import { create } from "zustand";
import { persist } from "zustand/middleware";
import cumulusCloudsUrl from "@/assets/cumulus-clouds.mp3";
import spaceParticlesUrl from "@/assets/space-particles.mp3";
import spaceAmbientUrl from "@/assets/space-ambient.mp3";
import meditativeAmbientUrl from "@/assets/meditative-ambient.mp3";

export interface PlaylistTrack {
	id: string;
	name: string;
	src: string;
	isBundled: boolean;
	enabled: boolean;
	order: number;
}

interface PlaylistState {
	tracks: PlaylistTrack[];
	volume: number;
	shuffle: boolean;
	addTrack: (name: string, src: string) => void;
	removeTrack: (id: string) => void;
	toggleTrack: (id: string) => void;
	reorderTracks: (fromIndex: number, toIndex: number) => void;
	setVolume: (volume: number) => void;
	setShuffle: (shuffle: boolean) => void;
	resetToDefaults: () => void;
}

const DEFAULT_TRACKS: PlaylistTrack[] = [
	{
		id: "bundled-cumulus-clouds",
		name: "Cumulus Clouds",
		src: cumulusCloudsUrl,
		isBundled: true,
		enabled: true,
		order: 0,
	},
	{
		id: "bundled-space-particles",
		name: "Space Particles",
		src: spaceParticlesUrl,
		isBundled: true,
		enabled: true,
		order: 1,
	},
	{
		id: "bundled-space-ambient",
		name: "Space Ambient",
		src: spaceAmbientUrl,
		isBundled: true,
		enabled: true,
		order: 2,
	},
	{
		id: "bundled-meditative-ambient",
		name: "Meditative Ambient",
		src: meditativeAmbientUrl,
		isBundled: true,
		enabled: true,
		order: 3,
	},
];

export const usePlaylistStore = create<PlaylistState>()(
	persist(
		(set) => ({
			tracks: DEFAULT_TRACKS,
			volume: 0.3,
			shuffle: false,

			addTrack: (name, src) =>
				set((state) => ({
					tracks: [
						...state.tracks,
						{
							id: crypto.randomUUID(),
							name,
							src,
							isBundled: false,
							enabled: true,
							order: state.tracks.length,
						},
					],
				})),

			removeTrack: (id) =>
				set((state) => ({
					tracks: state.tracks
						.filter((t) => t.id !== id || t.isBundled)
						.map((t, i) => ({ ...t, order: i })),
				})),

			toggleTrack: (id) =>
				set((state) => ({
					tracks: state.tracks.map((t) =>
						t.id === id ? { ...t, enabled: !t.enabled } : t,
					),
				})),

			reorderTracks: (fromIndex, toIndex) =>
				set((state) => {
					const sorted = [...state.tracks].sort((a, b) => a.order - b.order);
					const [moved] = sorted.splice(fromIndex, 1);
					sorted.splice(toIndex, 0, moved);
					return {
						tracks: sorted.map((t, i) => ({ ...t, order: i })),
					};
				}),

			setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),

			setShuffle: (shuffle) => set({ shuffle }),

			resetToDefaults: () =>
				set({ tracks: DEFAULT_TRACKS, volume: 0.3, shuffle: false }),
		}),
		{
			name: "rama_rendezvous_playlist",
			version: 2,
			partialize: (state) => ({
				tracks: state.tracks,
				volume: state.volume,
				shuffle: state.shuffle,
			}),
			merge: (persisted, current) => {
				const p = persisted as Partial<PlaylistState> | undefined;
				if (!p) return current;
				// Ensure bundled track src URLs are always up-to-date
				// (Vite hashes may change between builds)
				const bundledSrcMap: Record<string, string> = {
					"bundled-cumulus-clouds": cumulusCloudsUrl,
					"bundled-space-particles": spaceParticlesUrl,
					"bundled-space-ambient": spaceAmbientUrl,
					"bundled-meditative-ambient": meditativeAmbientUrl,
				};
				let tracks = (p.tracks ?? current.tracks).map((t) => {
					if (t.id in bundledSrcMap) return { ...t, src: bundledSrcMap[t.id] };
					return t;
				});
				// Add any new bundled tracks that don't exist in persisted data
				for (const def of DEFAULT_TRACKS) {
					if (!tracks.find((t) => t.id === def.id)) {
						tracks.push({ ...def, order: tracks.length });
					}
				}
				// Remove old bundled tracks that no longer exist
				tracks = tracks.filter((t) => !t.isBundled || t.id in bundledSrcMap);
				return {
					...current,
					...p,
					tracks,
				};
			},
		},
	),
);
