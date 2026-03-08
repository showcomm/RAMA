import type { PlaylistTrack } from "@/stores/playlistStore";

export class PlaylistManager {
	private audio: HTMLAudioElement;
	private enabledTracks: PlaylistTrack[] = [];
	private currentIndex = -1;
	private volume = 0.3;
	private shuffleOrder: number[] = [];
	private isShuffled = false;
	private onTrackChange?: (trackId: string | null) => void;

	constructor(onTrackChange?: (trackId: string | null) => void) {
		this.audio = document.createElement("audio");
		this.audio.addEventListener("ended", () => this.next());
		this.onTrackChange = onTrackChange;
	}

	updatePlaylist(tracks: PlaylistTrack[], volume: number, shuffle: boolean): void {
		const newEnabled = tracks
			.filter((t) => t.enabled)
			.sort((a, b) => a.order - b.order);

		const enabledChanged =
			newEnabled.length !== this.enabledTracks.length ||
			newEnabled.some((t, i) => t.id !== this.enabledTracks[i]?.id);

		this.enabledTracks = newEnabled;
		this.volume = volume;
		this.audio.volume = volume;

		if (shuffle !== this.isShuffled || enabledChanged) {
			this.isShuffled = shuffle;
			this.rebuildShuffleOrder();
		}

		// If current track was removed/disabled, advance
		if (this.currentIndex >= 0) {
			const currentId = this.getCurrentTrackId();
			if (currentId && !newEnabled.find((t) => t.id === currentId)) {
				this.next();
			}
		}
	}

	play(): void {
		if (this.enabledTracks.length === 0) return;
		if (this.currentIndex < 0) {
			this.currentIndex = 0;
			this.loadCurrent();
		}
		this.audio.play().catch((e) => console.error("Playlist play failed:", e));
	}

	pause(): void {
		this.audio.pause();
	}

	stop(): void {
		this.audio.pause();
		this.audio.currentTime = 0;
		this.currentIndex = -1;
		this.onTrackChange?.(null);
	}

	next(): void {
		if (this.enabledTracks.length === 0) {
			this.stop();
			return;
		}

		if (this.isShuffled) {
			const shufflePos = this.shuffleOrder.indexOf(this.currentIndex);
			const nextShufflePos = (shufflePos + 1) % this.shuffleOrder.length;
			if (nextShufflePos === 0) this.rebuildShuffleOrder();
			this.currentIndex = this.shuffleOrder[nextShufflePos];
		} else {
			this.currentIndex = (this.currentIndex + 1) % this.enabledTracks.length;
		}

		this.loadCurrent();
		this.audio.play().catch((e) => console.error("Playlist next failed:", e));
	}

	getCurrentTrackId(): string | null {
		if (this.currentIndex < 0 || this.currentIndex >= this.enabledTracks.length) {
			return null;
		}
		return this.enabledTracks[this.currentIndex].id;
	}

	dispose(): void {
		this.audio.pause();
		this.audio.removeAttribute("src");
		this.audio.load();
		this.onTrackChange = undefined;
	}

	private loadCurrent(): void {
		const track = this.enabledTracks[this.currentIndex];
		if (!track) return;
		this.audio.src = track.src;
		this.audio.volume = this.volume;
		this.onTrackChange?.(track.id);
	}

	private rebuildShuffleOrder(): void {
		this.shuffleOrder = this.enabledTracks.map((_, i) => i);
		// Fisher-Yates shuffle
		for (let i = this.shuffleOrder.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[this.shuffleOrder[i], this.shuffleOrder[j]] = [
				this.shuffleOrder[j],
				this.shuffleOrder[i],
			];
		}
	}
}
