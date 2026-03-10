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
	unavailable?: boolean; // true if IDB blob could not be resolved
}

export interface Playlist {
	id: string;
	name: string;
	trackIds: string[]; // ordered track IDs
	shuffle: boolean;
}

interface PlaylistState {
	tracks: PlaylistTrack[];
	playlists: Playlist[]; // index 0 = bundled, 1-8 = user
	activePlaylistIndex: number;
	volume: number;
	addTrackFromFile: (name: string, file: File) => void;
	removeTrack: (id: string) => void;
	setVolume: (volume: number) => void;
	// Playlist management
	addPlaylist: (name: string) => void;
	removePlaylist: (index: number) => void;
	renamePlaylist: (index: number, name: string) => void;
	setActivePlaylist: (index: number) => void;
	addTrackToPlaylist: (playlistIndex: number, trackId: string) => void;
	removeTrackFromPlaylist: (playlistIndex: number, trackId: string) => void;
	reorderPlaylistTracks: (playlistIndex: number, fromIndex: number, toIndex: number) => void;
	setPlaylistShuffle: (playlistIndex: number, shuffle: boolean) => void;
	resetToDefaults: () => void;
	/** Called once on mount to resolve IDB blobs into object URLs. */
	hydrateBlobs: () => Promise<void>;
}

const BUNDLED_TRACKS: PlaylistTrack[] = [
	{
		id: "bundled-cumulus-clouds",
		name: "Cumulus Clouds",
		src: cumulusCloudsUrl,
		blobKey: null,
		isBundled: true,
	},
	{
		id: "bundled-space-particles",
		name: "Space Particles",
		src: spaceParticlesUrl,
		blobKey: null,
		isBundled: true,
	},
	{
		id: "bundled-space-ambient",
		name: "Space Ambient",
		src: spaceAmbientUrl,
		blobKey: null,
		isBundled: true,
	},
	{
		id: "bundled-meditative-ambient",
		name: "Meditative Ambient",
		src: meditativeAmbientUrl,
		blobKey: null,
		isBundled: true,
	},
];

const DEFAULT_PLAYLIST: Playlist = {
	id: "bundled",
	name: "DEFAULT",
	trackIds: BUNDLED_TRACKS.map((t) => t.id),
	shuffle: false,
};

const DEFAULTS = {
	tracks: BUNDLED_TRACKS,
	playlists: [DEFAULT_PLAYLIST],
	activePlaylistIndex: 0,
	volume: 0.3,
};

export const usePlaylistStore = create<PlaylistState>()(
	persist(
		(set, get) => ({
			...DEFAULTS,

			addTrackFromFile: (name, file) => {
				const id = crypto.randomUUID();
				const blobKey = `upload_${id}`;
				const objectUrl = URL.createObjectURL(file);
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
						},
					],
				}));
			},

			removeTrack: (id) => {
				const track = get().tracks.find((t) => t.id === id);
				if (track?.isBundled) return;
				if (track?.blobKey) {
					deleteAudioBlob(track.blobKey).catch(() => {});
				}
				set((state) => ({
					tracks: state.tracks.filter((t) => t.id !== id),
					// Also remove from all playlists
					playlists: state.playlists.map((p) => ({
						...p,
						trackIds: p.trackIds.filter((tid) => tid !== id),
					})),
				}));
			},

			setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),

			addPlaylist: (name) => {
				const state = get();
				if (state.playlists.length >= 9) return;
				set({
					playlists: [
						...state.playlists,
						{
							id: crypto.randomUUID(),
							name,
							trackIds: [],
							shuffle: false,
						},
					],
				});
			},

			removePlaylist: (index) => {
				if (index === 0) return; // can't remove bundled
				set((state) => {
					const newPlaylists = state.playlists.filter((_, i) => i !== index);
					return {
						playlists: newPlaylists,
						activePlaylistIndex:
							state.activePlaylistIndex >= index
								? Math.max(0, state.activePlaylistIndex - 1)
								: state.activePlaylistIndex,
					};
				});
			},

			renamePlaylist: (index, name) => {
				if (index === 0) return; // can't rename bundled
				set((state) => ({
					playlists: state.playlists.map((p, i) =>
						i === index ? { ...p, name } : p,
					),
				}));
			},

			setActivePlaylist: (index) => set({ activePlaylistIndex: index }),

			addTrackToPlaylist: (playlistIndex, trackId) => {
				set((state) => ({
					playlists: state.playlists.map((p, i) =>
						i === playlistIndex && !p.trackIds.includes(trackId)
							? { ...p, trackIds: [...p.trackIds, trackId] }
							: p,
					),
				}));
			},

			removeTrackFromPlaylist: (playlistIndex, trackId) => {
				// Don't allow removing bundled tracks from the bundled playlist
				if (playlistIndex === 0) {
					const track = get().tracks.find((t) => t.id === trackId);
					if (track?.isBundled) return;
				}
				set((state) => ({
					playlists: state.playlists.map((p, i) =>
						i === playlistIndex
							? { ...p, trackIds: p.trackIds.filter((tid) => tid !== trackId) }
							: p,
					),
				}));
			},

			reorderPlaylistTracks: (playlistIndex, fromIndex, toIndex) => {
				set((state) => {
					const playlist = state.playlists[playlistIndex];
					if (!playlist) return state;
					const trackIds = [...playlist.trackIds];
					const [moved] = trackIds.splice(fromIndex, 1);
					trackIds.splice(toIndex, 0, moved);
					return {
						playlists: state.playlists.map((p, i) =>
							i === playlistIndex ? { ...p, trackIds } : p,
						),
					};
				});
			},

			setPlaylistShuffle: (playlistIndex, shuffle) => {
				set((state) => ({
					playlists: state.playlists.map((p, i) =>
						i === playlistIndex ? { ...p, shuffle } : p,
					),
				}));
			},

			resetToDefaults: () => {
				for (const t of get().tracks) {
					if (t.blobKey) deleteAudioBlob(t.blobKey).catch(() => {});
				}
				set({ ...DEFAULTS });
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
							return { ...t, src: "", unavailable: true };
						} catch {
							return { ...t, src: "", unavailable: true };
						}
					}),
				);
				set({ tracks: updated });
			},
		}),
		{
			name: "rama_rendezvous_playlist",
			version: 4,
			partialize: (state) => ({
				tracks: state.tracks.map((t) => ({
					id: t.id,
					name: t.name,
					src: "",
					blobKey: t.blobKey,
					isBundled: t.isBundled,
				})),
				playlists: state.playlists,
				activePlaylistIndex: state.activePlaylistIndex,
				volume: state.volume,
			}),
			migrate: (persisted) => {
				// Migrate from v3 (flat track list with enabled/order) to v4 (playlists)
				const old = persisted as Record<string, unknown>;
				type OldTrack = PlaylistTrack & { enabled?: boolean; order?: number };
				const oldTracks = (old?.tracks ?? []) as OldTrack[];
				const tracks = oldTracks.map((t) => ({
					id: t.id,
					name: t.name,
					src: "",
					blobKey: t.blobKey ?? null,
					isBundled: t.isBundled,
				}));
				// If migrating from old format, create bundled playlist from enabled tracks
				if (!old?.playlists) {
					const enabledIds = oldTracks
						.filter((t) => t.enabled !== false)
						.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
						.map((t) => t.id);
					return {
						tracks,
						playlists: [{
							id: "bundled",
							name: "DEFAULT",
							trackIds: enabledIds.length > 0 ? enabledIds : BUNDLED_TRACKS.map((t) => t.id),
							shuffle: old?.shuffle ?? false,
						}],
						activePlaylistIndex: 0,
						volume: old?.volume ?? 0.3,
					};
				}
				return { ...old, tracks };
			},
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
					if (t.id in bundledSrcMap) return { ...t, src: bundledSrcMap[t.id], blobKey: t.blobKey ?? null };
					return { ...t, src: t.src || "", blobKey: t.blobKey ?? null };
				});
				// Add any new bundled tracks
				for (const def of BUNDLED_TRACKS) {
					if (!tracks.find((t) => t.id === def.id)) {
						tracks.push({ ...def });
					}
				}
				// Remove old bundled tracks that no longer exist
				tracks = tracks.filter((t) => !t.isBundled || t.id in bundledSrcMap);
				// Ensure bundled playlist has all bundled track IDs
				let playlists = p.playlists ?? current.playlists;
				if (playlists.length > 0 && playlists[0].id === "bundled") {
					const bundledIds = BUNDLED_TRACKS.map((t) => t.id);
					const existing = playlists[0].trackIds;
					const missing = bundledIds.filter((id) => !existing.includes(id));
					if (missing.length > 0) {
						playlists = [
							{ ...playlists[0], trackIds: [...existing, ...missing] },
							...playlists.slice(1),
						];
					}
				}
				return {
					...current,
					...p,
					tracks,
					playlists,
				};
			},
		},
	),
);
