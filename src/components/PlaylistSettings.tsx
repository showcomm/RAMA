import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, GripVertical, Music, Plus, Trash2, X } from "lucide-react";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePlaylistStore } from "@/stores/playlistStore";
import { useSfxStore, SFX_LABELS, type SfxLevels } from "@/stores/sfxStore";

export function PlaylistSettings({ currentTrackId, onPlayTrack }: { currentTrackId: string | null; onPlayTrack?: (trackId: string) => void }) {
	const {
		tracks,
		volume,
		shuffle,
		addTrackFromFile,
		removeTrack,
		toggleTrack,
		reorderTracks,
		setVolume,
		setShuffle,
		resetToDefaults,
	} = usePlaylistStore();

	const { levels: sfxLevels, setLevel: setSfxLevel, resetToDefaults: resetSfx } = useSfxStore();
	const [sfxOpen, setSfxOpen] = useState(false);
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
	const [isDroppingFile, setIsDroppingFile] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const sortedTracks = [...tracks].sort((a, b) => a.order - b.order);

	const handleDragStart = (index: number) => {
		setDragIndex(index);
	};

	const handleDragOver = (e: React.DragEvent, index: number) => {
		e.preventDefault();
		setDragOverIndex(index);
	};

	const handleDrop = (index: number) => {
		if (dragIndex !== null && dragIndex !== index) {
			reorderTracks(dragIndex, index);
		}
		setDragIndex(null);
		setDragOverIndex(null);
	};

	const handleFileDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDroppingFile(false);
		const files = Array.from(e.dataTransfer.files).filter((f) =>
			f.type.startsWith("audio/"),
		);
		for (const file of files) {
			addAudioFile(file);
		}
	};

	const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files ?? []);
		for (const file of files) {
			addAudioFile(file);
		}
		if (fileInputRef.current) fileInputRef.current.value = "";
	};

	const addAudioFile = (file: File) => {
		if (file.size > 50 * 1024 * 1024) {
			alert("File is too large (max 50MB).");
			return;
		}
		const name = file.name.replace(/\.[^/.]+$/, "");
		addTrackFromFile(name, file);
	};

	return (
		<Sheet>
			<SheetTrigger asChild>
				<button
					className="flex items-center gap-1 px-2 py-1 font-mono text-[10px] tracking-widest text-cyan-400 hover:text-cyan-200 hover:bg-cyan-500/10 border border-cyan-500/20 hover:border-cyan-500/40 transition-colors pointer-events-auto"
					title="Music Settings"
				>
					<Music className="w-3 h-3" />
					PLAYLIST
				</button>
			</SheetTrigger>
			<SheetContent
				side="right"
				className="w-80 bg-gradient-to-b from-cyan-950 to-zinc-950 border-l border-cyan-500/30 p-0"
			>
				<SheetHeader className="px-4 pt-4 pb-2">
					<SheetTitle className="font-mono text-sm tracking-widest text-cyan-300">
						AUDIO.PLAYLIST
					</SheetTitle>
				</SheetHeader>

				<div className="px-4 py-3 space-y-3">
					<div className="flex items-center justify-between">
						<span className="font-mono text-[10px] tracking-wider text-cyan-400/70">
							VOLUME
						</span>
						<span className="font-mono text-[10px] text-cyan-300">
							{Math.round(volume * 100)}%
						</span>
					</div>
					<Slider
						value={[volume * 100]}
						onValueChange={([v]) => setVolume(v / 100)}
						max={100}
						step={1}
						className="w-full"
					/>

					<div className="flex items-center justify-between pt-1">
						<span className="font-mono text-[10px] tracking-wider text-cyan-400/70">
							SHUFFLE
						</span>
						<Switch checked={shuffle} onCheckedChange={setShuffle} />
					</div>
				</div>

				<Separator className="bg-cyan-500/20" />

				<div className="px-4 py-2">
					<span className="font-mono text-[10px] tracking-wider text-cyan-400/70">
						TRACKS ({sortedTracks.filter((t) => t.enabled).length}/
						{sortedTracks.length})
					</span>
				</div>

				<ScrollArea className="flex-1 px-2" style={{ height: "calc(100vh - 340px)" }}>
					{sortedTracks.map((track, index) => (
						<div
							key={track.id}
							draggable
							onDragStart={() => handleDragStart(index)}
							onDragOver={(e) => handleDragOver(e, index)}
							onDragEnd={() => {
								setDragIndex(null);
								setDragOverIndex(null);
							}}
							onDrop={() => handleDrop(index)}
							className={`flex items-center gap-2 px-2 py-2 mx-1 mb-1 rounded border transition-colors cursor-grab active:cursor-grabbing ${
								dragOverIndex === index
									? "border-cyan-400/60 bg-cyan-500/10"
									: currentTrackId === track.id
										? "border-cyan-500/40 bg-cyan-500/5"
										: "border-transparent hover:border-cyan-500/20 hover:bg-cyan-500/5"
							}`}
						>
							<GripVertical className="w-3 h-3 text-cyan-500/40 flex-shrink-0" />

							{currentTrackId === track.id && (
								<div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse flex-shrink-0" />
							)}

							<div
							className="flex-1 min-w-0 cursor-pointer"
							onClick={() => track.enabled && onPlayTrack?.(track.id)}
						>
								<div
									className={`font-mono text-[11px] tracking-wide truncate ${
										track.enabled ? "text-cyan-200 hover:text-white" : "text-cyan-600"
									}`}
								>
									{track.name}
								</div>
								{track.isBundled && (
									<div className="font-mono text-[8px] tracking-widest text-cyan-500/50">
										DEFAULT
									</div>
								)}
								{track.unavailable && (
									<div className="font-mono text-[8px] tracking-widest text-red-400/70">
										UNAVAILABLE
									</div>
								)}
							</div>

							<Switch
								checked={track.enabled}
								onCheckedChange={() => toggleTrack(track.id)}
								className="scale-75"
							/>

							{!track.isBundled && (
								<button
									onClick={() => removeTrack(track.id)}
									className="text-cyan-600 hover:text-red-400 transition-colors"
								>
									<Trash2 className="w-3 h-3" />
								</button>
							)}
						</div>
					))}
				</ScrollArea>

				<div className="px-4 py-3 space-y-2">
					<div
						onDragOver={(e) => {
							e.preventDefault();
							setIsDroppingFile(true);
						}}
						onDragLeave={() => setIsDroppingFile(false)}
						onDrop={handleFileDrop}
						className={`flex items-center justify-center gap-2 py-3 border border-dashed rounded transition-colors cursor-pointer ${
							isDroppingFile
								? "border-cyan-400 bg-cyan-500/10"
								: "border-cyan-500/30 hover:border-cyan-500/50"
						}`}
						onClick={() => fileInputRef.current?.click()}
					>
						<Plus className="w-3 h-3 text-cyan-400" />
						<span className="font-mono text-[10px] tracking-wider text-cyan-400">
							ADD.TRACK
						</span>
					</div>
					<input
						ref={fileInputRef}
						type="file"
						accept="audio/*"
						multiple
						className="hidden"
						onChange={handleFileSelect}
					/>

					<button
						onClick={resetToDefaults}
						className="w-full py-1.5 font-mono text-[9px] tracking-widest text-cyan-600 hover:text-cyan-400 transition-colors"
					>
						RESET.DEFAULTS
					</button>
				</div>

				<Separator className="bg-cyan-500/20" />

				{/* Collapsible SFX levels */}
				<div className="px-4 py-2">
					<button
						onClick={() => setSfxOpen(!sfxOpen)}
						className="flex items-center gap-1 w-full font-mono text-[10px] tracking-wider text-cyan-400/70 hover:text-cyan-300 transition-colors"
					>
						{sfxOpen ? (
							<ChevronDown className="w-3 h-3" />
						) : (
							<ChevronRight className="w-3 h-3" />
						)}
						SOUND.FX
					</button>
				</div>

				{sfxOpen && (
					<div className="px-4 pb-3 space-y-3">
						{(Object.keys(SFX_LABELS) as (keyof SfxLevels)[]).map((key) => (
							<div key={key} className="space-y-1">
								<div className="flex items-center justify-between">
									<span className="font-mono text-[9px] tracking-wider text-cyan-400/60">
										{SFX_LABELS[key]}
									</span>
									<span className="font-mono text-[9px] text-cyan-300/70">
										{Math.round(sfxLevels[key] * 100)}%
									</span>
								</div>
								<Slider
									value={[sfxLevels[key] * 100]}
									onValueChange={([v]) => setSfxLevel(key, v / 100)}
									max={100}
									step={1}
									className="w-full"
								/>
							</div>
						))}
						<button
							onClick={resetSfx}
							className="w-full py-1 font-mono text-[8px] tracking-widest text-cyan-600 hover:text-cyan-400 transition-colors"
						>
							RESET.SFX.DEFAULTS
						</button>
					</div>
				)}
			</SheetContent>
		</Sheet>
	);
}
