import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, GripVertical, Music, Plus, Trash2 } from "lucide-react";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePlaylistStore } from "@/stores/playlistStore";
import { useSfxStore, SFX_LABELS, type SfxLevels } from "@/stores/sfxStore";

export function PlaylistSettings({ currentTrackId, onPlayTrack }: { currentTrackId: string | null; onPlayTrack?: (trackId: string) => void }) {
	const {
		tracks,
		playlists,
		activePlaylistIndex,
		volume,
		addTrackFromFile,
		removeTrack,
		setVolume,
		addPlaylist,
		removePlaylist,
		renamePlaylist,
		setActivePlaylist,
		addTrackToPlaylist,
		removeTrackFromPlaylist,
		reorderPlaylistTracks,
		setPlaylistShuffle,
		resetToDefaults,
	} = usePlaylistStore();

	const { levels: sfxLevels, setLevel: setSfxLevel, resetToDefaults: resetSfx } = useSfxStore();
	const [sfxOpen, setSfxOpen] = useState(false);
	const [editingPlaylist, setEditingPlaylist] = useState<number>(activePlaylistIndex);
	const [isDroppingFile, setIsDroppingFile] = useState(false);
	const [editingName, setEditingName] = useState<number | null>(null);
	const [nameValue, setNameValue] = useState("");
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const folderInputRef = useRef<HTMLInputElement>(null);

	const currentPlaylist = playlists[editingPlaylist];
	const playlistTrackObjects = currentPlaylist
		? currentPlaylist.trackIds
				.map((id) => tracks.find((t) => t.id === id))
				.filter((t): t is NonNullable<typeof t> => t != null)
		: [];

	// Tracks not in the current playlist (available to add)
	const availableTracks = tracks.filter(
		(t) => !currentPlaylist?.trackIds.includes(t.id),
	);

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
		const files = Array.from(e.target.files ?? []).filter(
			(f) => f.type.startsWith("audio/") || /\.(mp3|wav|ogg|flac|m4a|aac|wma)$/i.test(f.name),
		);
		for (const file of files) {
			addAudioFile(file);
		}
		if (fileInputRef.current) fileInputRef.current.value = "";
		if (folderInputRef.current) folderInputRef.current.value = "";
	};

	const addAudioFile = (file: File) => {
		if (file.size > 50 * 1024 * 1024) {
			alert("File is too large (max 50MB).");
			return;
		}
		const name = file.name.replace(/\.[^/.]+$/, "");
		addTrackFromFile(name, file);
	};

	const startRenamingPlaylist = (index: number) => {
		if (index === 0) return;
		setEditingName(index);
		setNameValue(playlists[index].name);
	};

	const finishRenaming = () => {
		if (editingName !== null && nameValue.trim()) {
			renamePlaylist(editingName, nameValue.trim().toUpperCase());
		}
		setEditingName(null);
	};

	const handleDrop = (toIndex: number) => {
		if (dragIndex !== null && dragIndex !== toIndex) {
			reorderPlaylistTracks(editingPlaylist, dragIndex, toIndex);
		}
		setDragIndex(null);
		setDragOverIndex(null);
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
						AUDIO.PLAYLISTS
					</SheetTitle>
				</SheetHeader>

				{/* Volume */}
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
				</div>

				<Separator className="bg-cyan-500/20" />

				{/* Playlist selector tabs */}
				<div className="px-4 py-2">
					<div className="flex items-center justify-between mb-2">
						<span className="font-mono text-[10px] tracking-wider text-cyan-400/70">
							PLAYLISTS ({playlists.length}/9)
						</span>
						{playlists.length < 9 && (
							<button
								onClick={() => {
									addPlaylist(`MIX ${playlists.length}`);
									setEditingPlaylist(playlists.length);
								}}
								className="font-mono text-[9px] tracking-wider text-cyan-500/60 hover:text-cyan-300 transition-colors"
							>
								+ NEW
							</button>
						)}
					</div>
					<div className="flex flex-wrap gap-1">
						{playlists.map((pl, i) => (
							<button
								key={pl.id}
								onClick={() => setEditingPlaylist(i)}
								onDoubleClick={() => startRenamingPlaylist(i)}
								className={`px-2 py-1 font-mono text-[9px] tracking-wider border transition-colors ${
									editingPlaylist === i
										? "text-cyan-200 border-cyan-400/60 bg-cyan-500/15"
										: i === activePlaylistIndex
											? "text-cyan-400 border-cyan-500/30 bg-cyan-500/5"
											: "text-cyan-600 border-cyan-500/20 hover:border-cyan-500/40 hover:text-cyan-400"
								}`}
							>
								{editingName === i ? (
									<input
										value={nameValue}
										onChange={(e) => setNameValue(e.target.value)}
										onBlur={finishRenaming}
										onKeyDown={(e) => {
											if (e.key === "Enter") finishRenaming();
											if (e.key === "Escape") setEditingName(null);
										}}
										className="bg-transparent border-none outline-none w-12 font-mono text-[9px] text-cyan-200"
										autoFocus
									/>
								) : (
									<span>{i + 1}:{pl.name}</span>
								)}
							</button>
						))}
					</div>
				</div>

				<Separator className="bg-cyan-500/20" />

				{/* Selected playlist details */}
				{currentPlaylist && (
					<>
						<div className="px-4 py-2 flex items-center justify-between">
							<span className="font-mono text-[10px] tracking-wider text-cyan-400/70">
								{currentPlaylist.name} — {playlistTrackObjects.length} TRACKS
							</span>
							<div className="flex items-center gap-2">
								<span className="font-mono text-[8px] tracking-wider text-cyan-500/40">SHUFFLE</span>
								<Switch
									checked={currentPlaylist.shuffle}
									onCheckedChange={(v) => setPlaylistShuffle(editingPlaylist, v)}
									className="scale-75"
								/>
							</div>
						</div>

						{/* Tracks in this playlist */}
						<ScrollArea className="flex-1 px-2" style={{ height: "calc(100vh - 480px)" }}>
							{playlistTrackObjects.map((track, index) => (
								<div
									key={track.id}
									draggable
									onDragStart={() => setDragIndex(index)}
									onDragOver={(e) => { e.preventDefault(); setDragOverIndex(index); }}
									onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
									onDrop={() => handleDrop(index)}
									className={`flex items-center gap-2 px-2 py-1.5 mx-1 mb-1 rounded border transition-colors cursor-grab active:cursor-grabbing ${
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
										onClick={() => onPlayTrack?.(track.id)}
									>
										<div className={`font-mono text-[11px] tracking-wide truncate text-cyan-200 hover:text-white`}>
											{track.name}
										</div>
										{track.isBundled && (
											<div className="font-mono text-[7px] tracking-widest text-cyan-500/50">BUNDLED</div>
										)}
									</div>
									{/* Can remove from playlist (but not bundled from bundled playlist) */}
									{!(editingPlaylist === 0 && track.isBundled) && (
										<button
											onClick={() => removeTrackFromPlaylist(editingPlaylist, track.id)}
											className="text-cyan-700 hover:text-red-400 transition-colors"
											title="Remove from playlist"
										>
											<Trash2 className="w-3 h-3" />
										</button>
									)}
								</div>
							))}
						</ScrollArea>

						{/* Available tracks to add */}
						{availableTracks.length > 0 && (
							<div className="px-4 py-2">
								<div className="font-mono text-[9px] tracking-wider text-cyan-500/40 mb-1">ADD TO PLAYLIST</div>
								<div className="space-y-0.5 max-h-48 overflow-y-auto">
									{availableTracks.map((track) => (
										<button
											key={track.id}
											onClick={() => addTrackToPlaylist(editingPlaylist, track.id)}
											className="flex items-center gap-2 w-full px-2 py-1 rounded font-mono text-[10px] tracking-wide text-cyan-600 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors text-left"
										>
											<Plus className="w-3 h-3 flex-shrink-0" />
											<span className="truncate">{track.name}</span>
										</button>
									))}
								</div>
							</div>
						)}

						{/* Delete playlist (not bundled) */}
						{editingPlaylist > 0 && (
							<div className="px-4 py-1">
								<button
									onClick={() => {
										removePlaylist(editingPlaylist);
										setEditingPlaylist(Math.max(0, editingPlaylist - 1));
									}}
									className="w-full py-1 font-mono text-[8px] tracking-widest text-red-600/60 hover:text-red-400 transition-colors"
								>
									DELETE.PLAYLIST
								</button>
							</div>
						)}
					</>
				)}

				<Separator className="bg-cyan-500/20" />

				{/* Upload tracks */}
				<div className="px-4 py-2 space-y-2">
					<div
						onDragOver={(e) => {
							e.preventDefault();
							setIsDroppingFile(true);
						}}
						onDragLeave={() => setIsDroppingFile(false)}
						onDrop={handleFileDrop}
						className={`flex items-center justify-center gap-2 py-2 border border-dashed rounded transition-colors cursor-pointer ${
							isDroppingFile
								? "border-cyan-400 bg-cyan-500/10"
								: "border-cyan-500/30 hover:border-cyan-500/50"
						}`}
						onClick={() => fileInputRef.current?.click()}
					>
						<Plus className="w-3 h-3 text-cyan-400" />
						<span className="font-mono text-[10px] tracking-wider text-cyan-400">
							UPLOAD.TRACK
						</span>
					</div>
					<button
						onClick={() => folderInputRef.current?.click()}
						className="flex items-center justify-center gap-2 w-full py-2 border border-dashed rounded transition-colors cursor-pointer border-cyan-500/30 hover:border-cyan-500/50"
					>
						<Plus className="w-3 h-3 text-cyan-400" />
						<span className="font-mono text-[10px] tracking-wider text-cyan-400">
							ADD.FOLDER
						</span>
					</button>
					<input
						ref={fileInputRef}
						type="file"
						accept="audio/*"
						multiple
						className="hidden"
						onChange={handleFileSelect}
					/>
					<input
						ref={folderInputRef}
						type="file"
						// @ts-expect-error webkitdirectory is non-standard but widely supported
						webkitdirectory=""
						multiple
						className="hidden"
						onChange={handleFileSelect}
					/>

					{/* Track library — manage uploaded tracks */}
					{tracks.filter((t) => !t.isBundled).length > 0 && (
						<div className="space-y-0.5">
							<div className="font-mono text-[8px] tracking-wider text-cyan-500/40">UPLOADED TRACKS</div>
							{tracks.filter((t) => !t.isBundled).map((track) => (
								<div key={track.id} className="flex items-center justify-between px-1">
									<span className={`font-mono text-[9px] tracking-wide truncate ${track.unavailable ? 'text-red-400/60' : 'text-cyan-600'}`}>
										{track.name}
										{track.unavailable && ' (LOST)'}
									</span>
									<button
										onClick={() => removeTrack(track.id)}
										className="text-cyan-700 hover:text-red-400 transition-colors"
									>
										<Trash2 className="w-2.5 h-2.5" />
									</button>
								</div>
							))}
						</div>
					)}

					<button
						onClick={resetToDefaults}
						className="w-full py-1 font-mono text-[9px] tracking-widest text-cyan-600 hover:text-cyan-400 transition-colors"
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
