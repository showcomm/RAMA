import { create } from "zustand";
import { persist } from "zustand/middleware";
import cumulusCloudsUrl from "@/assets/cumulus-clouds.mp3";
import spaceParticlesUrl from "@/assets/space-particles.mp3";
import spaceAmbientUrl from "@/assets/space-ambient.mp3";
import meditativeAmbientUrl from "@/assets/meditative-ambient.mp3";
import { storeAudioBlob, getAudioBlob, deleteAudioBlob } from "@/lib/audioStorage";

export interface PlaylistTrack {
	id: string;
	name: string;
	src: string; // runtime URL (Vite asset URL or objectURL from IDB blob)
	blobKey: string | null; // non-null for uploaded tracks — key into IndexedDB
	isBundled: boolean;
	enabled: boolean;
	order: number;
	unavailable?: boolean; // true if IDB blob could not be resolved
}

interface PlaylistState {
	tracks: PlaylistTrack[];
	volume: number;
	shuffle: boolean;
	addTrackFromFile: (name: string, file: File) => void;
	removeTrack: (id: string) => void;
	toggleTrack: (id: string) => void;
	reorderTracks: (fromIndex: number, toIndex: number) => void;
	setVolume: (volume: number) => void;
	setShuffle: (shuffle: boolean) => void;
	resetToDefaults: () => void;
	/** Called once on mount to resolve IDB blobs into object URLs. */
	hydrateBlobs: () => Promise<void>;
}

const DEFAULT_TRACKS: PlaylistTrack[] = [
	{
		id: "bundled-cumulus-clouds",
		name: "Cumulus Clouds",
		src: cumulusCloudsUrl,
		blobKey: null,
		isBundled: true,
		enabled: true,
		order: 0,
	},
	{
		id: "bundled-space-particles",
		name: "Space Particles",
		src: spaceParticlesUrl,
		blobKey: null,
		isBundled: true,
		enabled: true,
		order: 1,
	},
	{
		id: "bundled-space-ambient",
		name: "Space Ambient",
		src: spaceAmbientUrl,
		blobKey: null,
		isBundled: true,
		enabled: true,
		order: 2,
	},
	{
		id: "bundled-meditative-ambient",
		name: "Meditative Ambient",
		src: meditativeAmbientUrl,
		blobKey: null,
		isBundled: true,
		enabled: true,
		order: 3,
	},
];

export const usePlaylistStore = create<PlaylistState>()(
	persist(
		(set, get) => ({
			tracks: DEFAULT_TRACKS,
			volume: 0.3,
			shuffle: false,

			addTrackFromFile: (name, file) => {
				const id = crypto.randomUUID();
				const blobKey = `upload_${id}`;
				// Create immediate object URL for playback
				const objectUrl = URL.createObjectURL(file);
				// Store blob in IDB for persistence (fire-and-forget)
				storeAudioBlob(blobKey, file).catch((e) =>
					console.error("Failed to store audio in IDB:", e),
				);
				set((state) => ({
					tracks: [
						...state.tracks,
						{
							id,
							name,
							src: objectUrl,
							blobKey,
							isBundled: false,
							enabled: true,
							order: state.tracks.length,
						},
					],
				}));
			},

			removeTrack: (id) => {
				const track = get().tracks.find((t) => t.id === id);
				if (track?.blobKey) {
					deleteAudioBlob(track.blobKey).catch(() => {});
				}
				set((state) => ({
					tracks: state.tracks
						.filter((t) => t.id !== id || t.isBundled)
						.map((t, i) => ({ ...t, order: i })),
				}));
			},

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

			resetToDefaults: () => {
				// Clean up IDB blobs for all uploaded tracks
				for (const t of get().tracks) {
					if (t.blobKey) deleteAudioBlob(t.blobKey).catch(() => {});
				}
				set({ tracks: DEFAULT_TRACKS, volume: 0.3, shuffle: false });
			},

			hydrateBlobs: async () => {
				const { tracks } = get();
				const updated = await Promise.all(
					tracks.map(async (t) => {
						if (!t.blobKey) return t;
						try {
							const blob = await getAudioBlob(t.blobKey);
							if (blob) {
								return { ...t, src: URL.createObjectURL(blob), unavailable: false };
							}
							// Blob missing — mark unavailable but keep in list
							return { ...t, src: "", enabled: false, unavailable: true };
						} catch {
							return { ...t, src: "", enabled: false, unavailable: true };
						}
					}),
				);
				set({ tracks: updated });
			},
		}),
		{
			name: "rama_rendezvous_playlist",
			version: 3,
			partialize: (state) => ({
				tracks: state.tracks.map((t) => ({
					id: t.id,
					name: t.name,
					// Don't persist src — it's a runtime URL (object URL or Vite asset)
					src: "",
					blobKey: t.blobKey,
					isBundled: t.isBundled,
					enabled: t.enabled,
					order: t.order,
				})),
				volume: state.volume,
				shuffle: state.shuffle,
			}),
			merge: (persisted, current) => {
				const p = persisted as Partial<PlaylistState> | undefined;
				if (!p) return current;
				const bundledSrcMap: Record<string, string> = {
					"bundled-cumulus-clouds": cumulusCloudsUrl,
					"bundled-space-particles": spaceParticlesUrl,
					"bundled-space-ambient": spaceAmbientUrl,
					"bundled-meditative-ambient": meditativeAmbientUrl,
				};
				let tracks = (p.tracks ?? current.tracks).map((t) => {
					// Restore bundled track src URLs (Vite hashes change between builds)
					if (t.id in bundledSrcMap) return { ...t, src: bundledSrcMap[t.id], blobKey: t.blobKey ?? null };
					// Uploaded tracks: src will be resolved by hydrateBlobs
					return { ...t, src: t.src || "", blobKey: t.blobKey ?? null };
				});
				// Add any new bundled tracks
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
