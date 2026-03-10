import { Settings2 } from "lucide-react";
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
import { usePilotStore, type PilotStyle } from "@/stores/pilotStore";

export function PilotSettings({ currentAge }: { currentAge: number }) {
	const { settings, set, resetToDefaults } = usePilotStore();

	return (
		<Sheet>
			<SheetTrigger asChild>
				<button
					className="flex items-center gap-1 px-2 py-1 font-mono text-[10px] tracking-widest text-cyan-400 hover:text-cyan-200 hover:bg-cyan-500/10 border border-cyan-500/20 hover:border-cyan-500/40 transition-colors pointer-events-auto"
					title="Pilot Settings"
				>
					<Settings2 className="w-3 h-3" />
					PILOT.AGE: {currentAge}
				</button>
			</SheetTrigger>
			<SheetContent
				side="left"
				className="w-80 bg-gradient-to-b from-cyan-950 to-zinc-950 border-r border-cyan-500/30 p-0"
			>
				<SheetHeader className="px-4 pt-4 pb-2">
					<SheetTitle className="font-mono text-sm tracking-widest text-cyan-300">
						PILOT.SETTINGS
					</SheetTitle>
				</SheetHeader>

				<div className="px-4 py-3 space-y-3 overflow-y-auto max-h-[calc(100vh-4rem)]">
					{/* ── NAVIGATION ── */}
					<div className="font-mono text-[9px] tracking-[0.3em] text-cyan-300/50 pt-1">NAVIGATION</div>

					{/* Autopilot */}
					<div className="space-y-1">
						<div className="flex items-center justify-between">
							<span className="font-mono text-[10px] tracking-wider text-cyan-400/70">
								AUTOPILOT
							</span>
							<Switch
								checked={settings.autopilot}
								onCheckedChange={(v) => set("autopilot", v)}
							/>
						</div>
						<p className="font-mono text-[8px] tracking-wider text-cyan-500/40">
							Ship avoids obstacles automatically
						</p>
					</div>

					{/* Pilot Style — only visible when autopilot is on */}
					{settings.autopilot && (
						<div className="space-y-2">
							<span className="font-mono text-[10px] tracking-wider text-cyan-400/70">
								PILOT.STYLE
							</span>
							<div className="flex gap-1">
								{(["cautious", "bold", "aggressive"] as PilotStyle[]).map((style) => (
									<button
										key={style}
										onClick={() => set("pilotStyle", style)}
										className={`flex-1 py-1.5 font-mono text-[9px] tracking-widest border transition-colors ${
											settings.pilotStyle === style
												? "text-cyan-200 border-cyan-400/60 bg-cyan-500/15"
												: "text-cyan-600 border-cyan-500/20 hover:border-cyan-500/40 hover:text-cyan-400"
										}`}
									>
										{style.toUpperCase()}
									</button>
								))}
							</div>
							<p className="font-mono text-[8px] tracking-wider text-cyan-500/40">
								{settings.pilotStyle === "cautious" && "Safe distance from all entities"}
								{settings.pilotStyle === "bold" && "Investigates entities with graceful fly-bys"}
								{settings.pilotStyle === "aggressive" && "Gets dangerously close to entities"}
							</p>
						</div>
					)}

					{/* Speed */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<span className="font-mono text-[10px] tracking-wider text-cyan-400/70">
								CRUISE.SPEED
							</span>
							<span className="font-mono text-[10px] text-cyan-300">
								{Math.round(settings.speedMultiplier * 100)}%
							</span>
						</div>
						<Slider
							value={[settings.speedMultiplier * 100]}
							onValueChange={([v]) => set("speedMultiplier", v / 100)}
							min={30}
							max={200}
							step={5}
							className="w-full"
						/>
					</div>

					{/* Tempo Sync */}
					<div className="space-y-1">
						<div className="flex items-center justify-between">
							<span className="font-mono text-[10px] tracking-wider text-cyan-400/70">
								TEMPO.SYNC
							</span>
							<Switch
								checked={settings.tempoSync}
								onCheckedChange={(v) => set("tempoSync", v)}
							/>
						</div>
						<p className="font-mono text-[8px] tracking-wider text-cyan-500/40">
							Cruise speed follows music tempo
						</p>
					</div>

					<Separator className="bg-cyan-500/20" />

					{/* ── ENVIRONMENT ── */}
					<div className="font-mono text-[9px] tracking-[0.3em] text-cyan-300/50">ENVIRONMENT</div>

					{/* Entity Density */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<span className="font-mono text-[10px] tracking-wider text-cyan-400/70">
								ENTITY.DENSITY
							</span>
							<span className="font-mono text-[10px] text-cyan-300">
								{Math.round(settings.entityDensity * 100)}%
							</span>
						</div>
						<Slider
							value={[settings.entityDensity * 100]}
							onValueChange={([v]) => set("entityDensity", v / 100)}
							min={20}
							max={200}
							step={10}
							className="w-full"
						/>
						<p className="font-mono text-[8px] tracking-wider text-cyan-500/40">
							How many creatures inhabit the tunnel
						</p>
					</div>

					{/* Music Reactivity */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<span className="font-mono text-[10px] tracking-wider text-cyan-400/70">
								MUSIC.REACTIVITY
							</span>
							<span className="font-mono text-[10px] text-cyan-300">
								{Math.round(settings.musicReactivity * 100)}%
							</span>
						</div>
						<Slider
							value={[settings.musicReactivity * 100]}
							onValueChange={([v]) => set("musicReactivity", v / 100)}
							min={0}
							max={300}
							step={10}
							className="w-full"
						/>
						<p className="font-mono text-[8px] tracking-wider text-cyan-500/40">
							How strongly entities react to music
						</p>
					</div>

					<Separator className="bg-cyan-500/20" />

					{/* ── WEAPONS ── */}
					<div className="font-mono text-[9px] tracking-[0.3em] text-cyan-300/50">WEAPONS</div>

					{/* Flare Cooldown */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<span className="font-mono text-[10px] tracking-wider text-cyan-400/70">
								FLARE.COOLDOWN
							</span>
							<span className="font-mono text-[10px] text-cyan-300">
								{settings.flareCooldown.toFixed(1)}s
							</span>
						</div>
						<Slider
							value={[settings.flareCooldown * 10]}
							onValueChange={([v]) => set("flareCooldown", v / 10)}
							min={3}
							max={30}
							step={1}
							className="w-full"
						/>
					</div>

					<Separator className="bg-cyan-500/20" />

					{/* ── SURVIVAL ── */}
					<div className="font-mono text-[9px] tracking-[0.3em] text-cyan-300/50">SURVIVAL</div>

					{/* Ignore Death */}
					<div className="space-y-1">
						<div className="flex items-center justify-between">
							<span className="font-mono text-[10px] tracking-wider text-cyan-400/70">
								IGNORE.DEATH
							</span>
							<Switch
								checked={settings.ignoreDeath}
								onCheckedChange={(v) => set("ignoreDeath", v)}
							/>
						</div>
						<p className="font-mono text-[8px] tracking-wider text-cyan-500/40">
							Keep flying forever — screensaver mode
						</p>
					</div>

					{/* Skip Intro */}
					<div className="space-y-1">
						<div className="flex items-center justify-between">
							<span className="font-mono text-[10px] tracking-wider text-cyan-400/70">
								SKIP.INTRO
							</span>
							<Switch
								checked={settings.skipIntro}
								onCheckedChange={(v) => set("skipIntro", v)}
							/>
						</div>
						<p className="font-mono text-[8px] tracking-wider text-cyan-500/40">
							Skip transmission, go to pilot initialization
						</p>
					</div>

					<Separator className="bg-cyan-500/20" />

					<button
						onClick={resetToDefaults}
						className="w-full py-1.5 font-mono text-[9px] tracking-widest text-cyan-600 hover:text-cyan-400 transition-colors"
					>
						RESET.DEFAULTS
					</button>
				</div>
			</SheetContent>
		</Sheet>
	);
}
