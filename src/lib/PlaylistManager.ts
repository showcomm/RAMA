import type { PlaylistTrack } from "@/stores/playlistStore";

export class PlaylistManager {
	private audio: HTMLAudioElement;
	private enabledTracks: PlaylistTrack[] = [];
	private currentIndex = -1;
	private volume = 0.3;
	private shuffleOrder: number[] = [];
	private isShuffled = false;
	private onTrackChange?: (trackId: string | null) => void;
	private fadeInterval: ReturnType<typeof setInterval> | null = null;
	private audioContext: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private sourceNode: MediaElementAudioSourceNode | null = null;
	private freqData: Uint8Array = new Uint8Array(0);
	private analyserFailed = false;

	constructor(onTrackChange?: (trackId: string | null) => void) {
		this.audio = document.createElement("audio");
		this.audio.addEventListener("ended", () => this.next());
		this.onTrackChange = onTrackChange;
	}

	/** Initialize Web Audio analyser (must be called after a user gesture). */
	private ensureAnalyser(): void {
		if (this.analyser || this.analyserFailed) return;
		try {
			this.audioContext = new AudioContext();
			this.analyser = this.audioContext.createAnalyser();
			this.analyser.fftSize = 256;
			this.analyser.smoothingTimeConstant = 0.8;
			this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
			this.sourceNode = this.audioContext.createMediaElementSource(this.audio);
			this.sourceNode.connect(this.analyser);
			this.analyser.connect(this.audioContext.destination);
		} catch {
			// Web Audio not available — degrade gracefully, don't retry
			this.analyserFailed = true;
			this.analyser = null;
		}
	}

	/** Read frequency data safely. Returns false if analyser can't provide data. */
	private readFreqData(): boolean {
		if (!this.analyser) return false;
		try {
			this.analyser.getByteFrequencyData(this.freqData);
			return true;
		} catch {
			return false;
		}
	}

	/** Get bass energy (0-1) from low frequencies. Call each frame. */
	getBassEnergy(): number {
		if (!this.readFreqData()) return 0;
		let sum = 0;
		const bins = Math.min(6, this.freqData.length);
		for (let i = 0; i < bins; i++) {
			sum += this.freqData[i];
		}
		return sum / (bins * 255);
	}

	/** Get mid energy (0-1) from mid frequencies. Call each frame. */
	getMidEnergy(): number {
		if (!this.readFreqData()) return 0;
		let sum = 0;
		const start = Math.min(10, this.freqData.length);
		const end = Math.min(40, this.freqData.length);
		for (let i = start; i < end; i++) {
			sum += this.freqData[i];
		}
		const count = end - start;
		return count > 0 ? sum / (count * 255) : 0;
	}

	/** Get treble energy (0-1) from high frequencies. Call each frame. */
	getTrebleEnergy(): number {
		if (!this.readFreqData()) return 0;
		let sum = 0;
		const start = Math.min(40, this.freqData.length);
		const end = Math.min(100, this.freqData.length);
		for (let i = start; i < end; i++) {
			sum += this.freqData[i];
		}
		const count = end - start;
		return count > 0 ? sum / (count * 255) : 0;
	}

	/** Update with resolved tracks for the active playlist. */
	updatePlaylist(tracks: PlaylistTrack[], volume: number, shuffle: boolean): void {
		const newEnabled = tracks.filter((t) => t.src && !t.unavailable);

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

		// If current track was removed, advance
		if (this.currentIndex >= 0) {
			const currentId = this.getCurrentTrackId();
			if (currentId && !newEnabled.find((t) => t.id === currentId)) {
				this.next();
			}
		}
	}

	play(): void {
		if (this.enabledTracks.length === 0) return;
		this.ensureAnalyser();
		if (this.currentIndex < 0) {
			this.currentIndex = 0;
			this.loadCurrent();
		}
		this.audio.play().catch((e) => console.error("Playlist play failed:", e));
	}

	/** Start playback with a gradual volume fade-in over `durationMs` (default 8s). */
	fadeIn(durationMs = 8000): void {
		if (this.enabledTracks.length === 0) return;
		if (this.currentIndex < 0) {
			this.currentIndex = 0;
			this.loadCurrent();
		}

		// Clear any existing fade
		if (this.fadeInterval) clearInterval(this.fadeInterval);

		const targetVolume = this.volume;
		this.ensureAnalyser();
		this.audio.volume = 0;
		this.audio.play().catch((e) => console.error("Playlist fadeIn failed:", e));

		const stepMs = 50;
		const steps = durationMs / stepMs;
		let step = 0;

		this.fadeInterval = setInterval(() => {
			step++;
			// Ease-in curve (quadratic)
			const t = step / steps;
			this.audio.volume = targetVolume * t * t;
			if (step >= steps) {
				this.audio.volume = targetVolume;
				if (this.fadeInterval) {
					clearInterval(this.fadeInterval);
					this.fadeInterval = null;
				}
			}
		}, stepMs);
	}

	pause(): void {
		this.audio.pause();
	}

	setMuted(muted: boolean): void {
		this.audio.muted = muted;
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

	/** Jump to a specific track by ID and start playing. */
	playTrackById(trackId: string): void {
		const idx = this.enabledTracks.findIndex((t) => t.id === trackId);
		if (idx < 0) return;
		this.ensureAnalyser();
		this.currentIndex = idx;
		this.loadCurrent();
		this.audio.play().catch((e) => console.error("Playlist playTrack failed:", e));
	}

	getCurrentTrackId(): string | null {
		if (this.currentIndex < 0 || this.currentIndex >= this.enabledTracks.length) {
			return null;
		}
		return this.enabledTracks[this.currentIndex].id;
	}

	dispose(): void {
		if (this.fadeInterval) {
			clearInterval(this.fadeInterval);
			this.fadeInterval = null;
		}
		this.audio.pause();
		this.audio.removeAttribute("src");
		this.audio.load();
		this.onTrackChange = undefined;
		if (this.audioContext) {
			this.audioContext.close().catch(() => {});
			this.audioContext = null;
			this.analyser = null;
			this.sourceNode = null;
		}
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
