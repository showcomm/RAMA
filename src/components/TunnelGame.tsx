import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import monitorReadoutAudio from "@/assets/Interface-Futuristic-Thin-Data-Readout.mp3";
import dronesAudio from "@/assets/drones-03.mp3";
import bombAudio from "@/assets/Bomb17.mp3";
import flybyAudioFile from "@/assets/Abstract_Fly_By_06.mp3";
import { PlaylistManager } from "@/lib/PlaylistManager";
import { usePlaylistStore } from "@/stores/playlistStore";
import { useSfxStore } from "@/stores/sfxStore";
import { BehaviorSystem, getMurmurationZBoost, isMurmurationActive, didMurmurationJustTrigger } from "@/game/behavior";
import type { BehaviorState, BehaviorContext } from "@/game/behavior";
import { PlaylistSettings } from "@/components/PlaylistSettings";
import { PilotSettings } from "@/components/PilotSettings";
import { usePilotStore } from "@/stores/pilotStore";
import geometricModelUrl from "@/assets/geometric_o.glb?url";
import torusModelUrl from "@/assets/torus_shap_1208213451_texture.glb?url";
import orbModelUrl from "@/assets/orb_shaped_1208213459_texture.glb?url";
import shardModelUrl from "@/assets/thin_column.glb?url";

interface HighScoreModel {
	player_name: string;
	score: number;
	level_reached: number;
	time_survived: number;
}

const HIGH_SCORES_KEY = "rama_rendezvous_high_scores";

function loadLocalHighScores(): HighScoreModel[] {
	try {
		const raw = localStorage.getItem(HIGH_SCORES_KEY);
		if (!raw) return [];
		const scores: HighScoreModel[] = JSON.parse(raw);
		return scores.sort((a, b) => b.score - a.score).slice(0, 10);
	} catch {
		return [];
	}
}

function saveLocalHighScore(entry: HighScoreModel): void {
	const scores = loadLocalHighScores();
	scores.push(entry);
	scores.sort((a, b) => b.score - a.score);
	localStorage.setItem(HIGH_SCORES_KEY, JSON.stringify(scores.slice(0, 10)));
}

interface GameState {
	score: number;
	level: number;
	shields: number;
	timeStarted: number;
	isGameOver: boolean;
	isPaused: boolean;
	damageFlash: number;
	playerAge: number | null;
	maxAge: number;
	showAgeInput: boolean;
	rageLevel: number; // 0-100, current accumulated rage in the environment
	collisionCount: number; // total non-mote collisions
	deathSequence: boolean;   // true when dying — tunnel darkens
	deathStartTime: number;   // when the death sequence began
}

interface Obstacle {
	mesh: THREE.Mesh;
	zPosition: number;
	basePosition: THREE.Vector3; // Original spawn position
	targetPosition: THREE.Vector3; // Where it wants to be based on behavior
	velocity: THREE.Vector3; // Current movement velocity
	birthTime: number; // When it was created
	angerLevel: number; // 0-1, how angry this cloud being is
	angerTime: number; // When it was last angered
	lastCollisionTime: number; // Cooldown to prevent multi-count
	behavior: BehaviorState | null; // Behavior system state
}

interface Projectile {
	mesh: THREE.Mesh;
	velocity: THREE.Vector3;
	light: THREE.PointLight; // Flare light that illuminates the tunnel
	distanceTraveled: number; // How far the flare has traveled
	ignitionDistance: number; // Distance before it ignites
	hasIgnited: boolean; // Whether the flare has ignited yet
	ignitionTime: number; // When it ignited (for fade timing)
}

interface Mote {
	mesh: THREE.Mesh;
	zPosition: number;
	velocity: THREE.Vector3;
	baseIntensity: number; // Base emissive glow
	wobblePhase: number; // Unique phase for organic movement
	behavior: BehaviorState | null; // Behavior system state
}

// A self-contained flock: firefly leader + ~30 motes with individual physics
interface FlockMember {
	mesh: THREE.Mesh;
	vel: THREE.Vector3;        // individual velocity
	accelScale: number;        // 0.6-1.4 — how responsive this mote is (variation)
	preferredDist: number;     // 0.8-2.0 — how far from leader it likes to be
	phase: number;             // unique phase for subtle motion
}

interface Flock {
	leader: THREE.Mesh;
	members: FlockMember[];
	leaderPos: THREE.Vector3;
	leaderVel: THREE.Vector3;
	spawnTime: number;
	wanderTarget: THREE.Vector2;
	wanderTimer: number;
}

interface CorkscrewObstacle {
	mesh: THREE.Mesh;
	groupId: string; // Shared ID for all obstacles in the formation
	angleOffset: number; // Position in the corkscrew
	zPosition: number; // Position along tunnel
	radius: number; // Distance from center
	birthTime: number; // When group was created
}

interface CorkscrewGroup {
	id: string;
	obstacles: CorkscrewObstacle[];
	startZ: number;
	birthTime: number;
	isExploding: boolean;
	flybyAudio: HTMLAudioElement | null;
	flybyPlayCount: number;
	lastFlybyEndTime: number;
	rotationSpeed: number;
}

interface RollingSphere {
	mesh: THREE.Mesh;
	zPosition: number; // Position along tunnel
	angle: number; // Current angle around the tunnel (radians)
	radius: number; // Distance from tunnel center (on the inner surface)
	size: number; // Size multiplier (1-4)
	birthTime: number; // When it was created
	angularVelocity: number; // How fast it spins around the tunnel (radians/sec)
	forwardVelocity: number; // How fast it moves through the tunnel
	rotationAxis: THREE.Vector3; // Axis of rotation for rolling effect
	rotationSpeed: number; // Speed of visual rolling
}

interface QuarkPair {
	meshA: THREE.Mesh;
	meshB: THREE.Mesh;
	zPosition: number;
	birthTime: number;
	// Helix orbit state
	orbitAngle: number;       // current angle in the helix
	orbitRadius: number;      // current distance between the pair center and each shard
	baseOrbitRadius: number;  // resting orbit radius
	orbitSpeed: number;       // radians/sec
	// Center position in tunnel cross-section
	centerX: number;
	centerY: number;
	// Quark drift/snap state
	driftPhase: "orbit" | "drifting" | "snapping";
	driftStartTime: number;
	nextDriftTime: number;    // when the next drift event triggers
	maxDriftRadius: number;   // how far apart they drift
	behaviorA: BehaviorState | null;
	behaviorB: BehaviorState | null;
}

interface ShatterFragment {
	meshA: THREE.Mesh;
	meshB: THREE.Mesh;
	birthTime: number;
	// Drift outward from impact
	cx: number;
	cy: number;
	cz: number;
	driftX: number;
	driftY: number;
	driftZ: number;
	// Mini orbit
	orbitAngle: number;
	orbitRadius: number;
	orbitSpeed: number;
	// Rotation speeds
	spinA: { x: number; y: number; z: number };
	spinB: { x: number; y: number; z: number };
}

export function TunnelGame() {
	const canvasRef = useRef<HTMLDivElement>(null);
	const [gameState, setGameState] = useState<GameState>({
		score: 0,
		level: 1,
		shields: 5,
		timeStarted: Date.now(),
		isGameOver: false,
		isPaused: false,
		damageFlash: 0,
		playerAge: null,
		maxAge: 80 + Math.floor(Math.random() * 41), // Random between 80-120
		showAgeInput: true,
		rageLevel: 0,
			collisionCount: 0,
		deathSequence: false,
		deathStartTime: 0,
	});
	const [highScores, setHighScores] = useState<HighScoreModel[]>([]);
	const [showHighScores, setShowHighScores] = useState(false);
	const [radioOpen, setRadioOpen] = useState(true);
	const [musicMuted, setMusicMuted] = useState(false);
	const [ageInput, setAgeInput] = useState("");
	const [showStoryModal, setShowStoryModal] = useState(() => !usePilotStore.getState().settings.skipIntro);
	const [storyStarted, setStoryStarted] = useState(false);
	const [storyText, setStoryText] = useState("");
	const [showContinueButton, setShowContinueButton] = useState(false);

	// Game refs
	const sceneRef = useRef<THREE.Scene | null>(null);
	const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
	const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
	const spaceshipRef = useRef<THREE.Group | null>(null);
	const tunnelSegmentsRef = useRef<THREE.Mesh[]>([]);
	const obstaclesRef = useRef<Obstacle[]>([]);
	const projectilesRef = useRef<Projectile[]>([]);
	const motesRef = useRef<Mote[]>([]);
	const corkscrewGroupsRef = useRef<CorkscrewGroup[]>([]);
	const rollingSpheresRef = useRef<RollingSphere[]>([]);
	const flockRef = useRef<Flock | null>(null);
	const lastFlockTime = useRef(0);
	const keysRef = useRef<{ [key: string]: boolean }>({});
	const gameStateRef = useRef(gameState);
	const animationFrameRef = useRef<number | undefined>(undefined);
	const glbModelRef = useRef<THREE.Group | null>(null);
	const torusModelRef = useRef<THREE.Group | null>(null);
	const orbModelRef = useRef<THREE.Group | null>(null);
	const shardModelRef = useRef<THREE.Group | null>(null);
	const quarkPairsRef = useRef<QuarkPair[]>([]);
	const shatterFragmentsRef = useRef<ShatterFragment[]>([]);

	// Audio system refs
	const playlistManagerRef = useRef<PlaylistManager | null>(null);
	const proximitySoundRef = useRef<HTMLAudioElement | null>(null);
	const atmosphericAmbientRef = useRef<HTMLAudioElement | null>(null);
	const audioAmplitudeRef = useRef<number>(0);
	const knockbackRef = useRef<{ vx: number; vy: number; spin: number }>({ vx: 0, vy: 0, spin: 0 });
	const wallBounceRef = useRef(0); // time remaining on wall bounce (seconds) — skip wall checks while > 0
	const behaviorSystemRef = useRef<BehaviorSystem>(new BehaviorSystem());
	const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
	const playlistTracks = usePlaylistStore((s) => s.tracks);
	const playlistPlaylists = usePlaylistStore((s) => s.playlists);
	const playlistActiveIndex = usePlaylistStore((s) => s.activePlaylistIndex);
	const playlistVolume = usePlaylistStore((s) => s.volume);
	const setActivePlaylist = usePlaylistStore((s) => s.setActivePlaylist);
	const hydrateBlobs = usePlaylistStore((s) => s.hydrateBlobs);

	// Resolve active playlist's track IDs to actual track objects
	const activePlaylist = playlistPlaylists[playlistActiveIndex] ?? playlistPlaylists[0];
	const activePlaylistTracks = activePlaylist
		? activePlaylist.trackIds
				.map((id) => playlistTracks.find((t) => t.id === id))
				.filter((t): t is NonNullable<typeof t> => t != null)
		: [];
	const activePlaylistShuffle = activePlaylist?.shuffle ?? false;

	// Resolve IDB blobs into object URLs on mount
	const hydrated = useRef(false);
	useEffect(() => {
		if (!hydrated.current) {
			hydrated.current = true;
			hydrateBlobs();
		}
	}, [hydrateBlobs]);
	const sfxLevels = useSfxStore((s) => s.levels);
	const sfxLevelsRef = useRef(sfxLevels);
	sfxLevelsRef.current = sfxLevels;

	const pilotSettings = usePilotStore((s) => s.settings);
	const pilotRef = useRef(pilotSettings);
	pilotRef.current = pilotSettings;
	const autopilotVelRef = useRef({ x: 0, y: 0 });
	const lightCycleRef = useRef(0.5);
	// Fog bank system: physical fog discs that scroll through the tunnel
	interface FogBank {
		discs: THREE.Mesh[];
		zStart: number; // z of the first disc
		active: boolean;
	}
	const fogBanksRef = useRef<FogBank[]>([]);
	const fogSpawnTimerRef = useRef(0); // starts with fog at game begin
	const fogDiscGeometry = useRef<THREE.CircleGeometry | null>(null);
	const fogDiscMaterial = useRef<THREE.MeshBasicMaterial | null>(null);

	const createFogBank = (zStart: number, numDiscs: number, peakOpacity: number): FogBank => {
		if (!fogDiscGeometry.current) {
			fogDiscGeometry.current = new THREE.CircleGeometry(6, 16); // slightly larger than tunnel
		}
		if (!fogDiscMaterial.current) {
			fogDiscMaterial.current = new THREE.MeshBasicMaterial({
				color: 0x8a8070, // warm gray mist
				transparent: true,
				opacity: 0.1,
				depthWrite: false,
				side: THREE.DoubleSide,
			});
		}

		const discs: THREE.Mesh[] = [];
		const spacing = 0.4; // very tight spacing for seamless gradient
		for (let i = 0; i < numDiscs; i++) {
			const mat = fogDiscMaterial.current.clone();
			// Bell curve opacity: thick in center, transparent at edges
			// Wider gaussian (sigma ~0.35) for smoother transitions
			const t01 = i / (numDiscs - 1); // 0 to 1
			const bell = Math.exp(-((t01 - 0.5) * (t01 - 0.5)) / 0.08);
			mat.opacity = bell * peakOpacity;
			const disc = new THREE.Mesh(fogDiscGeometry.current, mat);
			disc.position.set(0, 0, zStart - i * spacing);
			disc.renderOrder = 999; // render after other objects
			sceneRef.current?.add(disc);
			discs.push(disc);
		}
		return { discs, zStart, active: true };
	};
	const boldTargetRef = useRef<{ x: number; y: number; z: number; nextPickTime: number; peelOff: boolean; peelStart: number } | null>(null);
	const manualOverrideRef = useRef(0); // timestamp of last manual input
	const cameraShakeRef = useRef(0); // current shake intensity, decays each frame
	const speedRef = useRef(0); // current game speed in z-units/sec for HUD
	const bassEnergyRef = useRef(0); // smoothed bass energy 0-1 from audio analyser
	const midEnergyRef = useRef(0); // smoothed mid energy for level meter
	const trebleEnergyRef = useRef(0); // smoothed treble energy for level meter
	// Mote relay wave — a red "message" that ripples down the tunnel
	const moteRelayRef = useRef<{ startTime: number; startZ: number; prevWavefrontZ: number; visited: Set<Mote> } | null>(null);
	const relayMotesRef = useRef<Map<Mote, number>>(new Map()); // mote → time angered

	const lastCorkscrewSpawnRef = useRef(0);
	// Reusable vector pool for per-frame behavior context (avoids allocations)
	const quarkPosPoolRef = useRef<THREE.Vector3[]>([]);

	// Update game state ref when state changes
	useEffect(() => {
		gameStateRef.current = gameState;
	}, [gameState]);

	// Start playlist + proximity sound when game begins.
	const startGameAudio = () => {
		if (!playlistManagerRef.current) {
			playlistManagerRef.current = new PlaylistManager(setCurrentTrackId);
		}
		const pm = playlistManagerRef.current;
		pm.updatePlaylist(activePlaylistTracks, playlistVolume, activePlaylistShuffle);
		pm.fadeIn(8000);

		// Proximity sound (drones) — starts silent, volume controlled by game
		if (!proximitySoundRef.current) {
			const proximity = document.createElement("audio");
			proximity.src = dronesAudio;
			proximity.loop = true;
			proximity.volume = 0;
			proximity.preload = "auto";
			proximitySoundRef.current = proximity;
			proximity.play().catch((e) => console.error("Proximity play failed:", e));
		}
	};

	// Load GLB models on mount
	useEffect(() => {
		const loader = new GLTFLoader();

		// Load obstacle model
		const modelUrl = geometricModelUrl;
		loader.load(
			modelUrl,
			(gltf) => {
				glbModelRef.current = gltf.scene;
				console.log("Obstacle GLB model loaded successfully");
			},
			undefined,
			(error) => {
				console.error("Error loading obstacle GLB model:", error);
			}
		);

		// Load torus model for corkscrew obstacles
		const torusUrl = torusModelUrl;
		loader.load(
			torusUrl,
			(gltf) => {
				torusModelRef.current = gltf.scene;
				console.log("Torus GLB model loaded successfully");
			},
			undefined,
			(error) => {
				console.error("Error loading torus GLB model:", error);
			}
		);

		// Load orb model for rolling sphere obstacles
		const orbUrl = orbModelUrl;
		loader.load(
			orbUrl,
			(gltf) => {
				orbModelRef.current = gltf.scene;
				console.log("Orb GLB model loaded successfully");
			},
			undefined,
			(error) => {
				console.error("Error loading orb GLB model:", error);
			}
		);

		// Load shard model for quark pairs
		loader.load(
			shardModelUrl,
			(gltf) => {
				shardModelRef.current = gltf.scene;
				console.log("Shard GLB model loaded successfully");
			},
			undefined,
			(error) => {
				console.error("Error loading shard GLB model:", error);
			}
		);
	}, []);

	// Load high scores
	useEffect(() => {
		loadHighScores();
	}, []);

	// Typing effect + readout audio — starts after user clicks "begin"
	useEffect(() => {
		if (!storyStarted) return;

		const fullStoryText = "In the year 2139, Rama entered our solar system. Over 500 km in length, it appears to be on autopilot. Scouts exploring inside report an alien ecosystem of biomechanical creatures. They show no interest in humanity. No scout has ever returned from inside Rama.";

		// Audio plays immediately — we have a user gesture from the "begin" click
		const audio = new Audio(monitorReadoutAudio);
		audio.loop = true;
		audio.volume = sfxLevels.monitorReadout;
		atmosphericAmbientRef.current = audio;
		audio.play().catch(() => {});

		let currentIndex = 0;
		const typingSpeed = 30;

		const typingInterval = setInterval(() => {
			if (currentIndex < fullStoryText.length) {
				setStoryText(fullStoryText.substring(0, currentIndex + 1));
				currentIndex++;
			} else {
				clearInterval(typingInterval);
				audio.pause();
				audio.currentTime = 0;
				atmosphericAmbientRef.current = null;
				setShowContinueButton(true);
			}
		}, typingSpeed);

		return () => {
			clearInterval(typingInterval);
			audio.pause();
			atmosphericAmbientRef.current = null;
		};
	}, [storyStarted]);

	const loadHighScores = () => {
		setHighScores(loadLocalHighScores());
	};

	const saveHighScore = () => {
		const timeSurvived = Date.now() - gameStateRef.current.timeStarted;
		saveLocalHighScore({
			player_name: "Player",
			score: gameStateRef.current.score,
			level_reached: gameStateRef.current.level,
			time_survived: timeSurvived,
		});
		loadHighScores();
	};

	// Audio pool — reuse a small set of Audio elements instead of creating new ones
	const audioPoolRef = useRef<HTMLAudioElement[]>([]);
	const audioPoolIndex = useRef(0);
	const getPooledAudio = (src: string, volume: number) => {
		const POOL_SIZE = 8;
		if (audioPoolRef.current.length < POOL_SIZE) {
			audioPoolRef.current.push(new Audio());
		}
		const audio = audioPoolRef.current[audioPoolIndex.current % POOL_SIZE];
		audioPoolIndex.current++;
		audio.src = src;
		audio.volume = volume;
		audio.currentTime = 0;
		audio.play().catch(() => {});
	};

	const playCollisionSound = () => {
		getPooledAudio(bombAudio, sfxLevelsRef.current.collision);
	};

	const playFlareHitSound = () => {
		getPooledAudio(bombAudio, sfxLevelsRef.current.flareHit);
	};

	// Dispose geometry & materials from a mesh (or group) to free GPU memory
	const disposeMesh = (obj: THREE.Object3D) => {
		obj.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				child.geometry?.dispose();
				if (Array.isArray(child.material)) {
					child.material.forEach((m) => m.dispose());
				} else if (child.material) {
					child.material.dispose();
				}
			}
		});
	};


	// Start playlist when game scene is ready
	useEffect(() => {
		if (gameState.showAgeInput || showStoryModal || gameState.isGameOver) return;
		startGameAudio();
	}, [gameState.showAgeInput, showStoryModal, gameState.isGameOver]);

	// Keep playlist in sync when user changes settings mid-game
	useEffect(() => {
		if (playlistManagerRef.current) {
			playlistManagerRef.current.updatePlaylist(activePlaylistTracks, playlistVolume, activePlaylistShuffle);
		}
	}, [activePlaylistTracks, playlistVolume, activePlaylistShuffle]);

	// Sync mute state
	useEffect(() => {
		if (playlistManagerRef.current) {
			playlistManagerRef.current.setMuted(musicMuted);
		}
	}, [musicMuted]);

	// Clean up audio on unmount
	useEffect(() => {
		return () => {
			if (playlistManagerRef.current) {
				playlistManagerRef.current.dispose();
				playlistManagerRef.current = null;
			}
			if (proximitySoundRef.current) {
				proximitySoundRef.current.pause();
				proximitySoundRef.current = null;
			}
		};
	}, []);

	// Initialize Three.js scene
	useEffect(() => {
		if (!canvasRef.current || gameState.showAgeInput || showStoryModal) return;

		// Scene setup
		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0x1a1510); // Darker background
		scene.fog = new THREE.Fog(0x1a1510, 10, 100); // Darker fog to match
		sceneRef.current = scene;

		// Camera setup - wider FOV to ensure tunnel edges are always visible
		const camera = new THREE.PerspectiveCamera(
			90,
			canvasRef.current.clientWidth / canvasRef.current.clientHeight,
			0.1,
			1000
		);
		camera.position.set(0, 1.5, 4);
		cameraRef.current = camera;

		// Renderer setup
		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setSize(canvasRef.current.clientWidth, canvasRef.current.clientHeight);
		canvasRef.current.appendChild(renderer.domElement);
		rendererRef.current = renderer;

		// Lighting — intensities cycle slowly over time in the game loop
		const ambientLight = new THREE.AmbientLight(0xfff4e6, 0.08);
		scene.add(ambientLight);

		const directionalLight = new THREE.DirectionalLight(0xffe4b3, 0.2);
		directionalLight.position.set(5, 8, 10);
		scene.add(directionalLight);

		const rimLight = new THREE.DirectionalLight(0xffd9a3, 0.1);
		rimLight.position.set(-5, -3, -10);
		scene.add(rimLight);

		// Red backlight — rage indicator, positioned behind the camera
		const rageLight = new THREE.PointLight(0xff2200, 0, 40);
		rageLight.position.set(0, 0, 8);
		scene.add(rageLight);

		// Create origami spaceship
		const spaceship = createOrigamiSpaceship();
		spaceship.position.set(0, 0, 0);
		scene.add(spaceship);
		spaceshipRef.current = spaceship;

		// Create initial tunnel segments
		for (let i = 0; i < 20; i++) {
			const segment = createTunnelSegment(i);
			scene.add(segment);
			tunnelSegmentsRef.current.push(segment);
		}

		// Handle window resize
		const handleResize = () => {
			if (!canvasRef.current || !camera || !renderer) return;
			camera.aspect = canvasRef.current.clientWidth / canvasRef.current.clientHeight;
			camera.updateProjectionMatrix();
			renderer.setSize(canvasRef.current.clientWidth, canvasRef.current.clientHeight);
		};
		window.addEventListener("resize", handleResize);

		// Keyboard event listeners
		const handleKeyDown = (e: KeyboardEvent) => {
			keysRef.current[e.key] = true;

			if (e.key === " ") {
				e.preventDefault();
				fireProjectile();
			}
		};

		const handleKeyUp = (e: KeyboardEvent) => {
			keysRef.current[e.key] = false;
		};

		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("keyup", handleKeyUp);

		// Start game loop
		let lastTime = Date.now();
		const gameLoop = () => {
			if (gameStateRef.current.isPaused) {
				animationFrameRef.current = requestAnimationFrame(gameLoop);
				return;
			}

			const currentTime = Date.now();
			const deltaTime = (currentTime - lastTime) / 1000;
			lastTime = currentTime;

			// After game over, render a dim static tunnel behind the modal
			if (gameStateRef.current.isGameOver && !gameStateRef.current.deathSequence) {
				scene.background = new THREE.Color(0x050808);
				ambientLight.intensity = 0.04;
				directionalLight.intensity = 0.1;
				rimLight.intensity = 0.04;
				rageLight.intensity = 0;
				renderer.render(scene, camera);
				animationFrameRef.current = requestAnimationFrame(gameLoop);
				return;
			}

			updateGame(deltaTime);

			// Slow lighting cycle — two sine waves at different speeds
			// for an organic, unpredictable feel. Mostly dark, occasional swells.
			const t = currentTime / 1000;
			const cycle = 0.5 + 0.5 * Math.sin(t * 0.15) * Math.sin(t * 0.07 + 1.3);
			// Start in darkness, stay very dark for 20 seconds then ramp to mid-range
			const timeSinceStart = (currentTime - (gameStateRef.current.timeStarted || currentTime)) / 1000;
			const startRamp = timeSinceStart < 10 ? 0 : Math.min(0.4, (timeSinceStart - 10) / 20) * 2.5; // black for 10s, then 0→1 over next 20s
			const adjustedCycle = cycle * startRamp;
			lightCycleRef.current = adjustedCycle;
			// cycle is 0–1, where 0 = darkest, 1 = brightest
			let ambientIntensity = 0.04 + adjustedCycle * 0.06;
			let directionalIntensity = 0.3 + adjustedCycle * 0.2;
			let rimIntensity = 0.15 + adjustedCycle * 0.15;

			// Death sequence: dim lights, ship flies into the fog
			const state = gameStateRef.current;
			if (state.deathSequence) {
				const deathElapsed = (Date.now() - state.deathStartTime) / 1000;
				const DEATH_DURATION = 8;
				const progress = Math.min(1, deathElapsed / DEATH_DURATION);
				// Ease-out: fast dim at first, settles to a moody low level
				const dimTarget = 0.15; // don't go fully dark — keep eerie glow
				const dimCurve = 1 - (1 - dimTarget) * (1 - Math.pow(1 - progress, 2));
				ambientIntensity *= dimCurve;
				directionalIntensity *= dimCurve;
				rimIntensity *= dimCurve;

				// Entities fade out in the first half
				if (progress > 0.2) {
					const entityFade = Math.max(0, 1 - (progress - 0.2) / 0.4);
					const scaleDown = (mesh: THREE.Object3D) => {
						mesh.scale.setScalar(entityFade);
					};
					obstaclesRef.current.forEach((obs) => scaleDown(obs.mesh));
					motesRef.current.forEach((mote) => scaleDown(mote.mesh));
					corkscrewGroupsRef.current.forEach((g) => g.obstacles.forEach((obs) => scaleDown(obs.mesh)));
					rollingSpheresRef.current.forEach((s) => scaleDown(s.mesh));
					quarkPairsRef.current.forEach((p) => { scaleDown(p.meshA); scaleDown(p.meshB); });
					shatterFragmentsRef.current.forEach((f) => { scaleDown(f.meshA); scaleDown(f.meshB); });
				}

				// Ship flies forward into the tunnel and shrinks into the distance
				if (spaceshipRef.current) {
					const ship = spaceshipRef.current;
					// Accelerate forward (negative z) — use deltaTime (computed before lastTime update)
					const flySpeed = progress * progress * 30; // accelerating
					ship.position.z -= flySpeed * deltaTime;
					// Drift toward visual vanishing point (camera is at y=1.5, so aim between)
					const centerRate = 1 - Math.pow(0.03, deltaTime); // frame-rate independent
					ship.position.x += (0 - ship.position.x) * centerRate;
					ship.position.y += (0.5 - ship.position.y) * centerRate;
					// Shrink as it recedes
					const shipScale = Math.max(0, 1 - progress * 1.2);
					ship.scale.setScalar(shipScale);
				}

				// Fade audio gently
				if (playlistManagerRef.current) {
					const pm = playlistManagerRef.current as unknown as { audio: HTMLAudioElement };
					if (pm.audio) pm.audio.volume = Math.max(0, (1 - progress) * 0.3);
				}

				scene.background = new THREE.Color(0x000000);
			}

			ambientLight.intensity = ambientIntensity;
			directionalLight.intensity = directionalIntensity;
			rimLight.intensity = rimIntensity;

			// Red backlight — fades in above 30% rage, max intensity 0.8
			const ragePercent = (gameStateRef.current.rageLevel ?? 0) / 100;
			const rageLightStrength = ragePercent > 0.3 ? ((ragePercent - 0.3) / 0.7) * 0.8 : 0;
			rageLight.intensity = rageLightStrength;

			// Fog banks — physical disc clouds that scroll through the tunnel
			const fogSpeed = speedRef.current || 3;

			// Spawn opening fog bank and periodic ones
			fogSpawnTimerRef.current -= deltaTime;
			if (fogSpawnTimerRef.current <= 0 && fogBanksRef.current.length === 0) {
				const isOpening = currentTime - (gameStateRef.current.timeStarted || 0) < 5000;
				const numDiscs = isOpening ? 140 : (150 + Math.floor(Math.random() * 50)); // in-tunnel: 150-200 discs × 0.4 = 60-80 units deep
				const peak = isOpening ? 0.18 : (0.08 + Math.random() * 0.05); // in-tunnel: 8-13% per disc
				const zSpawn = isOpening ? -2 : -50 - Math.random() * 30;
				const bank = createFogBank(zSpawn, numDiscs, peak);
				fogBanksRef.current.push(bank);
				fogSpawnTimerRef.current = 90 + Math.random() * 180; // next in 90-270s
			}

			// Update fog disc positions
			fogBanksRef.current = fogBanksRef.current.filter((bank) => {
				let allPassed = true;
				for (const disc of bank.discs) {
					disc.position.z += fogSpeed * deltaTime;
					if (disc.position.z < 10) allPassed = false;
				}
				if (allPassed) {
					// Remove all discs from scene
					for (const disc of bank.discs) {
						sceneRef.current?.remove(disc);
						(disc.material as THREE.Material).dispose();
					}
					return false;
				}
				return true;
			});

			// Camera shake — offset camera, render, then restore
			const shake = cameraShakeRef.current;
			if (shake > 0.001) {
				camera.position.x += (Math.random() - 0.5) * shake;
				camera.position.y += (Math.random() - 0.5) * shake;
				renderer.render(scene, camera);
				camera.position.x = 0;
				camera.position.y = 0;
				cameraShakeRef.current *= 0.88; // decay
			} else {
				renderer.render(scene, camera);
			}

			animationFrameRef.current = requestAnimationFrame(gameLoop);
		};
		gameLoop();

		// Cleanup
		return () => {
			window.removeEventListener("resize", handleResize);
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("keyup", handleKeyUp);
			if (animationFrameRef.current) {
				cancelAnimationFrame(animationFrameRef.current);
			}
			if (canvasRef.current && renderer.domElement) {
				canvasRef.current.removeChild(renderer.domElement);
			}
			renderer.dispose();

		};
	}, [gameState.showAgeInput, showStoryModal]);

	const createOrigamiSpaceship = (): THREE.Group => {
		const group = new THREE.Group();

		// Main body - pyramid shape
		const bodyGeometry = new THREE.ConeGeometry(0.3, 1, 4);
		const bodyMaterial = new THREE.MeshStandardMaterial({
			color: 0xe8dcc8,
			flatShading: true,
			roughness: 0.8,
		});
		const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
		body.rotation.x = Math.PI / 2;
		group.add(body);

		// Wings
		const wingGeometry = new THREE.BufferGeometry();
		const wingVertices = new Float32Array([
			0, 0, 0,
			-0.5, 0, -0.3,
			0, 0, -0.5,
		]);
		wingGeometry.setAttribute("position", new THREE.BufferAttribute(wingVertices, 3));
		wingGeometry.computeVertexNormals();

		const wingMaterial = new THREE.MeshStandardMaterial({
			color: 0xc9b896,
			flatShading: true,
			side: THREE.DoubleSide,
			roughness: 0.8,
		});

		const leftWing = new THREE.Mesh(wingGeometry, wingMaterial);
		group.add(leftWing);

		const rightWing = new THREE.Mesh(wingGeometry, wingMaterial);
		rightWing.scale.x = -1;
		group.add(rightWing);

		// Add edge highlights for origami fold effect
		const edgesMaterial = new THREE.LineBasicMaterial({ color: 0x8b7355 });
		const bodyEdges = new THREE.EdgesGeometry(bodyGeometry);
		const bodyLines = new THREE.LineSegments(bodyEdges, edgesMaterial);
		bodyLines.rotation.x = Math.PI / 2;
		group.add(bodyLines);

		return group;
	};

	const createTunnelSegment = (index: number): THREE.Mesh => {
		const radiusTop = getTunnelRadius(index);
		const radiusBottom = getTunnelRadius(index + 1);
		const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, 5, 8, 1, true);

		// Alternate between brown and black segments
		const isBlackSegment = index % 2 === 0;
		const color = isBlackSegment
			? new THREE.Color().setHSL(0, 0, 0.08 + Math.random() * 0.04) // Very dark, almost black
			: new THREE.Color().setHSL(0.08 + Math.random() * 0.02, 0.3, 0.4 + Math.random() * 0.1); // Brown

		const material = new THREE.MeshStandardMaterial({
			color,
			side: THREE.BackSide,
			flatShading: true,
			roughness: 0.9,
		});

		const segment = new THREE.Mesh(geometry, material);
		segment.position.z = -index * 5;
		segment.rotation.x = Math.PI / 2;

		// Add some rotation variation for curves
		segment.rotation.z = Math.sin(index * 0.5) * 0.1;

		return segment;
	};

	const getTunnelRadius = (_segmentIndex: number): number => {
		const baseRadius = 5;
		// Slow organic fluctuation between 90%-110% radius
		const t = Date.now() / 1000;
		const wave = 0.5 + 0.5 * Math.sin(t * 0.04) * Math.sin(t * 0.017 + 0.7);
		return baseRadius * (0.9 + wave * 0.2);
	};

	const createObstacle = (zPosition: number): Obstacle => {
		let mesh: THREE.Mesh;

		// Use GLB model if loaded, otherwise fallback to box geometry
		if (glbModelRef.current) {
			// Clone the GLB model
			const modelClone = glbModelRef.current.clone();

			// Scale down the model to appropriate size
			modelClone.scale.set(0.3, 0.3, 0.3);

			// Create a group to wrap the model for consistent handling
			const group = new THREE.Group();
			group.add(modelClone);

			// Position randomly within tunnel
			const angle = Math.random() * Math.PI * 2;
			const radius = getTunnelRadius(Math.floor(-zPosition / 5)) * 0.6;
			const x = Math.cos(angle) * radius;
			const y = Math.sin(angle) * radius;
			group.position.set(x, y, zPosition);

			// Random initial rotation for variety
			group.rotation.set(
				Math.random() * Math.PI,
				Math.random() * Math.PI,
				Math.random() * Math.PI
			);

			sceneRef.current?.add(group);

			const basePosition = new THREE.Vector3(x, y, zPosition);
			const beh = behaviorSystemRef.current.register("cloudBeing", basePosition);
			return {
				mesh: group as unknown as THREE.Mesh,
				zPosition,
				basePosition: basePosition.clone(),
				targetPosition: basePosition.clone(),
				velocity: new THREE.Vector3(0, 0, 0),
				birthTime: Date.now(),
				angerLevel: 0,
				lastCollisionTime: 0,
				angerTime: 0,
				behavior: beh,
			};
		} else {
			// Fallback: Much smaller cubes for larger scene feel
			const geometry = new THREE.BoxGeometry(0.25, 0.25, 0.25);
			const material = new THREE.MeshStandardMaterial({
				color: 0x8b6f47,
				flatShading: true,
				roughness: 0.9,
				transparent: true,
				opacity: 0.85, // Slightly transparent for cloud-like appearance
			});
			mesh = new THREE.Mesh(geometry, material);

			// Position randomly within tunnel
			const angle = Math.random() * Math.PI * 2;
			const radius = getTunnelRadius(Math.floor(-zPosition / 5)) * 0.6;
			const x = Math.cos(angle) * radius;
			const y = Math.sin(angle) * radius;
			mesh.position.set(x, y, zPosition);

			// Random initial rotation for variety
			mesh.rotation.set(
				Math.random() * Math.PI,
				Math.random() * Math.PI,
				Math.random() * Math.PI
			);

			// Add edges for cardboard look
			const edges = new THREE.EdgesGeometry(geometry);
			const edgeLines = new THREE.LineSegments(
				edges,
				new THREE.LineBasicMaterial({ color: 0x5a4a35 })
			);
			mesh.add(edgeLines);

			sceneRef.current?.add(mesh);

			const basePosition = new THREE.Vector3(x, y, zPosition);
			const beh = behaviorSystemRef.current.register("cloudBeing", basePosition);
			return {
				mesh,
				zPosition,
				basePosition: basePosition.clone(),
				targetPosition: basePosition.clone(),
				velocity: new THREE.Vector3(0, 0, 0),
				birthTime: Date.now(),
				angerLevel: 0,
				lastCollisionTime: 0,
				angerTime: 0,
				behavior: beh,
			};
		}
	};

	const createMote = (zPosition: number): Mote => {
		// Small light particles
		const geometry = new THREE.SphereGeometry(0.04, 8, 8);
		const material = new THREE.MeshStandardMaterial({
			color: 0xfff8e8, // Light cream/beige
			emissive: 0xffeab3, // Warm glow
			emissiveIntensity: 0.5,
			transparent: true,
			opacity: 0.7,
			roughness: 0.5,
		});
		const mesh = new THREE.Mesh(geometry, material);

		// Position randomly within tunnel
		const angle = Math.random() * Math.PI * 2;
		const radius = getTunnelRadius(Math.floor(-zPosition / 5)) * (0.3 + Math.random() * 0.6);
		const x = Math.cos(angle) * radius;
		const y = Math.sin(angle) * radius;
		mesh.position.set(x, y, zPosition);

		sceneRef.current?.add(mesh);

		const pos = new THREE.Vector3(x, y, zPosition);
		const beh = behaviorSystemRef.current.register("mote", pos);
		return {
			mesh,
			zPosition,
			velocity: new THREE.Vector3(
				(Math.random() - 0.5) * 0.2,
				(Math.random() - 0.5) * 0.2,
				0
			),
			baseIntensity: 0.3 + Math.random() * 0.4,
			wobblePhase: Math.random() * Math.PI * 2,
			behavior: beh,
		};
	};

	const createRollingSphere = (zPosition: number): RollingSphere => {
		let mesh: THREE.Mesh;

		// Random starting angle around the tunnel
		const angle = Math.random() * Math.PI * 2;

		// Position on the inner surface of the tunnel
		const tunnelRadius = getTunnelRadius(Math.floor(-zPosition / 5));
		const radius = tunnelRadius * 0.95; // 95% of tunnel radius to sit on surface

		// Calculate position
		const x = Math.cos(angle) * radius;
		const y = Math.sin(angle) * radius;

		// Random size: 0.5x to 3x base scale
		const sizeMultiplier = 0.5 + Math.random() * 2.5;

		// Use orb GLB model if loaded, otherwise fallback to sphere geometry
		if (orbModelRef.current) {
			// Clone the orb model
			const modelClone = orbModelRef.current.clone();

			// Scale the model appropriately
			const s = 0.4 * sizeMultiplier;
			modelClone.scale.set(s, s, s);

			// Create a group to wrap the model
			const group = new THREE.Group();
			group.add(modelClone);

			// Position the orb
			group.position.set(x, y, zPosition);

			// Random initial rotation for variety
			group.rotation.set(
				Math.random() * Math.PI,
				Math.random() * Math.PI,
				Math.random() * Math.PI
			);

			sceneRef.current?.add(group);

			// Create rotation axis perpendicular to the direction of travel
			const rotationAxis = new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0).normalize();

			return {
				mesh: group as unknown as THREE.Mesh,
				zPosition,
				angle,
				radius,
				size: sizeMultiplier,
				birthTime: Date.now(),
				angularVelocity: (1.5 + Math.random() * 1.5) / 4, // 0.375-0.75 radians per second (1/4 speed)
				forwardVelocity: 0, // Will be set based on game speed
				rotationAxis,
				rotationSpeed: (3 + Math.random() * 2) / 4, // Visual rolling speed (1/4 speed)
			};
		} else {
			// Fallback: basic sphere geometry
			const geometry = new THREE.SphereGeometry(0.4 * sizeMultiplier, 32, 32);
			const material = new THREE.MeshStandardMaterial({
				color: 0x4a90e2, // Blue color to distinguish from other obstacles
				emissive: 0x2a5080,
				emissiveIntensity: 0.4,
				flatShading: false, // Smooth for spherical look
				roughness: 0.6,
				metalness: 0.3,
			});
			mesh = new THREE.Mesh(geometry, material);

			mesh.position.set(x, y, zPosition);

			// Add edges for better visibility
			const edges = new THREE.EdgesGeometry(geometry);
			const edgeLines = new THREE.LineSegments(
				edges,
				new THREE.LineBasicMaterial({ color: 0x6bb6ff, linewidth: 2 })
			);
			mesh.add(edgeLines);

			sceneRef.current?.add(mesh);

			// Create rotation axis perpendicular to the direction of travel
			const rotationAxis = new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0).normalize();

			return {
				mesh,
				zPosition,
				angle,
				radius,
				size: sizeMultiplier,
				birthTime: Date.now(),
				angularVelocity: 1.5 + Math.random() * 1.5, // 1.5-3.0 radians per second
				forwardVelocity: 0, // Will be set based on game speed
				rotationAxis,
				rotationSpeed: 3 + Math.random() * 2, // Visual rolling speed
			};
		}
	};

	const createQuarkPair = (zPosition: number, scale: number = 1.0): QuarkPair => {
		const createShardMesh = (s: number): THREE.Mesh => {
			if (shardModelRef.current) {
				const modelClone = shardModelRef.current.clone();
				const ms = 1.2 * s;
				modelClone.scale.set(ms, ms, ms);
				modelClone.traverse((child) => {
					if ((child as THREE.Mesh).isMesh) {
						const m = child as THREE.Mesh;
						const original = m.material as THREE.MeshStandardMaterial;
						if (original.emissive) {
							const clonedMat = original.clone();
							clonedMat.emissiveIntensity = 0.3;
							m.material = clonedMat;
						}
					}
				});
				const group = new THREE.Group();
				group.add(modelClone);
				group.position.set(0, 0, zPosition);
				sceneRef.current?.add(group);
				return group as unknown as THREE.Mesh;
			}
			// Fallback: thin glowing cylinder
			const geometry = new THREE.CylinderGeometry(0.08 * s, 0.08 * s, 0.8 * s, 6);
			const emissiveBoost = s < 0.5 ? 0.8 : 0.4; // small ones glow brighter
			const material = new THREE.MeshStandardMaterial({
				color: 0x998877,
				emissive: 0x554433,
				emissiveIntensity: emissiveBoost,
			});
			const mesh = new THREE.Mesh(geometry, material);
			mesh.position.set(0, 0, zPosition);
			sceneRef.current?.add(mesh);
			return mesh;
		};

		const meshA = createShardMesh(scale);
		const meshB = createShardMesh(scale);

		// Place pair somewhere in the tunnel cross-section
		const tunnelR = getTunnelRadius(Math.floor(-zPosition / 5));
		const angle = Math.random() * Math.PI * 2;
		const r = (0.2 + Math.random() * 0.5) * tunnelR;
		const centerX = Math.cos(angle) * r;
		const centerY = Math.sin(angle) * r;

		const posA = new THREE.Vector3(centerX, centerY, zPosition);
		const posB = new THREE.Vector3(centerX, centerY, zPosition);
		const pairId = `quark-${Date.now()}-${Math.random()}`;
		const behaviorA = behaviorSystemRef.current.register("quarkShard", posA, pairId);
		const behaviorB = behaviorSystemRef.current.register("quarkShard", posB, pairId);

		const baseRadius = (0.3 + Math.random() * 0.2) * scale; // scales with size
		const orbitSpeed = scale < 0.5 ? 4.0 + Math.random() * 2.0 : 2.5 + Math.random() * 1.5; // small ones spin faster

		return {
			meshA,
			meshB,
			zPosition,
			birthTime: Date.now(),
			orbitAngle: Math.random() * Math.PI * 2,
			orbitRadius: baseRadius,
			baseOrbitRadius: baseRadius,
			orbitSpeed,
			centerX,
			centerY,
			driftPhase: "orbit",
			driftStartTime: 0,
			nextDriftTime: Date.now() + 2000 + Math.random() * 4000,
			maxDriftRadius: baseRadius * 3 + Math.random() * baseRadius * 2,
			behaviorA,
			behaviorB,
		};
	};

	const createCorkscrewGroup = (startZ: number): CorkscrewGroup => {
		const groupId = `corkscrew-${Date.now()}-${Math.random()}`;
		const obstacles: CorkscrewObstacle[] = [];
		const birthTime = Date.now();
		const numObstacles = 6 + Math.floor(Math.random() * 13); // 6-18
		const corkscrewRadius = getTunnelRadius(Math.floor(-startZ / 5)) * 0.5;
		const zSpacing = 1.5 + Math.random() * 3.5; // 1.5-5.0 units apart
		const rotSpeed = 0.5 + Math.random() * 2.0; // 0.5-2.5 rad/s

		// Create flyby audio for this group
		const flybyAudio = new Audio(flybyAudioFile);
		flybyAudio.preload = "auto";
		flybyAudio.volume = sfxLevelsRef.current.flyby;
		flybyAudio.loop = false;

		for (let i = 0; i < numObstacles; i++) {
			let mesh: THREE.Mesh;

			// Use torus GLB model if loaded, otherwise fallback to octahedron
			if (torusModelRef.current) {
				// Clone the torus model
				const modelClone = torusModelRef.current.clone();

				// Scale the model appropriately (reduced by 30% from 0.4 to 0.28)
				modelClone.scale.set(0.28, 0.28, 0.28);

				// Create a group to wrap the model
				const group = new THREE.Group();
				group.add(modelClone);

				// Initial position - evenly distributed around the circle
				const angleOffset = (i / numObstacles) * Math.PI * 2;
				const zOffset = startZ - (i * zSpacing);

				group.position.set(0, 0, zOffset);

				// Random initial rotation for variety
				group.rotation.set(
					Math.random() * Math.PI,
					Math.random() * Math.PI,
					Math.random() * Math.PI
				);

				sceneRef.current?.add(group);

				const beh = behaviorSystemRef.current.register("corkscrew", group.position, groupId);
				obstacles.push({
					mesh: group as unknown as THREE.Mesh,
					groupId,
					angleOffset,
					zPosition: zOffset,
					radius: corkscrewRadius,
					birthTime,
				});
				// Keep behavior ref on the obstacle for cleanup
				(group as unknown as { _behavior: BehaviorState })._behavior = beh;
			} else {
				// Fallback: octahedron geometry (reduced by 30% from 0.35 to 0.245)
				const geometry = new THREE.OctahedronGeometry(0.245, 0);
				const material = new THREE.MeshStandardMaterial({
					color: 0xff6b35, // Distinctive orange/red color
					emissive: 0xff4500,
					emissiveIntensity: 0.3,
					flatShading: true,
					roughness: 0.7,
					transparent: true,
					opacity: 0.9,
				});
				mesh = new THREE.Mesh(geometry, material);

				// Add edges for visibility
				const edges = new THREE.EdgesGeometry(geometry);
				const edgeLines = new THREE.LineSegments(
					edges,
					new THREE.LineBasicMaterial({ color: 0xff0000 })
				);
				mesh.add(edgeLines);

				// Initial position - evenly distributed around the circle
				const angleOffset = (i / numObstacles) * Math.PI * 2;
				const zOffset = startZ - (i * zSpacing);

				mesh.position.set(0, 0, zOffset);
				sceneRef.current?.add(mesh);

				const beh = behaviorSystemRef.current.register("corkscrew", mesh.position, groupId);
				obstacles.push({
					mesh,
					groupId,
					angleOffset,
					zPosition: zOffset,
					radius: corkscrewRadius,
					birthTime,
				});
				(mesh as unknown as { _behavior: BehaviorState })._behavior = beh;
			}
		}

		return {
			id: groupId,
			obstacles,
			startZ,
			birthTime,
			isExploding: false,
			flybyAudio,
			flybyPlayCount: 0,
			lastFlybyEndTime: 0,
			rotationSpeed: rotSpeed,
		};
	};

	const lastFlareTimeRef = useRef(0);
	const fireProjectile = () => {
		if (!spaceshipRef.current || !sceneRef.current) return;
		const now = Date.now();
		if (now - gameStateRef.current.timeStarted < 10000) return; // no flares for first 10s
		if (now - lastFlareTimeRef.current < pilotRef.current.flareCooldown * 1000) return;
		lastFlareTimeRef.current = now;

		// Create flare - starts dark, will ignite after traveling
		const geometry = new THREE.SphereGeometry(0.15, 16, 16);
		const material = new THREE.MeshStandardMaterial({
			color: 0x4a4a4a, // Dark gray - unlit
			emissive: 0x000000, // No glow initially
			emissiveIntensity: 0,
			flatShading: true,
		});
		const mesh = new THREE.Mesh(geometry, material);

		mesh.position.copy(spaceshipRef.current.position);
		mesh.position.z -= 0.5;

		sceneRef.current.add(mesh);

		// Create point light (invisible initially) that will illuminate when flare ignites
		const light = new THREE.PointLight(0xffcc66, 0, 50); // Start with 0 intensity, 50 unit range
		light.position.copy(mesh.position);
		light.castShadow = false; // Performance optimization
		sceneRef.current.add(light);

		// Flare travels 15-25 units before igniting
		const ignitionDistance = 15 + Math.random() * 10;

		projectilesRef.current.push({
			mesh,
			velocity: new THREE.Vector3(0, 0, -30),
			light,
			distanceTraveled: 0,
			ignitionDistance,
			hasIgnited: false,
			ignitionTime: 0,
		});
	};

	const updateGame = (deltaTime: number) => {
		if (!spaceshipRef.current || !cameraRef.current || !sceneRef.current) return;

		const state = gameStateRef.current;
		const pilot = pilotRef.current;
		// Progressive speed: starts at 4, increases to max 40% (1.4x)
		const baseSpeed = 4;
		const maxMultiplier = 1.4; // 40% increase maximum
		const levelMultiplier = Math.min(maxMultiplier, 1 + (state.level - 1) * 0.04);
		// Tempo sync: speed follows audio energy — ambient ~0.5x, energetic ~1.5x
		const tempoFactor = pilot.tempoSync
			? 0.4 + audioAmplitudeRef.current * 2.2 // ambient (~0.3 amp) → 1.06x, energetic (~0.6 amp) → 1.72x
			: 1.0;
		const speed = baseSpeed * levelMultiplier * pilot.speedMultiplier * tempoFactor;
		speedRef.current = speed;

		// Fade damage flash
		if (state.damageFlash > 0) {
			setGameState((prev) => ({
				...prev,
				damageFlash: Math.max(0, prev.damageFlash - deltaTime * 3),
			}));
		}

		// Update spaceship position based on arrow keys (disabled during death)
		const moveSpeed = 8 * deltaTime;
		const tunnelRadius = getTunnelRadius(0) * 0.85;

		if (state.deathSequence) {
			// Ship movement handled in render loop (flies into fog)
		} else {
			// Manual input — always works, even with autopilot on
			const hasManualInput = keysRef.current.ArrowLeft || keysRef.current.ArrowRight
				|| keysRef.current.ArrowUp || keysRef.current.ArrowDown;

			if (hasManualInput) {
				manualOverrideRef.current = Date.now();
				if (keysRef.current.ArrowLeft) spaceshipRef.current.position.x -= moveSpeed;
				if (keysRef.current.ArrowRight) spaceshipRef.current.position.x += moveSpeed;
				if (keysRef.current.ArrowUp) spaceshipRef.current.position.y += moveSpeed;
				if (keysRef.current.ArrowDown) spaceshipRef.current.position.y -= moveSpeed;
			}

			// Autopilot — runs when enabled, fades out during manual override
			if (pilot.autopilot) {
				const timeSinceManual = Date.now() - manualOverrideRef.current;
				const autopilotStrength = Math.min(1, timeSinceManual / 1000); // fade in over 1s after keys released
				const pilotStyle = pilot.pilotStyle ?? "cautious";
				const isInvestigating = pilotStyle === "bold" || pilotStyle === "aggressive";

				if (autopilotStrength > 0.01) {
					const shipPos = spaceshipRef.current.position;
					const ap = autopilotVelRef.current;
					const now = Date.now();

					// Bold/Aggressive: manage investigation target
					let activeInvestigation = false;
					if (isInvestigating) {
						const bt = boldTargetRef.current;
						if (!bt || now > bt.nextPickTime) {
							const candidates: { x: number; y: number; z: number }[] = [];
							obstaclesRef.current.forEach((o) => {
								const z = o.mesh.position.z;
								if (z < -5 && z > -30) candidates.push({ x: o.mesh.position.x, y: o.mesh.position.y, z });
							});
							rollingSpheresRef.current.forEach((s) => {
								const z = s.mesh.position.z;
								if (z < -5 && z > -30) candidates.push({ x: s.mesh.position.x, y: s.mesh.position.y, z });
							});
							quarkPairsRef.current.forEach((p) => {
								if (p.zPosition < -5 && p.zPosition > -30) candidates.push({ x: p.centerX, y: p.centerY, z: p.zPosition });
							});
							if (candidates.length > 0) {
								const pick = candidates[Math.floor(Math.random() * candidates.length)];
								boldTargetRef.current = { x: pick.x, y: pick.y, z: pick.z, nextPickTime: now + 12000 + Math.random() * 6000, peelOff: false, peelStart: 0 };
							} else {
								boldTargetRef.current = null;
							}
						}
						if (boldTargetRef.current && !boldTargetRef.current.peelOff) {
							activeInvestigation = true;
						}
					} else {
						boldTargetRef.current = null;
					}

					// Threat detection — aggressive reduces dodge zone during investigation
					const dangerZone = (pilotStyle === "aggressive" && activeInvestigation) ? 4 : 8;
					const dangerXY = (pilotStyle === "aggressive" && activeInvestigation) ? 1.0 : 2.0;

					let nearestDist = Infinity;
					let threatX = 0;
					let threatY = 0;

					const checkThreat = (tx: number, ty: number, tz: number) => {
						if (tz > 0 || tz < -dangerZone) return;
						const lateralDx = tx - shipPos.x;
						const lateralDy = ty - shipPos.y;
						const lateralDist = Math.sqrt(lateralDx * lateralDx + lateralDy * lateralDy);
						if (lateralDist > dangerXY) return;
						const dist = Math.sqrt(lateralDx * lateralDx + lateralDy * lateralDy + tz * tz);
						if (dist < nearestDist) {
							nearestDist = dist;
							threatX = tx;
							threatY = ty;
						}
					};

					obstaclesRef.current.forEach((obs) => checkThreat(obs.mesh.position.x, obs.mesh.position.y, obs.mesh.position.z));
					rollingSpheresRef.current.forEach((s) => checkThreat(s.mesh.position.x, s.mesh.position.y, s.mesh.position.z));
					corkscrewGroupsRef.current.forEach((g) => g.obstacles.forEach((obs) => checkThreat(obs.mesh.position.x, obs.mesh.position.y, obs.mesh.position.z)));
					quarkPairsRef.current.forEach((p) => checkThreat(p.centerX, p.centerY, p.zPosition));

					let desiredX = 0;
					let desiredY = 0;

					if (nearestDist < Infinity) {
						const dx = shipPos.x - threatX;
						const dy = shipPos.y - threatY;
						const lateralDist = Math.sqrt(dx * dx + dy * dy);
						if (lateralDist > 0.01) {
							const urgency = Math.max(0, 1 - nearestDist / dangerZone);
							desiredX = (dx / lateralDist) * urgency * 5;
							desiredY = (dy / lateralDist) * urgency * 5;
						} else {
							const angle = Math.random() * Math.PI * 2;
							desiredX = Math.cos(angle) * 3;
							desiredY = Math.sin(angle) * 3;
						}
					}

					// Bold/Aggressive investigation: approach target, peel off when close
					if (isInvestigating && boldTargetRef.current) {
						const target = boldTargetRef.current;
						if (!target.peelOff) {
							const toX = target.x - shipPos.x;
							const toY = target.y - shipPos.y;
							const toDist = Math.sqrt(toX * toX + toY * toY);

							if (toDist > 0.5) {
								// Approach the entity
								desiredX += (toX / toDist) * 4;
								desiredY += (toY / toDist) * 4;
							} else {
								// Peel off — bank away with a tilt
								target.peelOff = true;
								target.peelStart = now;
								target.nextPickTime = now + 3000 + Math.random() * 4000;
								const peelDir = toX > 0 ? -1 : 1;
								knockbackRef.current.spin = peelDir * 2.5;
							}
						} else {
							// Peeling off — swing away for 1.5s
							const peelElapsed = (now - target.peelStart) / 1000;
							if (peelElapsed < 1.5) {
								const awayX = shipPos.x - target.x;
								const awayY = shipPos.y - target.y;
								const awayDist = Math.sqrt(awayX * awayX + awayY * awayY) || 1;
								const peelForce = 4 * (1 - peelElapsed / 1.5);
								desiredX += (awayX / awayDist) * peelForce;
								desiredY += (awayY / awayDist) * peelForce;
							}
						}
					}

					// Center pull
					const centerStrength = nearestDist === Infinity ? 0.8 : 0.3;
					desiredX -= shipPos.x * centerStrength;
					desiredY -= shipPos.y * centerStrength;

					const blend = 2.0 * deltaTime;
					ap.x += (desiredX - ap.x) * blend;
					ap.y += (desiredY - ap.y) * blend;

					spaceshipRef.current.position.x += ap.x * deltaTime * autopilotStrength;
					spaceshipRef.current.position.y += ap.y * deltaTime * autopilotStrength;

					// Auto-flare: fire occasionally when calm, dark, and flying straight
					const isCalm = nearestDist > 6; // no nearby threats
					const isStraight = Math.abs(knockbackRef.current.spin) < 0.3; // not banking
					const shipDist = Math.sqrt(spaceshipRef.current.position.x ** 2 + spaceshipRef.current.position.y ** 2);
					const isCentered = shipDist < 1.5; // near tunnel center
					const speed2d = Math.sqrt(ap.x * ap.x + ap.y * ap.y);
					const isCoasting = speed2d < 1.5; // not dodging hard
					const flareGap = now - lastFlareTimeRef.current > 15000; // at least 15s since last
					if (isCalm && isStraight && isCentered && flareGap) {
						// 15% chance per second when conditions met
						if (Math.random() < 0.15 * deltaTime) {
							fireProjectile();
						}
					}
				}
			} else if (!hasManualInput) {
				// No autopilot, no manual input — nothing to do
			}
		}

		// Apply knockback velocity (from sphere collisions)
		const kb = knockbackRef.current;
		if (Math.abs(kb.vx) > 0.01 || Math.abs(kb.vy) > 0.01) {
			spaceshipRef.current.position.x += kb.vx * deltaTime;
			spaceshipRef.current.position.y += kb.vy * deltaTime;
			// Decay knockback
			kb.vx *= 0.95;
			kb.vy *= 0.95;
		}

		// Hard clamp — never let ship outside tunnel wall regardless of knockback or bounce
		const clampDist = Math.sqrt(spaceshipRef.current.position.x ** 2 + spaceshipRef.current.position.y ** 2);
		const maxDist = tunnelRadius - 0.1;
		if (clampDist > maxDist) {
			const clampAngle = Math.atan2(spaceshipRef.current.position.y, spaceshipRef.current.position.x);
			spaceshipRef.current.position.x = Math.cos(clampAngle) * maxDist;
			spaceshipRef.current.position.y = Math.sin(clampAngle) * maxDist;
		}
		if (Math.abs(kb.spin) > 0.01) {
			spaceshipRef.current.rotation.z += kb.spin * deltaTime;
			kb.spin *= 0.96;
		} else if (Math.abs(spaceshipRef.current.rotation.z) > 0.01) {
			// Gradually return to upright
			spaceshipRef.current.rotation.z *= 0.92;
		}

		// Wall bounce — sustained inward push, no teleporting
		if (wallBounceRef.current > 0) {
			// Currently bouncing — push ship toward center
			const bx = spaceshipRef.current.position.x;
			const by = spaceshipRef.current.position.y;
			const bDist = Math.sqrt(bx * bx + by * by);
			if (bDist > 0.1) {
				const pushStrength = 8 * (wallBounceRef.current / 0.6); // stronger at start, eases off
				spaceshipRef.current.position.x -= (bx / bDist) * pushStrength * deltaTime;
				spaceshipRef.current.position.y -= (by / bDist) * pushStrength * deltaTime;
			}
			wallBounceRef.current = Math.max(0, wallBounceRef.current - deltaTime);
		} else {
			// Check for wall collision
			const distFromCenter = Math.sqrt(
				spaceshipRef.current.position.x ** 2 + spaceshipRef.current.position.y ** 2
			);
			if (distFromCenter > tunnelRadius) {
				const angle = Math.atan2(spaceshipRef.current.position.y, spaceshipRef.current.position.x);
				// Clamp to just inside the wall (no teleport — just prevent clipping)
				spaceshipRef.current.position.x = Math.cos(angle) * (tunnelRadius - 0.05);
				spaceshipRef.current.position.y = Math.sin(angle) * (tunnelRadius - 0.05);
				// Start bounce — 0.6 seconds of sustained inward push
				wallBounceRef.current = 0.6;
				// Tilt away from the wall
				spaceshipRef.current.rotation.z += (-angle > 0 ? 1 : -1) * 0.25;
				knockbackRef.current.spin = (-angle > 0 ? 1 : -1) * 1.5;
			}
		}

		// Update tunnel segments — move them all forward, recycle any that pass the camera
		const segments = tunnelSegmentsRef.current;
		for (let i = 0; i < segments.length; i++) {
			segments[i].position.z += speed * deltaTime;
		}

		for (let i = 0; i < segments.length; i++) {
			if (segments[i].position.z > 10) {
				// Find the segment that is furthest away (smallest z)
				let minZ = Infinity;
				for (let j = 0; j < segments.length; j++) {
					if (segments[j].position.z < minZ) {
						minZ = segments[j].position.z;
					}
				}
				const newZ = minZ - 5;
				const newIndex = Math.round(-newZ / 5);

				disposeMesh(segments[i]);
				sceneRef.current?.remove(segments[i]);
				const newSegment = createTunnelSegment(newIndex);
				newSegment.position.z = newZ;
				sceneRef.current?.add(newSegment);
				segments[i] = newSegment;
			}
		}

		// Read real audio energy from analyser (falls back to sine if no analyser)
		const pm = playlistManagerRef.current;
		const bassRaw = pm ? pm.getBassEnergy() : 0;
		const midRaw = pm ? pm.getMidEnergy() : 0;
		const trebleRaw = pm ? pm.getTrebleEnergy() : 0;
		// Light smoothing for responsive display & entity effects
		bassEnergyRef.current += (bassRaw - bassEnergyRef.current) * 0.3;
		midEnergyRef.current += (midRaw - midEnergyRef.current) * 0.35;
		trebleEnergyRef.current += (trebleRaw - trebleEnergyRef.current) * 0.4;
		audioAmplitudeRef.current = midRaw > 0.01
			? 0.3 + midRaw * 0.4
			: 0.3 + 0.2 * Math.sin(Date.now() / 500); // fallback sine when no audio

		const reactivity = pilot.musicReactivity ?? 1.0;


		const currentTime = Date.now();

		// Run the behavior system — drives all entity movement
		const behaviorCtx: BehaviorContext = {
			rageLevel: state.rageLevel,
			rageNormalized: state.rageLevel / 100,
			playerPosition: spaceshipRef.current!.position,
			tunnelRadius: getTunnelRadius(0),
			gameSpeed: speed,
			deltaTime,
			currentTime,
			activeFlarePositions: projectilesRef.current
				.filter((p) => p.hasIgnited)
				.map((p) => p.mesh.position),
			quarkShardPositions: (() => {
				const pool = quarkPosPoolRef.current;
				const pairs = quarkPairsRef.current;
				// Grow pool if needed, reuse existing vectors
				while (pool.length < pairs.length) pool.push(new THREE.Vector3());
				for (let i = 0; i < pairs.length; i++) {
					pool[i].set(pairs[i].centerX, pairs[i].centerY, pairs[i].zPosition);
				}
				return pool.slice(0, pairs.length);
			})(),
			trebleEnergy: trebleEnergyRef.current,
			globalMood: { avgAnger: 0, avgFear: 0, avgExcitement: 0 },
		};
		behaviorSystemRef.current.update(behaviorCtx);

		// When a murmuration just triggered, spawn extra motes in the recruitment zone
		// to double the cloud density
		if (didMurmurationJustTrigger()) {
			const extraCount = motesRef.current.filter(
				(m) => m.mesh.position.z < -35 && m.mesh.position.z > -65
			).length;
			for (let i = 0; i < extraCount; i++) {
				const z = -35 - Math.random() * 30;
				const mote = createMote(z);
				motesRef.current.push(mote);
			}
		}

		const currentTimeSurvived = (Date.now() - state.timeStarted) / 1000;
		const yearsLived = Math.floor(currentTimeSurvived / 60);

		// Spawn cloud beings — none before 20s, with brief periodic thinning
		const density = pilot.entityDensity;
		// Scale spawns by speed so tunnel density stays consistent at any velocity
		const speedScale = speed / baseSpeed;
		// Single slow wave: brief dip to 30% spawn rate every ~40s
		const spawnWave = Math.sin(currentTimeSurvived * 0.16);
		const spawnDensityMod = spawnWave < -0.7 ? 0.3 : 1.0;
		const spawnChance = currentTimeSurvived >= 20
			? Math.min(0.04, 0.015 + yearsLived * 0.002) * density * spawnDensityMod * speedScale
			: 0;

		if (Math.random() < spawnChance) {
			const obstacle = createObstacle(-50);
			obstaclesRef.current.push(obstacle);
		}

		// Spawn atmospheric motes - constant gentle flow
		if (Math.random() < 0.08 * density * speedScale) {
			const mote = createMote(-50);
			motesRef.current.push(mote);
		}

		// Spawn corkscrew groups - only after year 1, then once per year

		// Track last corkscrew spawn time
		if (!lastCorkscrewSpawnRef.current) {
			lastCorkscrewSpawnRef.current = 0;
		}

		// Only spawn if: (1) at least year 1, AND (2) no active corkscrews, AND (3) 1 year since last spawn
		const timeSinceLastCorkscrew = currentTimeSurvived - lastCorkscrewSpawnRef.current;
		// First spawn at year 1 (60 seconds), then every year (60 seconds) after
		const shouldSpawnCorkscrew = yearsLived >= 1
			&& corkscrewGroupsRef.current.length === 0
			&& timeSinceLastCorkscrew >= 60;

		// Check if any quark pair is within 20 units of the spawn zone
		const quarkNearSpawn = quarkPairsRef.current.some((p) => p.zPosition < -40);
		if (shouldSpawnCorkscrew && !quarkNearSpawn) {
			const group = createCorkscrewGroup(-60);
			corkscrewGroupsRef.current.push(group);
			lastCorkscrewSpawnRef.current = currentTimeSurvived;
		}

		// Spawn quark pairs — two encounter types:
		// 1. Cluster of 6 small pairs (scale 0.25) — more common
		// 2. Single large pair (scale 1.0), occasionally 2 — rarer
		// Don't spawn if a corkscrew is nearby
		const corkscrewNearSpawn = corkscrewGroupsRef.current.some((g) =>
			g.obstacles.some((o) => o.zPosition < -40)
		);
		const smallCount = quarkPairsRef.current.filter((p) => (p.meshA.scale?.x ?? 1) < 0.5 || p.baseOrbitRadius < 0.15).length;
		const largeCount = quarkPairsRef.current.length - smallCount;
		if (currentTimeSurvived >= 60 && !corkscrewNearSpawn && Math.random() < 0.003 * density * speedScale) {
			const isSmallCluster = Math.random() < 0.65; // 65% chance small cluster
			if (isSmallCluster && smallCount < 6) {
				// Spawn cluster of 6 small pairs near each other
				const baseZ = -55 - Math.random() * 10;
				const tunnelR = getTunnelRadius(Math.floor(-baseZ / 5));
				const clusterAngle = Math.random() * Math.PI * 2;
				const clusterR = (0.15 + Math.random() * 0.3) * tunnelR;
				for (let ci = 0; ci < 6; ci++) {
					const offsetAngle = clusterAngle + (ci / 6) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
					const offsetR = clusterR * (0.6 + Math.random() * 0.4);
					const pair = createQuarkPair(baseZ + (Math.random() - 0.5) * 3, 0.25);
					// Reposition to cluster location
					pair.centerX = Math.cos(offsetAngle) * offsetR;
					pair.centerY = Math.sin(offsetAngle) * offsetR;
					quarkPairsRef.current.push(pair);
				}
			} else if (!isSmallCluster && largeCount < 2) {
				const pair = createQuarkPair(-55 - Math.random() * 10, 1.0);
				quarkPairsRef.current.push(pair);
			}
		}

		// Spawn rolling spheres - frequency based on current year
		// Rolling spheres: none before 90s, then ramp up
		const activeRollingSpheres = rollingSpheresRef.current.length;
		let targetRollingSpheres = 0;

		if (currentTimeSurvived < 90) {
			targetRollingSpheres = 0;
		} else if (yearsLived <= 1) {
			targetRollingSpheres = 0;
		} else if (yearsLived === 2) {
			targetRollingSpheres = 1;
		} else if (yearsLived === 3) {
			targetRollingSpheres = 2;
		} else {
			targetRollingSpheres = 1 + Math.floor(Math.random() * 6);
		}

		// Spawn new rolling sphere if we're below target count
		// Only spawn occasionally to avoid overwhelming the screen
		if (activeRollingSpheres < targetRollingSpheres && Math.random() < 0.01) {
			const rollingSphere = createRollingSphere(-60);
			rollingSpheresRef.current.push(rollingSphere);
		}

		// Update rolling spheres
		rollingSpheresRef.current = rollingSpheresRef.current.filter((sphere) => {
			// Move forward through tunnel at game speed
			sphere.zPosition += speed * deltaTime;
			sphere.mesh.position.z = sphere.zPosition;

			// Remove if behind camera
			if (sphere.mesh.position.z > 5) {
				disposeMesh(sphere.mesh);
				sceneRef.current?.remove(sphere.mesh);
				return false;
			}

			// Update angle for spiral motion around the tunnel
			sphere.angle += sphere.angularVelocity * deltaTime;

			// Position sphere so its outer edge touches the tunnel wall
			// Use base radius 5 (ignore time fluctuation — tunnel geometry doesn't update in real-time)
			const sphereVisualRadius = 0.4 * sphere.size;
			const baseRadius = 5 - sphereVisualRadius * 0.85;

			// Bass bounce — gentle inward "bop" that follows the beat
			// Smooth energy drives a slow sine-like lift so spheres bob, not jerk
			const bass = bassEnergyRef.current;
			// Per-sphere phase offset so they don't all move in lockstep
			const bopPhase = Math.sin(sphere.birthTime * 0.0003 + bass * 2.5);
			const bassBounce = bass * 0.8 * reactivity * (0.7 + 0.3 * bopPhase);
			sphere.radius = baseRadius - bassBounce; // lift inward (toward center)

			// Calculate new position on tunnel surface
			const x = Math.cos(sphere.angle) * sphere.radius;
			const y = Math.sin(sphere.angle) * sphere.radius;
			sphere.mesh.position.x = x;
			sphere.mesh.position.y = y;

			// Apply rolling rotation
			// The sphere rotates around an axis perpendicular to its direction of travel
			sphere.rotationAxis.set(-Math.sin(sphere.angle), Math.cos(sphere.angle), 0).normalize();
			sphere.mesh.rotateOnAxis(sphere.rotationAxis, sphere.rotationSpeed * deltaTime);

			// Check collision with spaceship — scale collision radius with sphere size
			const dist = sphere.mesh.position.distanceTo(spaceshipRef.current!.position);
			const collisionRadius = 0.4 * sphere.size + 0.3;
			if (dist < collisionRadius) {
				// Play collision sound
				playCollisionSound();

				// Knock ship towards tunnel center with a spin
				const shipPos = spaceshipRef.current!.position;
				const toCenter = Math.sqrt(shipPos.x ** 2 + shipPos.y ** 2);
				if (toCenter > 0.1) {
					const knockStrength = 15;
					knockbackRef.current.vx = (-shipPos.x / toCenter) * knockStrength;
					knockbackRef.current.vy = (-shipPos.y / toCenter) * knockStrength;
				}
				// Spin direction based on which side the sphere hit from
				knockbackRef.current.spin = (sphere.mesh.position.x > shipPos.x ? -1 : 1) * 8;

				// Rage spike from sphere collision
				setGameState((prev) => {
					const rageIncrease = 3 + Math.random() * 3;
					return { ...prev, damageFlash: 0.5, rageLevel: Math.min(100, prev.rageLevel + rageIncrease), collisionCount: prev.collisionCount + 1 };
				});

				// Remove the sphere on collision
				disposeMesh(sphere.mesh);
				sceneRef.current?.remove(sphere.mesh);
				return false;
			}

			return true;
		});

		// Update quark pairs
		quarkPairsRef.current = quarkPairsRef.current.filter((pair) => {
			// Move through tunnel
			pair.zPosition += speed * deltaTime;
			pair.meshA.position.z = pair.zPosition;
			pair.meshB.position.z = pair.zPosition;

			// Remove if behind camera
			if (pair.zPosition > 5) {
				if (pair.behaviorA) behaviorSystemRef.current.unregister(pair.behaviorA);
				if (pair.behaviorB) behaviorSystemRef.current.unregister(pair.behaviorB);
				disposeMesh(pair.meshA);
				disposeMesh(pair.meshB);
				sceneRef.current?.remove(pair.meshA);
				sceneRef.current?.remove(pair.meshB);
				return false;
			}

			const now = Date.now();

			// Music energy drives the dance
			const bass = bassEnergyRef.current;
			const mid = midEnergyRef.current;
			const treble = trebleEnergyRef.current;

			// Radius breathes in and out — one full close-far-close cycle every ~4 seconds
			const danceTime = (now - pair.birthTime) / 1000;
			const breath = 0.5 + 0.5 * Math.sin(danceTime * 0.25 * Math.PI * 2);
			pair.orbitRadius = pair.baseOrbitRadius + (pair.maxDriftRadius - pair.baseOrbitRadius) * breath;

			// Figure skater physics: spin faster when close, slower when far
			// Conservation of angular momentum — inverse relationship with radius
			const spinSpeed = pair.orbitSpeed * (pair.maxDriftRadius / Math.max(pair.orbitRadius, 0.3));
			pair.orbitAngle += spinSpeed * deltaTime;

			// Slightly elliptical orbit for organic feel
			const ellipseRatio = 0.85;
			const ax = pair.centerX + Math.cos(pair.orbitAngle) * pair.orbitRadius;
			const ay = pair.centerY + Math.sin(pair.orbitAngle) * pair.orbitRadius * ellipseRatio;
			const bx = pair.centerX + Math.cos(pair.orbitAngle + Math.PI) * pair.orbitRadius;
			const by = pair.centerY + Math.sin(pair.orbitAngle + Math.PI) * pair.orbitRadius * ellipseRatio;

			pair.meshA.position.x = ax;
			pair.meshA.position.y = ay;
			pair.meshB.position.x = bx;
			pair.meshB.position.y = by;

			// Tumble together — each rod rolls on all axes at different rates
			// Faster tumble when spinning fast (close together)
			const tumbleBase = 1.2 + (pair.maxDriftRadius / Math.max(pair.orbitRadius, 0.3)) * 0.4;
			pair.meshA.rotation.x += deltaTime * tumbleBase * 0.9;
			pair.meshA.rotation.y += deltaTime * tumbleBase * 0.6;
			pair.meshA.rotation.z += deltaTime * tumbleBase * 0.4;
			pair.meshB.rotation.x -= deltaTime * tumbleBase * 0.7;
			pair.meshB.rotation.y -= deltaTime * tumbleBase * 1.1;
			pair.meshB.rotation.z += deltaTime * tumbleBase * 0.5;

			// Emissive glow pulses with treble — shimmer on high frequencies
			const glowIntensity = 0.2 + treble * 0.8;
			pair.meshA.traverse((child) => {
				if (child instanceof THREE.Mesh && child.material) {
					(child.material as THREE.MeshStandardMaterial).emissiveIntensity = glowIntensity;
				}
			});
			pair.meshB.traverse((child) => {
				if (child instanceof THREE.Mesh && child.material) {
					(child.material as THREE.MeshStandardMaterial).emissiveIntensity = glowIntensity;
				}
			});

			// Sync behavior positions
			if (pair.behaviorA) {
				pair.behaviorA.position.set(ax, ay, pair.zPosition);
			}
			if (pair.behaviorB) {
				pair.behaviorB.position.set(bx, by, pair.zPosition);
			}

			// Check collision with spaceship (either shard)
			const shipPos = spaceshipRef.current!.position;
			const distA = pair.meshA.position.distanceTo(shipPos);
			const distB = pair.meshB.position.distanceTo(shipPos);
			if (distA < 0.8 || distB < 0.8) {
				playCollisionSound();

				// Barely any knockback — shards are delicate
				const dx = shipPos.x - pair.centerX;
				const dy = shipPos.y - pair.centerY;
				const pushDist = Math.sqrt(dx * dx + dy * dy);
				if (pushDist > 0.05) {
					knockbackRef.current.vx = (dx / pushDist) * 0.5;
					knockbackRef.current.vy = (dy / pushDist) * 0.5;
				}
				knockbackRef.current.spin = (Math.random() - 0.5) * 0.3;

				// Shatter into 6-8 mini pairs that bloom outward
				const fragmentCount = 6 + Math.floor(Math.random() * 3);
				for (let f = 0; f < fragmentCount; f++) {
					const angle = (f / fragmentCount) * Math.PI * 2 + Math.random() * 0.4;
					const driftSpeed = 0.8 + Math.random() * 1.2;
					const createMiniShard = (): THREE.Mesh => {
						if (shardModelRef.current) {
							const clone = shardModelRef.current.clone();
							clone.scale.set(0.25 + Math.random() * 0.15, 0.25 + Math.random() * 0.15, 0.25 + Math.random() * 0.15);
							clone.traverse((child) => {
								if ((child as THREE.Mesh).isMesh) {
									const m = child as THREE.Mesh;
									const orig = m.material as THREE.MeshStandardMaterial;
									if (orig.emissive) {
										const mat = orig.clone();
										mat.emissiveIntensity = 0.5;
										mat.transparent = true;
										m.material = mat;
									}
								}
							});
							const g = new THREE.Group();
							g.add(clone);
							g.position.set(pair.centerX, pair.centerY, pair.zPosition);
							sceneRef.current?.add(g);
							return g as unknown as THREE.Mesh;
						}
						const geo = new THREE.CylinderGeometry(0.03, 0.03, 0.3, 5);
						const mat = new THREE.MeshStandardMaterial({
							color: 0x998877, emissive: 0x554433,
							emissiveIntensity: 0.5, transparent: true,
						});
						const m = new THREE.Mesh(geo, mat);
						m.position.set(pair.centerX, pair.centerY, pair.zPosition);
						sceneRef.current?.add(m);
						return m;
					};

					const frag: ShatterFragment = {
						meshA: createMiniShard(),
						meshB: createMiniShard(),
						birthTime: Date.now(),
						cx: pair.centerX,
						cy: pair.centerY,
						cz: pair.zPosition,
						driftX: Math.cos(angle) * driftSpeed,
						driftY: Math.sin(angle) * driftSpeed,
						driftZ: (Math.random() - 0.5) * 1.5,
						orbitAngle: Math.random() * Math.PI * 2,
						orbitRadius: 0.06 + Math.random() * 0.06,
						orbitSpeed: 4 + Math.random() * 4,
						spinA: { x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 },
						spinB: { x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 },
					};
					shatterFragmentsRef.current.push(frag);
				}

				// Remove the original pair
				if (pair.behaviorA) behaviorSystemRef.current.unregister(pair.behaviorA);
				if (pair.behaviorB) behaviorSystemRef.current.unregister(pair.behaviorB);
				disposeMesh(pair.meshA);
				disposeMesh(pair.meshB);
				sceneRef.current?.remove(pair.meshA);
				sceneRef.current?.remove(pair.meshB);

				setGameState((prev) => ({
					...prev,
					damageFlash: 0.05,
					rageLevel: Math.min(100, prev.rageLevel + 1),
				}));

				return false; // remove original pair
			}

			return true;
		});

		// Update shatter fragments — mini pairs bloom outward and fade
		const SHATTER_LIFETIME = 3000; // 3 seconds
		shatterFragmentsRef.current = shatterFragmentsRef.current.filter((frag) => {
			const age = Date.now() - frag.birthTime;
			if (age > SHATTER_LIFETIME) {
				disposeMesh(frag.meshA);
				disposeMesh(frag.meshB);
				sceneRef.current?.remove(frag.meshA);
				sceneRef.current?.remove(frag.meshB);
				return false;
			}

			const t = age / SHATTER_LIFETIME; // 0→1
			const fadeAlpha = 1 - t * t; // quadratic fade out

			// Drift outward gently (decelerating)
			const drift = 1 - t * 0.6; // slows down over time
			frag.cx += frag.driftX * deltaTime * drift;
			frag.cy += frag.driftY * deltaTime * drift;
			frag.cz += frag.driftZ * deltaTime * drift;

			// Move with tunnel scroll
			frag.cz += speed * deltaTime;

			// Mini orbit
			frag.orbitAngle += frag.orbitSpeed * deltaTime;
			const oax = frag.cx + Math.cos(frag.orbitAngle) * frag.orbitRadius;
			const oay = frag.cy + Math.sin(frag.orbitAngle) * frag.orbitRadius;
			const obx = frag.cx + Math.cos(frag.orbitAngle + Math.PI) * frag.orbitRadius;
			const oby = frag.cy + Math.sin(frag.orbitAngle + Math.PI) * frag.orbitRadius;

			frag.meshA.position.set(oax, oay, frag.cz);
			frag.meshB.position.set(obx, oby, frag.cz);

			// Spin
			frag.meshA.rotation.x += frag.spinA.x * deltaTime;
			frag.meshA.rotation.y += frag.spinA.y * deltaTime;
			frag.meshA.rotation.z += frag.spinA.z * deltaTime;
			frag.meshB.rotation.x += frag.spinB.x * deltaTime;
			frag.meshB.rotation.y += frag.spinB.y * deltaTime;
			frag.meshB.rotation.z += frag.spinB.z * deltaTime;

			// Fade opacity
			frag.meshA.traverse((child) => {
				if ((child as THREE.Mesh).isMesh) {
					const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
					if (mat.transparent) mat.opacity = fadeAlpha;
				}
			});
			frag.meshB.traverse((child) => {
				if ((child as THREE.Mesh).isMesh) {
					const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
					if (mat.transparent) mat.opacity = fadeAlpha;
				}
			});

			// Scale down slightly as they fade
			const s = 0.7 + 0.3 * fadeAlpha;
			frag.meshA.scale.setScalar(s);
			frag.meshB.scale.setScalar(s);

			return true;
		});

		// Update corkscrew groups
		corkscrewGroupsRef.current = corkscrewGroupsRef.current.filter((group) => {
			if (group.isExploding) {
				// Already handled explosion, just clean up
				// Stop the flyby audio if it's playing
				if (group.flybyAudio) {
					group.flybyAudio.pause();
					group.flybyAudio.currentTime = 0;
				}
				return false;
			}

			const age = (currentTime - group.birthTime) / 1000;

			// Handle flyby sound with progressive volume and repetition
			if (group.flybyAudio) {
				const audio = group.flybyAudio;
				const isPlaying = !audio.paused && audio.currentTime > 0 && audio.currentTime < audio.duration;

				// Progressive volume levels scaled by SFX flyby setting
				const base = sfxLevelsRef.current.flyby;
				const volumeLevels = [0.33 * base, 0.5 * base, 0.67 * base, 0.83 * base, base, 0.67 * base];

				// Track when audio finishes playing
				if (!isPlaying && group.flybyPlayCount > 0 && audio.currentTime > 0) {
					// Audio has finished, reset for next play
					audio.currentTime = 0;
				}

				// Check if we should play the audio
				const shouldStartPlaying = age >= 5 // Wait at least 5 seconds after spawn
					&& !isPlaying // Not currently playing
					&& group.flybyPlayCount < volumeLevels.length // Haven't exhausted all plays
					&& (group.flybyPlayCount === 0 || (group.lastFlybyEndTime > 0 && currentTime - group.lastFlybyEndTime > 150)); // First play or 150ms after last ended

				if (shouldStartPlaying && audio.readyState >= 2) {
					const volumeIndex = group.flybyPlayCount;
					audio.volume = volumeLevels[volumeIndex];
					audio.currentTime = 0;
					audio.onended = () => {
						group.lastFlybyEndTime = Date.now();
						group.flybyPlayCount++;
					};
					audio.play().catch(() => {});
				}
			}

			// Remove corkscrew after 60 seconds (1 full year)
			if (age > 60) {
				// Clean up all obstacles in the group
				group.obstacles.forEach((obs) => {
					const beh = (obs.mesh as unknown as { _behavior?: BehaviorState })?._behavior;
					if (beh) behaviorSystemRef.current.unregister(beh);
					disposeMesh(obs.mesh);
					sceneRef.current?.remove(obs.mesh);
				});
				// Stop the flyby audio
				if (group.flybyAudio) {
					group.flybyAudio.pause();
					group.flybyAudio.currentTime = 0;
				}
				return false;
			}

			let allBehindCamera = true;

			// Update each obstacle in the corkscrew formation
			group.obstacles = group.obstacles.filter((obstacle) => {
				// Move forward through tunnel
				obstacle.zPosition += speed * deltaTime;
				obstacle.mesh.position.z = obstacle.zPosition;

				// Check if behind camera
				if (obstacle.mesh.position.z > 5) {
					const beh = (obstacle.mesh as unknown as { _behavior?: BehaviorState })?._behavior;
					if (beh) behaviorSystemRef.current.unregister(beh);
					disposeMesh(obstacle.mesh);
					sceneRef.current?.remove(obstacle.mesh);
					return false;
				}
				allBehindCamera = false;

				// Corkscrew motion
				const currentAngle = obstacle.angleOffset + (age * group.rotationSpeed);

				// Calculate position in corkscrew
				const x = Math.cos(currentAngle) * obstacle.radius;
				const y = Math.sin(currentAngle) * obstacle.radius;

				// As the group ages past 50 seconds (last 10 seconds), expand outward toward edges
				const fadeStart = 50; // Start expanding at 50 seconds
				const fadeDuration = 10; // Take 10 seconds to move to edges
				let expansionFactor = 1.0;

				if (age > fadeStart) {
					// Calculate how far through the fade we are (0 to 1)
					const fadeProgress = Math.min(1, (age - fadeStart) / fadeDuration);
					// Smoothly expand from 1.0 to 2.5 (moves them toward/past tunnel edge)
					expansionFactor = 1.0 + (fadeProgress * 1.5);
				}

				obstacle.mesh.position.x = x * expansionFactor;
				obstacle.mesh.position.y = y * expansionFactor;

				// Sync behavior position for spatial index
				const beh = (obstacle.mesh as unknown as { _behavior?: BehaviorState })?._behavior;
				if (beh) beh.position.copy(obstacle.mesh.position);

				// Rotate the obstacle itself for visual interest
				obstacle.mesh.rotation.x += deltaTime * 2;
				obstacle.mesh.rotation.y += deltaTime * 1.5;

				// Check collision with spaceship
				const dist = obstacle.mesh.position.distanceTo(spaceshipRef.current!.position);
				if (dist < 0.65) {
					// Play collision sound
					playCollisionSound();

					// Heavy knockback — flung away from impact with violent tumble
					const shipPos = spaceshipRef.current!.position;
					const dx = shipPos.x - obstacle.mesh.position.x;
					const dy = shipPos.y - obstacle.mesh.position.y;
					const pushDist = Math.sqrt(dx * dx + dy * dy);
					if (pushDist > 0.05) {
						knockbackRef.current.vx = (dx / pushDist) * 20;
						knockbackRef.current.vy = (dy / pushDist) * 20;
					}
					knockbackRef.current.spin = (Math.random() < 0.5 ? -1 : 1) * 12;

					// Trigger explosion for entire group
					group.isExploding = true;

					// Create explosion motes for each obstacle in the group
					group.obstacles.forEach((obs) => {
						// Create 8-12 motes per obstacle
						const numExplosionMotes = 8 + Math.floor(Math.random() * 5);
						for (let i = 0; i < numExplosionMotes; i++) {
							const explosionMote = createMote(obs.mesh.position.z);
							// Override position to match obstacle
							explosionMote.mesh.position.copy(obs.mesh.position);
							// Add outward velocity
							const angle = (i / numExplosionMotes) * Math.PI * 2;
							explosionMote.velocity.set(
								Math.cos(angle) * 3,
								Math.sin(angle) * 3,
								(Math.random() - 0.5) * 2
							);
							// Make them glow brighter
							const material = explosionMote.mesh.material as THREE.MeshStandardMaterial;
							material.emissiveIntensity = 2.0;
							material.color.setHex(0xff6b35); // Match corkscrew color
							material.emissive.setHex(0xff4500);
							motesRef.current.push(explosionMote);
						}
						// Remove the obstacle mesh
						disposeMesh(obs.mesh);
						sceneRef.current?.remove(obs.mesh);
					});

					// RAGE SPIKE from corkscrew explosion
					setGameState((prev) => {
						const rageSpike = 20 + Math.random() * 10;
						return { ...prev, damageFlash: 0.8, rageLevel: Math.min(100, prev.rageLevel + rageSpike), collisionCount: prev.collisionCount + 1 };
					});

					return false; // Remove this obstacle
				}

				return true;
			});

			// Remove group if all obstacles are gone or behind camera
			if (group.obstacles.length === 0 || allBehindCamera) {
				group.obstacles.forEach((obs) => {
					const beh = (obs.mesh as unknown as { _behavior?: BehaviorState })?._behavior;
					if (beh) behaviorSystemRef.current.unregister(beh);
					disposeMesh(obs.mesh);
					sceneRef.current?.remove(obs.mesh);
				});
				// Stop the flyby audio
				if (group.flybyAudio) {
					group.flybyAudio.pause();
					group.flybyAudio.currentTime = 0;
				}
				return false;
			}

			return true;
		});

		// Update obstacles — positions driven by behavior system
		obstaclesRef.current = obstaclesRef.current.filter((obstacle) => {
			// Move forward through tunnel
			obstacle.mesh.position.z += speed * deltaTime;
			obstacle.basePosition.z += speed * deltaTime;

			// Sync behavior state z-position with tunnel scroll
			if (obstacle.behavior) {
				obstacle.behavior.position.z = obstacle.mesh.position.z;
			}

			// Remove if behind camera
			if (obstacle.mesh.position.z > 5) {
				if (obstacle.behavior) behaviorSystemRef.current.unregister(obstacle.behavior);
				disposeMesh(obstacle.mesh);
				sceneRef.current?.remove(obstacle.mesh);
				return false;
			}

			// Apply behavior-driven position (x/y from behavior system)
			if (obstacle.behavior) {
				obstacle.mesh.position.x = obstacle.behavior.position.x;
				obstacle.mesh.position.y = obstacle.behavior.position.y;
			}

			// Music pulse — cubes breathe with mid-frequency energy
			const midPulse = midEnergyRef.current * 0.6 * reactivity;
			const pulse = 1 + midPulse;
			obstacle.mesh.scale.set(pulse, pulse, pulse);

			// Slow rolling rotation
			const rollSpeed = 0.3;
			obstacle.mesh.rotation.x += rollSpeed * deltaTime;
			obstacle.mesh.rotation.y += rollSpeed * deltaTime * 0.7;
			obstacle.mesh.rotation.z += rollSpeed * deltaTime * 0.5;

			// Check collision with spaceship (1s cooldown per obstacle)
			const dist = obstacle.mesh.position.distanceTo(spaceshipRef.current!.position);
			if (dist < 0.6 && currentTime - obstacle.lastCollisionTime > 1000) {
				obstacle.lastCollisionTime = currentTime;
				playCollisionSound();

				// Make cloud being angry via mood system
				obstacle.angerLevel = 1.0;
				obstacle.angerTime = currentTime;
				if (obstacle.behavior) {
					obstacle.behavior.mood.anger = 1.0;
				}

				// Knockback — bounce away from cube with a wobble
				const shipPos = spaceshipRef.current!.position;
				const dx = shipPos.x - obstacle.mesh.position.x;
				const dy = shipPos.y - obstacle.mesh.position.y;
				const pushDist = Math.sqrt(dx * dx + dy * dy);
				if (pushDist > 0.05) {
					knockbackRef.current.vx = (dx / pushDist) * 8;
					knockbackRef.current.vy = (dy / pushDist) * 8;
				}
				knockbackRef.current.spin = (Math.random() - 0.5) * 6;

				setGameState((prev) => {
					const rageIncrease = 5 + Math.random() * 4;
					return { ...prev, damageFlash: 0.3, rageLevel: Math.min(100, prev.rageLevel + rageIncrease), collisionCount: prev.collisionCount + 1 };
				});
			}

			// Anger visuals
			if (obstacle.angerLevel > 0) {
				const timeSinceAnger = (currentTime - obstacle.angerTime) / 1000;
				obstacle.angerLevel = Math.max(0, 1 - timeSinceAnger / 6);
			}
			const moodAnger = obstacle.behavior?.mood.anger ?? 0;
			// Global rage provides a baseline anger (up to 0.5 at 100% rage)
			const rageBaseline = (state.rageLevel / 100) * 0.5;
			const rawAnger = Math.max(obstacle.angerLevel, moodAnger, rageBaseline);

			// Color: subtle warm shift, max 30% toward red
			const colorAnger = Math.min(0.3, rawAnger * 0.3);
			// Slow emissive glow — only activates above 60% rage, max 20% intensity
			// ~8 second cycle with smooth sine, per-entity phase offset
			const ragePercent = state.rageLevel / 100;
			const glowFactor = ragePercent > 0.6 ? (ragePercent - 0.6) / 0.4 : 0; // 0 at 60%, 1 at 100%
			// Narrow oscillation band: ranges 0.6–1.0 so it never fully turns off
			// ~10 second cycle for slow menacing pulse, per-entity phase offset
			const glowWave = 0.7 + 0.3 * Math.sin(currentTime / 5000 + obstacle.birthTime * 0.001);
			const emissiveStrength = glowFactor * glowWave * 0.2;

			obstacle.mesh.traverse((child) => {
				if (child instanceof THREE.Mesh && child.material) {
					const material = child.material as THREE.MeshStandardMaterial;
					const baseColor = new THREE.Color(0x8b6f47);
					const angryColor = new THREE.Color(0xff3333);
					material.color.lerpColors(baseColor, angryColor, colorAnger);
					material.emissive.setRGB(emissiveStrength, 0, 0);
				}
			});

			// Scale: music pulse + mild angry swell (no vibration)
			const angryScale = 1 + rawAnger * 0.2;
			const combinedPulse = (1 + midPulse) * angryScale;
			obstacle.mesh.scale.set(combinedPulse, combinedPulse, combinedPulse);

			return true;
		});

		// Update projectiles (flares)
		projectilesRef.current = projectilesRef.current.filter((projectile) => {
			// Calculate distance traveled this frame
			const distanceThisFrame = projectile.velocity.length() * deltaTime;
			projectile.distanceTraveled += distanceThisFrame;

			// Move flare down tunnel
			projectile.mesh.position.add(
				projectile.velocity.clone().multiplyScalar(deltaTime)
			);

			// Move light with flare
			projectile.light.position.copy(projectile.mesh.position);

			// Check if flare should ignite
			if (!projectile.hasIgnited && projectile.distanceTraveled >= projectile.ignitionDistance) {
				projectile.hasIgnited = true;
				projectile.ignitionTime = currentTime;

				// Ignite the flare visually
				const material = projectile.mesh.material as THREE.MeshStandardMaterial;
				material.color.setHex(0xffdd66); // Bright yellow
				material.emissive.setHex(0xffaa00); // Orange glow
				material.emissiveIntensity = 3;

				// Expand the flare on ignition
				projectile.mesh.scale.set(1.5, 1.5, 1.5);

				// Turn on the light at MUCH higher intensity to illuminate tunnel
				projectile.light.intensity = 35;
			}

			// If ignited, handle the burning effect and eventual fade
			if (projectile.hasIgnited) {
				const timeSinceIgnition = (currentTime - projectile.ignitionTime) / 1000;
				const burnDuration = 2.0; // Flare burns for 2 seconds

				if (timeSinceIgnition > burnDuration) {
					// Flare has burned out, remove it
					disposeMesh(projectile.mesh);
					sceneRef.current?.remove(projectile.mesh);
					sceneRef.current?.remove(projectile.light);
					return false;
				}

				// Fade out over the burn duration
				const fadeProgress = timeSinceIgnition / burnDuration;
				const brightness = 1 - fadeProgress;

				// Pulse the flare while burning
				const pulseSpeed = 10;
				const pulseAmount = 0.2 * brightness;
				const pulse = 1.5 + Math.sin(currentTime / 100 * pulseSpeed) * pulseAmount;
				projectile.mesh.scale.set(pulse, pulse, pulse);

				// Fade light intensity - starts at 35, pulses as it fades
				projectile.light.intensity = 35 * brightness * (1 + Math.sin(currentTime / 100 * pulseSpeed) * 0.3);

				// Fade emissive intensity
				const material = projectile.mesh.material as THREE.MeshStandardMaterial;
				material.emissiveIntensity = 3 * brightness;

				// Check collision with obstacles - ignited flare makes them ANGRY!
				let hit = false;
				obstaclesRef.current.forEach((obstacle) => {
					const dist = obstacle.mesh.position.distanceTo(projectile.mesh.position);
					if (dist < 1.5) {
						// Make the cloud being VERY angry!
						obstacle.angerLevel = 1.0;
						obstacle.angerTime = currentTime;
						hit = true;
						// Play flare hit sound at 10% volume
						playFlareHitSound();
					}
				});

				if (hit) {
					// ── Impact flash: expanding bright burst ──
					const impactPos = projectile.mesh.position.clone();
					const flashGeo = new THREE.SphereGeometry(0.15, 8, 6);
					const flashMat = new THREE.MeshStandardMaterial({
						color: 0xffffcc,
						emissive: 0xffaa33,
						emissiveIntensity: 5,
						transparent: true,
						opacity: 1,
					});
					const flashMesh = new THREE.Mesh(flashGeo, flashMat);
					flashMesh.position.copy(impactPos);
					sceneRef.current?.add(flashMesh);

					// Bright point light at impact
					const flashLight = new THREE.PointLight(0xffaa33, 70, 25);
					flashLight.position.copy(impactPos);
					sceneRef.current?.add(flashLight);

					// Animate: expand + fade over 250ms then remove
					const flashStart = Date.now();
					const animateFlash = () => {
						const age = (Date.now() - flashStart) / 250; // 0→1 over 250ms
						if (age >= 1) {
							flashGeo.dispose();
							flashMat.dispose();
							sceneRef.current?.remove(flashMesh);
							sceneRef.current?.remove(flashLight);
							return;
						}
						const scale = 1 + age * 4; // expands 1→5x
						flashMesh.scale.set(scale, scale, scale);
						flashMat.opacity = 1 - age;
						flashMat.emissiveIntensity = 5 * (1 - age);
						flashLight.intensity = 70 * (1 - age * age); // fades quadratically
						requestAnimationFrame(animateFlash);
					};
					requestAnimationFrame(animateFlash);

					disposeMesh(projectile.mesh);
					sceneRef.current?.remove(projectile.mesh);
					sceneRef.current?.remove(projectile.light);
					return false;
				}
			}

			// Remove if too far
			if (projectile.mesh.position.z < -100) {
				sceneRef.current?.remove(projectile.mesh);
				sceneRef.current?.remove(projectile.light);
				return false;
			}

			return true;
		});

		// Update atmospheric motes
		motesRef.current = motesRef.current.filter((mote) => {
			// Move forward through tunnel
			mote.mesh.position.z += speed * deltaTime;

			// Murmuration z-boost: recruited motes rush toward the ship
			if (mote.behavior) {
				const zBoost = getMurmurationZBoost(mote.behavior);
				if (zBoost > 0) {
					mote.mesh.position.z += zBoost * deltaTime;
				}
			}

			// Sync behavior z
			if (mote.behavior) {
				mote.behavior.position.z = mote.mesh.position.z;
			}

			// Remove if behind camera
			if (mote.mesh.position.z > 5) {
				if (mote.behavior) behaviorSystemRef.current.unregister(mote.behavior);
				disposeMesh(mote.mesh);
				sceneRef.current?.remove(mote.mesh);
				return false;
			}

			// Apply behavior-driven position (x/y)
			if (mote.behavior) {
				mote.mesh.position.x = mote.behavior.position.x;
				mote.mesh.position.y = mote.behavior.position.y;
			}

			// Gentle wobble on top of behavior movement
			mote.wobblePhase += deltaTime * 0.5;

			// Subtle pulsing glow
			const material = mote.mesh.material as THREE.MeshStandardMaterial;
			const basePulse = mote.baseIntensity + Math.sin(currentTime / 500 + mote.wobblePhase) * 0.2;

			// React to nearby flare lights!
			let nearbyLightBoost = 0;
			projectilesRef.current.forEach((projectile) => {
				if (projectile.hasIgnited) {
					const dist = mote.mesh.position.distanceTo(projectile.mesh.position);
					const influence = Math.max(0, 1 - dist / 20); // Affected up to 20 units away
					nearbyLightBoost += influence * 2.0; // Boost emissive when near flares
				}
			});

			// Apply total intensity with light reaction
			material.emissiveIntensity = Math.min(3.0, basePulse + nearbyLightBoost);

			// Brighten opacity when lit
			material.opacity = Math.min(1.0, 0.7 + nearbyLightBoost * 0.3);

			// Mote-ship collision — trigger relay wave
			const moteDist = mote.mesh.position.distanceTo(spaceshipRef.current!.position);
			if (moteDist < 0.4 && !moteRelayRef.current) {
				// Start a relay wave from the ship's position
				const shipZ = spaceshipRef.current!.position.z;
				moteRelayRef.current = {
					startTime: currentTime,
					startZ: shipZ,
					prevWavefrontZ: shipZ,
					visited: new Set(),
				};
				// Anger this mote as the origin
				if (mote.behavior) mote.behavior.mood.anger = 1.0;
				relayMotesRef.current.set(mote, currentTime);
				// Small ship bump from mote contact
				const mdx = spaceshipRef.current!.position.x - mote.mesh.position.x;
				const mdy = spaceshipRef.current!.position.y - mote.mesh.position.y;
				const mdd = Math.sqrt(mdx * mdx + mdy * mdy) || 1;
				knockbackRef.current.vx += (mdx / mdd) * 1.5;
				knockbackRef.current.vy += (mdy / mdd) * 1.5;
				knockbackRef.current.spin += (Math.random() - 0.5) * 1.2;
				// Bump rage — the aliens noticed you
				setGameState((prev) => ({
					...prev,
					rageLevel: Math.min(100, prev.rageLevel + 3),
				}));
			}

			// Anger visuals — blend from warm cream to red, then decay
			const moteAnger = mote.behavior?.mood.anger ?? 0;
			if (moteAnger > 0.01) {
				const baseColor = new THREE.Color(0xfff8e8);
				const angryColor = new THREE.Color(0xff3333);
				material.color.lerpColors(baseColor, angryColor, moteAnger);
				material.emissive.lerpColors(new THREE.Color(0xffeab3), new THREE.Color(0xff1111), moteAnger);
				material.emissiveIntensity = Math.min(3.0, basePulse + nearbyLightBoost + moteAnger * 2);
			} else {
				material.color.set(0xfff8e8);
				material.emissive.set(0xffeab3);
			}

			return true;
		});

		// ── Flock murmuration system ──
		// Spawn a flock every 25-45 seconds after 60s
		const flockTimeSurvived = (Date.now() - state.timeStarted) / 1000;
		if (
			flockTimeSurvived >= 60
			&& !flockRef.current
			&& Date.now() - lastFlockTime.current > 25000 + Math.random() * 20000
		) {
			// Leader: warm yellow, 2x mote size, strong glow
			const leaderGeom = new THREE.SphereGeometry(0.09, 12, 12);
			const leaderMat = new THREE.MeshStandardMaterial({
				color: 0xffe066,
				emissive: 0xffaa22,
				emissiveIntensity: 1.5,
				transparent: true,
				opacity: 0.9,
			});
			const leaderMesh = new THREE.Mesh(leaderGeom, leaderMat);
			const startAngle = Math.random() * Math.PI * 2;
			const startR = 1.0 + Math.random() * 2.0;
			const startPos = new THREE.Vector3(
				Math.cos(startAngle) * startR,
				Math.sin(startAngle) * startR,
				-55
			);
			leaderMesh.position.copy(startPos);
			sceneRef.current?.add(leaderMesh);

			// Spawn ~30 flock motes clustered around the leader
			const members: FlockMember[] = [];
			const flockSize = 25 + Math.floor(Math.random() * 10);
			for (let fi = 0; fi < flockSize; fi++) {
				const mGeom = new THREE.SphereGeometry(0.04, 8, 8);
				const mMat = new THREE.MeshStandardMaterial({
					color: 0xfff8e8,
					emissive: 0xffeab3,
					emissiveIntensity: 0.5,
					transparent: true,
					opacity: 0.7,
				});
				const mMesh = new THREE.Mesh(mGeom, mMat);
				// Scatter around leader
				const a = Math.random() * Math.PI * 2;
				const r = 0.3 + Math.random() * 1.2;
				const zOff = (Math.random() - 0.5) * 1.5;
				mMesh.position.set(
					startPos.x + Math.cos(a) * r,
					startPos.y + Math.sin(a) * r,
					startPos.z + zOff
				);
				sceneRef.current?.add(mMesh);

				members.push({
					mesh: mMesh,
					vel: new THREE.Vector3(0, 0, 0),
					accelScale: 0.6 + Math.random() * 0.8, // 0.6-1.4
					preferredDist: 0.8 + Math.random() * 1.2, // 0.8-2.0
					phase: Math.random() * Math.PI * 2,
				});
			}

			const wanderA = Math.random() * Math.PI * 2;
			const wanderR = 1.0 + Math.random() * 2.5;

			flockRef.current = {
				leader: leaderMesh,
				members,
				leaderPos: startPos.clone(),
				leaderVel: new THREE.Vector3(0, 0, 0),
				spawnTime: Date.now(),
				wanderTarget: new THREE.Vector2(Math.cos(wanderA) * wanderR, Math.sin(wanderA) * wanderR),
				wanderTimer: 800 + Math.random() * 1200,
			};
		}

		// Update flock
		if (flockRef.current) {
			const flock = flockRef.current;
			const lp = flock.leaderPos;
			const elapsed = Date.now() - flock.spawnTime;

			// ── Leader: sinusoidal Lissajous flight path ──
			const t = elapsed / 1000; // seconds

			// Layered sine waves at irrational ratios — never repeats
			// Primary sweep: big cross-tunnel arcs
			// Secondary: faster wobble layered on top
			const amp1 = 2.8, amp2 = 1.2;
			const freq1x = 1.7, freq1y = 1.3;   // primary — slow sweeping
			const freq2x = 4.1, freq2y = 3.7;   // secondary — fast zig-zag
			const pathX = Math.sin(t * freq1x) * amp1 + Math.sin(t * freq2x + 1.0) * amp2;
			const pathY = Math.sin(t * freq1y + 0.7) * amp1 + Math.cos(t * freq2y + 2.0) * amp2;

			// Steer leader toward the sine path position (not snap — allows obstacle avoidance to deflect)
			const pathForce = 18.0;
			flock.leaderVel.x += (pathX - lp.x) * pathForce * deltaTime;
			flock.leaderVel.y += (pathY - lp.y) * pathForce * deltaTime;

			// Tunnel scroll
			lp.z += speed * deltaTime;
			// Swooping z-velocity: gentle approach with subtle variation
			const zSwoop = 1.5 + Math.sin(t * 1.1) * 1.0 + Math.sin(t * 2.7) * 0.8; // ~0-3.3 range
			lp.z += zSwoop * deltaTime;

			// Dodge obstacles — deflects off the sine path temporarily
			for (const obs of obstaclesRef.current) {
				const op = obs.mesh.position;
				const dx = lp.x - op.x, dy = lp.y - op.y, dz = lp.z - op.z;
				const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
				if (dist < 5 && dist > 0.1) {
					const urgency = (1 - dist / 5) * 30;
					flock.leaderVel.x += (dx / dist) * urgency * deltaTime;
					flock.leaderVel.y += (dy / dist) * urgency * deltaTime;
				}
			}
			for (const cg of corkscrewGroupsRef.current) {
				for (const co of cg.obstacles) {
					const op = co.mesh.position;
					const dx = lp.x - op.x, dy = lp.y - op.y, dz = lp.z - op.z;
					const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
					if (dist < 5 && dist > 0.1) {
						const urgency = (1 - dist / 5) * 30;
						flock.leaderVel.x += (dx / dist) * urgency * deltaTime;
						flock.leaderVel.y += (dy / dist) * urgency * deltaTime;
					}
				}
			}
			for (const rs of rollingSpheresRef.current) {
				const op = rs.mesh.position;
				const dx = lp.x - op.x, dy = lp.y - op.y, dz = lp.z - op.z;
				const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
				if (dist < 5 && dist > 0.1) {
					const urgency = (1 - dist / 5) * 30;
					flock.leaderVel.x += (dx / dist) * urgency * deltaTime;
					flock.leaderVel.y += (dy / dist) * urgency * deltaTime;
				}
			}

			// Tunnel wall constraint
			const lpDist = Math.sqrt(lp.x * lp.x + lp.y * lp.y);
			if (lpDist > 3.2) {
				const pushBack = (lpDist - 3.2) * 15;
				flock.leaderVel.x -= (lp.x / lpDist) * pushBack * deltaTime;
				flock.leaderVel.y -= (lp.y / lpDist) * pushBack * deltaTime;
			}

			// Damping — fairly low so the sine path drives motion crisply
			flock.leaderVel.x *= 0.85;
			flock.leaderVel.y *= 0.85;

			// Apply velocity
			lp.x += flock.leaderVel.x * deltaTime;
			lp.y += flock.leaderVel.y * deltaTime;

			// Update leader mesh
			flock.leader.position.copy(lp);
			const lMat = flock.leader.material as THREE.MeshStandardMaterial;
			lMat.emissiveIntensity = 1.2 + Math.sin(elapsed / 250) * 0.4;

			// ── Flock members: overshoot-and-correct physics ──
			for (let fi = 0; fi < flock.members.length; fi++) {
				const m = flock.members[fi];
				const pos = m.mesh.position;

				// Match tunnel scroll + z-swoop (same as leader so they stay in z-range)
				pos.z += speed * deltaTime;
				pos.z += zSwoop * deltaTime;

				// 1) Chase the leader with HIGH acceleration + LOW damping = overshoot
				const toLdrX = lp.x - pos.x;
				const toLdrY = lp.y - pos.y;
				const toLdrZ = lp.z - pos.z;
				const ldrDist = Math.sqrt(toLdrX * toLdrX + toLdrY * toLdrY + toLdrZ * toLdrZ);
				if (ldrDist > 0.01) {
					// Very strong lateral acceleration — motes WILL overshoot the leader
					const accel = 25.0 * m.accelScale;
					m.vel.x += (toLdrX / ldrDist) * accel * deltaTime;
					m.vel.y += (toLdrY / ldrDist) * accel * deltaTime;
					// Z chase — gentler, base scroll handles most
					const zChase = toLdrZ * 4.0 * m.accelScale;
					m.vel.z += zChase * deltaTime;
				}

				// 2) Neighbor separation + alignment
				let sepX = 0, sepY = 0, sepZ = 0;
				let alignVX = 0, alignVY = 0, alignVZ = 0;
				let neighborCount = 0;

				for (let ni = 0; ni < flock.members.length; ni++) {
					if (ni === fi) continue;
					const other = flock.members[ni];
					const ox = pos.x - other.mesh.position.x;
					const oy = pos.y - other.mesh.position.y;
					const oz = pos.z - other.mesh.position.z;
					const nDist = Math.sqrt(ox * ox + oy * oy + oz * oz);
					if (nDist < 1.5 && nDist > 0.01) {
						const repel = (1 - nDist / 1.5) * 10.0;
						sepX += (ox / nDist) * repel;
						sepY += (oy / nDist) * repel;
						sepZ += (oz / nDist) * repel;
						alignVX += other.vel.x;
						alignVY += other.vel.y;
						alignVZ += other.vel.z;
						neighborCount++;
						if (neighborCount >= 6) break;
					}
				}

				m.vel.x += sepX * deltaTime;
				m.vel.y += sepY * deltaTime;
				m.vel.z += sepZ * deltaTime;

				if (neighborCount > 0) {
					alignVX /= neighborCount;
					alignVY /= neighborCount;
					alignVZ /= neighborCount;
					m.vel.x += (alignVX - m.vel.x) * 0.6 * deltaTime;
					m.vel.y += (alignVY - m.vel.y) * 0.6 * deltaTime;
					m.vel.z += (alignVZ - m.vel.z) * 0.4 * deltaTime;
				}

				// 3) Tunnel wall constraint
				const mDist = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
				if (mDist > 3.6) {
					const wallPush = (mDist - 3.6) * 16;
					m.vel.x -= (pos.x / mDist) * wallPush * deltaTime;
					m.vel.y -= (pos.y / mDist) * wallPush * deltaTime;
				}

				// 4) LOW damping — lets velocity carry past target (overshoot!)
				// Variation per mote: faster motes overshoot more
				const damp = 0.96 + m.accelScale * 0.015; // 0.969 – 0.981
				m.vel.x *= damp;
				m.vel.y *= damp;
				m.vel.z *= 0.92; // z damps faster to prevent z-spread

				// 5) Apply velocity
				pos.x += m.vel.x * deltaTime;
				pos.y += m.vel.y * deltaTime;
				pos.z += m.vel.z * deltaTime;

				// Glow pulses with speed — brighter when moving fast
				const mSpeed = Math.sqrt(m.vel.x * m.vel.x + m.vel.y * m.vel.y);
				const mMat = m.mesh.material as THREE.MeshStandardMaterial;
				mMat.emissiveIntensity = 0.3 + Math.min(mSpeed * 0.15, 0.6) + Math.sin(elapsed / 400 + m.phase) * 0.15;
			}

			// Remove flock well after it passes the camera
			if (lp.z > 20) {
				disposeMesh(flock.leader);
				sceneRef.current?.remove(flock.leader);
				for (const m of flock.members) {
					disposeMesh(m.mesh);
					sceneRef.current?.remove(m.mesh);
				}
				flockRef.current = null;
				lastFlockTime.current = Date.now();
			}
		}

		// Update mote relay wave — continuous wavefront, 50% of motes
		if (moteRelayRef.current) {
			const relay = moteRelayRef.current;
			const relayElapsed = (currentTime - relay.startTime) / 1000;
			const relaySpeed = 25; // z-units per second
			const wavefrontZ = relay.startZ - relayElapsed * relaySpeed;
			const maxDistance = 100;

			if (relayElapsed * relaySpeed > maxDistance) {
				moteRelayRef.current = null;
			} else {
				// Sweep all motes between previous wavefront and current wavefront
				for (const m of motesRef.current) {
					if (relay.visited.has(m)) continue;
					const mz = m.mesh.position.z;
					// Mote is behind the wavefront but ahead of (or at) previous position
					if (mz <= relay.prevWavefrontZ && mz >= wavefrontZ) {
						relay.visited.add(m);
						// 50% chance to join the wave
						if (Math.random() < 0.5 && m.behavior) {
							m.behavior.mood.anger = 1.0;
							relayMotesRef.current.set(m, currentTime);
						}
					}
				}
				relay.prevWavefrontZ = wavefrontZ;
			}
		}

		// Relay motes: hold full red for 1s, then fade over ~2s
		if (relayMotesRef.current.size > 0) {
			const holdDuration = 0.6; // seconds at full red
			for (const [m, angeredAt] of relayMotesRef.current) {
				if (!m.behavior) {
					relayMotesRef.current.delete(m);
					continue;
				}
				const elapsed = (currentTime - angeredAt) / 1000;
				const fadeDuration = 0.3;
				if (elapsed < holdDuration) {
					m.behavior.mood.anger = 1.0;
				} else if (elapsed < holdDuration + fadeDuration) {
					m.behavior.mood.anger = 1.0 - (elapsed - holdDuration) / fadeDuration;
				} else {
					m.behavior.mood.anger = 0;
					relayMotesRef.current.delete(m);
				}
			}
		}

		// Camera follows spaceship - adjusted for better tunnel visibility
		// Camera follows spaceship - adjusted for better tunnel visibility
		cameraRef.current.position.x = spaceshipRef.current.position.x * 0.2;
		cameraRef.current.position.y = spaceshipRef.current.position.y * 0.2 + 1.5;
		cameraRef.current.position.z = spaceshipRef.current.position.z + 4;
		cameraRef.current.lookAt(spaceshipRef.current.position);

		// Update proximity sound based on distance to tunnel walls ONLY
		if (proximitySoundRef.current) {
			// Calculate distance to tunnel wall
			const distFromCenter = Math.sqrt(
				spaceshipRef.current.position.x ** 2 + spaceshipRef.current.position.y ** 2
			);
			const currentTunnelRadius = getTunnelRadius(0) * 0.85;
			const wallProximity = distFromCenter / currentTunnelRadius; // 0 at center, 1 at wall

			// Apply smooth volume curve - exponential for more dramatic effect
			const targetVolume = Math.pow(wallProximity, 2) * sfxLevelsRef.current.proximity;

			// Smooth volume transitions with clamping to [0, 1] range
			const currentVolume = proximitySoundRef.current.volume;
			const volumeTransitionSpeed = 2.0; // How fast volume adjusts
			const newVolume = currentVolume + (targetVolume - currentVolume) * volumeTransitionSpeed * deltaTime;
			proximitySoundRef.current.volume = Math.max(0, Math.min(1, newVolume));
		}

		// Update score based on distance
		setGameState((prev) => {
			// During death sequence, just advance the fade — no score/rage updates
			if (prev.deathSequence) {
				const deathElapsed = (Date.now() - prev.deathStartTime) / 1000;
				const DEATH_DURATION = 8;
				if (deathElapsed >= DEATH_DURATION) {
					return { ...prev, isGameOver: true, deathSequence: false };
				}
				return prev;
			}

			const newScore = prev.score + Math.floor(speed * deltaTime * 10);
			const newLevel = Math.floor(newScore / 1000) + 1;

			// Check for death before decay — rage bumps from events can push to 100
			const currentTimeSurvived = (Date.now() - prev.timeStarted) / 1000;
			const yearsLived = Math.floor(currentTimeSurvived / 60);
			const currentPlayerAge = (prev.playerAge || 0) + yearsLived;

			if ((prev.rageLevel >= 100 || currentPlayerAge >= prev.maxAge) && !prev.deathSequence && !pilotSettings.ignoreDeath) {
				saveHighScore();
				return {
					...prev,
					score: newScore,
					level: newLevel,
					rageLevel: prev.rageLevel,
					deathSequence: true,
					deathStartTime: Date.now(),
				};
			}

			// Rage decays slowly on its own — events bump it up
			const rageDecay = 0.87 * deltaTime; // loses ~0.87% per second
			const newRageLevel = Math.min(100, Math.max(0, prev.rageLevel - rageDecay));

			return {
				...prev,
				score: newScore,
				level: newLevel,
				rageLevel: newRageLevel,
			};
		});
	};

	// Get heat map color based on rage level (0-100)
	const getRageColor = (rageLevel: number): string => {
		// Green (0%) → Yellow (33%) → Orange (66%) → Red (100%)
		if (rageLevel < 33) {
			// Green to Yellow transition
			const t = rageLevel / 33;
			return `rgb(${Math.round(34 + t * 185)}, ${Math.round(197 + t * 24)}, ${Math.round(94 - t * 94)})`;
		} else if (rageLevel < 66) {
			// Yellow to Orange transition
			const t = (rageLevel - 33) / 33;
			return `rgb(${Math.round(219 + t * 32)}, ${Math.round(221 - t * 81)}, 0)`;
		} else {
			// Orange to Red transition
			const t = (rageLevel - 66) / 34;
			return `rgb(${Math.round(251 - t * 12)}, ${Math.round(140 - t * 57)}, 0)`;
		}
	};

	const handleAgeSubmit = () => {
		const age = parseInt(ageInput);
		if (!isNaN(age) && age > 0 && age < 150) {
			setGameState(prev => ({
				...prev,
				playerAge: age,
				showAgeInput: false,
				timeStarted: Date.now(),
			}));
			setAgeInput("");
		}
	};

	const restartGame = () => {
		// Clear behavior system
		behaviorSystemRef.current.clear();

		// Clear obstacles and projectiles — dispose GPU resources
		obstaclesRef.current.forEach((obs) => { disposeMesh(obs.mesh); sceneRef.current?.remove(obs.mesh); });
		obstaclesRef.current = [];
		projectilesRef.current.forEach((proj) => {
			disposeMesh(proj.mesh);
			sceneRef.current?.remove(proj.mesh);
			sceneRef.current?.remove(proj.light);
		});
		projectilesRef.current = [];
		motesRef.current.forEach((mote) => { disposeMesh(mote.mesh); sceneRef.current?.remove(mote.mesh); });
		motesRef.current = [];
		if (flockRef.current) {
			disposeMesh(flockRef.current.leader);
			sceneRef.current?.remove(flockRef.current.leader);
			for (const m of flockRef.current.members) {
				disposeMesh(m.mesh);
				sceneRef.current?.remove(m.mesh);
			}
			flockRef.current = null;
		}
		corkscrewGroupsRef.current.forEach((group) => {
			group.obstacles.forEach((obs) => {
					const beh = (obs.mesh as unknown as { _behavior?: BehaviorState })?._behavior;
					if (beh) behaviorSystemRef.current.unregister(beh);
					disposeMesh(obs.mesh);
					sceneRef.current?.remove(obs.mesh);
				});
		});
		corkscrewGroupsRef.current = [];
		rollingSpheresRef.current.forEach((sphere) => { disposeMesh(sphere.mesh); sceneRef.current?.remove(sphere.mesh); });
		rollingSpheresRef.current = [];
		quarkPairsRef.current.forEach((pair) => {
			disposeMesh(pair.meshA);
			disposeMesh(pair.meshB);
			sceneRef.current?.remove(pair.meshA);
			sceneRef.current?.remove(pair.meshB);
			if (pair.behaviorA) behaviorSystemRef.current.unregister(pair.behaviorA);
			if (pair.behaviorB) behaviorSystemRef.current.unregister(pair.behaviorB);
		});
		quarkPairsRef.current = [];
		shatterFragmentsRef.current.forEach((frag) => {
			disposeMesh(frag.meshA);
			disposeMesh(frag.meshB);
			sceneRef.current?.remove(frag.meshA);
			sceneRef.current?.remove(frag.meshB);
		});
		shatterFragmentsRef.current = [];
		fogBanksRef.current.forEach((bank) => {
			for (const disc of bank.discs) {
				sceneRef.current?.remove(disc);
				(disc.material as THREE.Material).dispose();
			}
		});
		fogBanksRef.current = [];
		fogSpawnTimerRef.current = 0; // spawn opening fog on restart

		// Clear all key states to prevent stuck movement
		keysRef.current = {};

		// Reset game state
		setGameState({
			score: 0,
			level: 1,
			shields: 5,
			timeStarted: Date.now(),
			isGameOver: false,
			isPaused: false,
			damageFlash: 0,
			playerAge: null,
			maxAge: 80 + Math.floor(Math.random() * 41),
			showAgeInput: true,
			rageLevel: 0,
			collisionCount: 0,
			deathSequence: false,
			deathStartTime: 0,
		});
		setAgeInput("");

		// Reset story modal (skip if setting is on)
		setShowStoryModal(!usePilotStore.getState().settings.skipIntro);
		setStoryStarted(false);
		setStoryText("");
		setShowContinueButton(false);

		// Stop playlist (will restart when game scene re-initializes)
		if (playlistManagerRef.current) {
			playlistManagerRef.current.stop();
		}

		// Reset spaceship position and scale (death sequence shrinks it)
		if (spaceshipRef.current) {
			spaceshipRef.current.position.set(0, 0, 0);
			spaceshipRef.current.scale.setScalar(1);
		}
	};

	const timeSurvived = gameState.isGameOver
		? Math.floor((Date.now() - gameState.timeStarted) / 1000)
		: Math.floor((Date.now() - gameState.timeStarted) / 1000);

	// Calculate duration (1 minute = 1 year, so 60 seconds = 1 year)
	const durationInYears = Math.floor(timeSurvived / 60);
	const durationMonths = Math.floor((timeSurvived % 60) / 5); // 5 sec = 1 month
	const durationDays = Math.floor(((timeSurvived % 60) % 5) / 5 * 30); // remaining as days
	const durationStr = durationInYears > 0
		? `${durationInYears}Y.${String(durationMonths).padStart(2, "0")}M.${String(durationDays).padStart(2, "0")}D`
		: `${durationMonths}M.${String(durationDays).padStart(2, "0")}D`;

	// Calculate current age
	const currentAge = gameState.playerAge !== null ? gameState.playerAge + durationInYears : 0;

	// Speed display: each panel = 5 z-units = 10km, speed is z-units/sec → km/s = speed * 2
	const displaySpeed = speedRef.current * 2;

	return (
		<div className="relative w-full h-screen bg-zinc-900">
			{/* Game Canvas */}
			<div ref={canvasRef} className="w-full h-full" />

			{/* Vignette Effect */}
			<div className="absolute inset-0 pointer-events-none bg-gradient-radial from-transparent via-transparent to-black/40" style={{
				background: 'radial-gradient(ellipse at center, transparent 0%, transparent 50%, rgba(0,0,0,0.4) 100%)'
			}} />

			{/* Damage Flash Effect */}
			{gameState.damageFlash > 0 && (
				<div
					className="absolute inset-0 pointer-events-none bg-red-600/30 animate-pulse"
					style={{ opacity: gameState.damageFlash }}
				/>
			)}

			{/* HUD - Spaceship Readout */}
			{!gameState.isGameOver && !gameState.deathSequence && !gameState.showAgeInput && (
				<div className="absolute inset-0 pointer-events-none">
					{/* Top Status Bar */}
					<div className="absolute top-0 left-0 right-0 h-12 bg-gradient-to-b from-cyan-950/90 to-cyan-950/40 backdrop-blur-sm border-b border-cyan-500/30">
						<div className="flex items-center justify-between h-full px-4">
							{/* Left — settings & status */}
							<div className="flex items-center gap-3 font-mono text-xs tracking-wider">
								<PilotSettings currentAge={currentAge} />
								<div className="flex items-center gap-1.5">
									<div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
									<span className="text-green-400/70 text-[9px] tracking-widest">SYS.OK</span>
								</div>
							</div>

							{/* Center — Duration, Speed, Rage readouts */}
							<div className="flex items-center gap-5">
								{/* Duration readout */}
								<div className="flex flex-col items-center">
									<div className="font-mono text-[8px] tracking-[0.2em] text-cyan-500/40">MISSION.DURATION</div>
									<div className="font-mono text-sm tracking-widest text-cyan-300 tabular-nums">{durationStr}</div>
								</div>

								<div className="w-px h-7 bg-cyan-500/20" />

								{/* Speed readout */}
								<div className="flex flex-col items-center">
									<div className="font-mono text-[8px] tracking-[0.2em] text-cyan-500/40">VELOCITY</div>
									<div className="font-mono text-sm tracking-widest text-cyan-300" style={{ fontVariantNumeric: 'tabular-nums' }}><span style={{ display: 'inline-block', width: '3.5ch', textAlign: 'right' }}>{displaySpeed.toFixed(1)}</span><span className="text-[9px] text-cyan-500/50 ml-0.5">km/s</span></div>
								</div>

								<div className="w-px h-7 bg-cyan-500/20" />

								{/* Entity Rage meter */}
								<div className="flex flex-col items-center">
									<div className="font-mono text-[8px] tracking-[0.2em] text-cyan-500/40">ENTITY.RAGE</div>
									<div className="flex items-center gap-1.5">
										<div className="flex items-center gap-px h-4 bg-black/60 px-0.5 rounded-sm border border-cyan-500/20">
											{[...Array(20)].map((_, i) => {
												const threshold = (i / 20) * 100;
												const isActive = gameState.rageLevel > threshold;
												return (
													<div
														key={i}
														className="w-1 h-3 transition-all duration-200"
														style={{
															backgroundColor: isActive
																? `rgba(239, 68, 68, ${0.5 + (i / 20) * 0.5})`
																: 'rgba(239, 68, 68, 0.08)',
														}}
													/>
												);
											})}
										</div>
										<div className="font-mono text-[10px] tracking-wider text-cyan-400/70 tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>
											<span className="text-cyan-400/70 w-7 inline-block text-right">{Math.round(gameState.rageLevel)}%</span>
											<span className="text-cyan-500/40 ml-1">{gameState.collisionCount}x</span>
										</div>
									</div>
								</div>
							</div>

							{/* Right — title & playlist */}
							<div className="flex items-center gap-3">
								<div className="font-mono text-[9px] text-cyan-500/30 tracking-[0.2em]">
									RAMA.31/39
								</div>
								<PlaylistSettings currentTrackId={currentTrackId} onPlayTrack={(id) => playlistManagerRef.current?.playTrackById(id)} />
							</div>
						</div>
					</div>

					{/* Bottom Scanlines Effect */}
					<div className="absolute inset-0 pointer-events-none" style={{
						backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(6, 182, 212, 0.03) 2px, rgba(6, 182, 212, 0.03) 4px)',
					}} />
				</div>
			)}

			{/* Retro Radio — 1980s car stereo style, slideable */}
			{!gameState.isGameOver && !gameState.deathSequence && !gameState.showAgeInput && (
				<div className="absolute bottom-0 left-1/2 -translate-x-1/2 pointer-events-auto flex flex-col items-center transition-transform duration-300 ease-in-out" style={{ transform: `translate(-50%, ${radioOpen ? '0px' : '60px'})` }}>
					{/* Toggle tab */}
					<button
						onClick={() => setRadioOpen(!radioOpen)}
						className="mb-[-1px] px-4 py-[2px] bg-gradient-to-b from-zinc-700 to-zinc-800 border border-zinc-600/50 border-b-0 rounded-t-sm font-mono text-[7px] tracking-[0.3em] text-cyan-500/40 hover:text-cyan-400/60 transition-colors"
					>
						{radioOpen ? '▼ RADIO' : '▲ RADIO'}
					</button>
					<div className="relative bg-gradient-to-b from-zinc-800 to-zinc-950 border border-zinc-600/60 rounded-sm shadow-xl shadow-black/60 mb-4" style={{ width: 320, padding: '6px 8px 8px' }}>
						{/* Chrome trim top */}
						<div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-300/30 to-transparent" />
						{/* Display window */}
						<div className="bg-black/80 border border-zinc-700/50 rounded-sm px-3 py-1.5 mb-1.5" style={{ boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.8)' }}>
							<div className="flex items-center justify-between">
								<div className="font-mono text-[8px] tracking-[0.2em] text-cyan-600/50">259.7 MHz</div>
								<div className="font-mono text-[9px] tracking-wider text-cyan-400/70 truncate max-w-[180px]">
									{currentTrackId
										? playlistTracks.find(t => t.id === currentTrackId)?.name?.toUpperCase() ?? '---'
										: activePlaylist?.name?.toUpperCase() ?? '---'}
								</div>
								{/* 3-band level meter */}
								<div className="flex items-end gap-[2px] h-[14px]">
									{[bassEnergyRef.current, midEnergyRef.current, trebleEnergyRef.current].map((energy, bandIdx) => {
										const bars = 5;
										const level = Math.round(energy * bars);
										return (
											<div key={bandIdx} className="flex flex-col-reverse gap-[1px]">
												{[...Array(bars)].map((_, barIdx) => (
													<div
														key={barIdx}
														className="rounded-[0.5px] transition-opacity duration-75"
														style={{
															width: 3,
															height: 2,
															backgroundColor: barIdx >= bars - 1 ? 'rgba(239,68,68,0.8)' : barIdx >= bars - 2 ? 'rgba(250,204,21,0.7)' : 'rgba(34,211,238,0.6)',
															opacity: barIdx < level ? 1 : 0.1,
														}}
													/>
												))}
											</div>
										);
									})}
								</div>
							</div>
							{/* Tuner bar */}
							<div className="mt-1 h-[1px] bg-cyan-900/30 relative">
								<div
									className="absolute top-[-1px] h-[3px] w-[3px] rounded-full bg-cyan-400/80"
									style={{
										left: `${Math.max(5, Math.min(95, ((playlistActiveIndex + 1) / Math.max(1, playlistPlaylists.length)) * 100))}%`,
										boxShadow: '0 0 4px rgba(34,211,238,0.4)',
									}}
								/>
								{/* Frequency marks */}
								{[...Array(12)].map((_, i) => (
									<div key={i} className="absolute top-0 h-[1px] w-[1px] bg-cyan-700/30" style={{ left: `${(i + 1) * 8}%` }} />
								))}
							</div>
						</div>
						{/* Preset buttons row */}
						<div className="flex items-center gap-1">
							{/* Mute knob */}
							<button
								onClick={() => setMusicMuted(!musicMuted)}
								className="group flex-shrink-0 w-6 h-6 rounded-full border border-zinc-600/50 bg-gradient-to-b from-zinc-700 to-zinc-900 flex items-center justify-center hover:border-cyan-500/40 active:bg-zinc-800 transition-colors cursor-pointer"
								style={{ boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.05), 0 1px 3px rgba(0,0,0,0.5)' }}
								title={musicMuted ? "Unmute music" : "Mute music"}
							>
								{musicMuted ? (
									<svg className="w-3 h-3 text-red-400/70" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
										<path d="M8 3L4 6H2v4h2l4 3V3z" fill="currentColor" />
										<line x1="12" y1="5" x2="12" y2="11" strokeLinecap="round" />
										<line x1="10" y1="7" x2="14" y2="7" strokeLinecap="round" className="rotate-45 origin-center" style={{ transformOrigin: '12px 8px', transform: 'rotate(45deg)' }} />
										<line x1="10" y1="9" x2="14" y2="9" strokeLinecap="round" style={{ transformOrigin: '12px 8px', transform: 'rotate(-45deg)' }} />
									</svg>
								) : (
									<>
										<div className="w-[1px] h-2 bg-cyan-500/40 -translate-y-[1px] group-hover:hidden" />
										<svg className="w-3 h-3 text-cyan-400/70 hidden group-hover:block" viewBox="0 0 16 16" fill="currentColor">
											<path d="M8 3L4 6H2v4h2l4 3V3z" />
											<path d="M11 5.5c.8.8.8 2.2 0 3M12.5 4c1.5 1.5 1.5 4 0 5.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
										</svg>
									</>
								)}
							</button>
							{/* 9 preset buttons — each maps to a playlist */}
							<div className="flex-1 flex gap-[3px]">
								{[...Array(9)].map((_, i) => {
									const playlist = playlistPlaylists[i];
									const isActive = i === playlistActiveIndex;
									return (
										<button
											key={i}
											onClick={() => {
												if (playlist) {
													setActivePlaylist(i);
													// Start playing from the new playlist
													if (playlistManagerRef.current) {
														const tracks = playlist.trackIds
															.map((id) => playlistTracks.find((t) => t.id === id))
															.filter((t): t is NonNullable<typeof t> => t != null && !!t.src && !t.unavailable);
														playlistManagerRef.current.updatePlaylist(tracks, playlistVolume, playlist.shuffle);
														playlistManagerRef.current.fadeIn(8000);
													}
												}
											}}
											disabled={!playlist}
											className={`flex-1 h-6 rounded-[2px] font-mono text-[9px] font-bold transition-all duration-150 ${
												isActive
													? 'bg-cyan-900/60 text-cyan-300 border border-cyan-500/40 shadow-inner'
													: playlist
														? 'bg-zinc-800 text-cyan-500/50 border border-zinc-700/40 hover:bg-zinc-700/80 hover:text-cyan-400/70 active:bg-cyan-900/40'
														: 'bg-zinc-900/50 text-zinc-700/30 border border-zinc-800/30 cursor-default'
											}`}
											style={{ boxShadow: isActive ? 'inset 0 1px 4px rgba(0,0,0,0.6), 0 0 3px rgba(34,211,238,0.1)' : '0 1px 2px rgba(0,0,0,0.4)' }}
										>
											{i + 1}
										</button>
									);
								})}
							</div>
							{/* Skip knob */}
							<button
								onClick={() => playlistManagerRef.current?.next()}
								className="group flex-shrink-0 w-6 h-6 rounded-full border border-zinc-600/50 bg-gradient-to-b from-zinc-700 to-zinc-900 flex items-center justify-center hover:border-cyan-500/40 active:bg-zinc-800 transition-colors cursor-pointer"
								style={{ boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.05), 0 1px 3px rgba(0,0,0,0.5)' }}
								title="Next track"
							>
								<div className="w-[1px] h-2 bg-cyan-500/40 rotate-45 -translate-y-[1px] group-hover:hidden" />
								<svg className="w-3 h-3 text-cyan-400/70 hidden group-hover:block" viewBox="0 0 12 12" fill="currentColor">
									<polygon points="1,1 8,6 1,11" />
									<rect x="9" y="1" width="2" height="10" />
								</svg>
							</button>
						</div>
						{/* Chrome trim bottom */}
						<div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-zinc-500/20 to-transparent" />
					</div>
				</div>
			)}

			{/* Story Modal */}
			{showStoryModal && (
				<div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm">
					<Card className="w-full max-w-md p-6 bg-gradient-to-b from-cyan-950/90 to-zinc-900 border-cyan-500/30 glitch-modal">
						<div className="text-center space-y-4">
							<h1 className="text-2xl font-bold font-mono text-cyan-300 tracking-widest glitch-text">RAMA.ENCOUNTER</h1>

							{!storyStarted ? (
								<div className="pt-4">
									<Button
										onClick={() => setStoryStarted(true)}
										size="lg"
										className="w-full font-mono bg-cyan-900/80 hover:bg-cyan-800 text-cyan-100 border-cyan-500/30 animate-pulse"
									>
										begin transmission...
									</Button>
								</div>
							) : (
								<>
									<div className="font-mono text-sm text-cyan-300/90 tracking-wide text-left leading-relaxed space-y-2">
										{storyText.split('. ').map((sentence, i) => {
											if (!sentence.trim()) return null;
											const isLast = i === storyText.split('. ').length - 1;
											return (
												<div key={i}>
													{sentence}{!isLast && !sentence.endsWith('.') ? '.' : ''}
												</div>
											);
										})}
										<span className="inline-block w-2 h-4 bg-cyan-400 ml-1 animate-pulse" style={{ opacity: showContinueButton ? 0 : 1 }} />
									</div>

									{showContinueButton && (
										<div className="pt-2">
											<Button
												onClick={() => setShowStoryModal(false)}
												size="lg"
												className="w-full font-mono bg-cyan-900/80 hover:bg-cyan-800 text-cyan-100 border-cyan-500/30"
											>
												continue...
											</Button>
										</div>
									)}
								</>
							)}
						</div>
					</Card>
				</div>
			)}

			{/* Age Input Modal */}
			{!showStoryModal && gameState.showAgeInput && (
				<div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm">
					<Card className="w-full max-w-md p-8 bg-gradient-to-b from-cyan-950/90 to-zinc-900 border-cyan-500/30 glitch-modal">
						<div className="text-center space-y-6">
							<h1 className="text-2xl font-bold font-mono text-cyan-300 tracking-widest glitch-text">PILOT.INITIALIZATION</h1>
							<p className="font-mono text-cyan-400/80 tracking-wider glitch-text">ENTER.PILOT.AGE</p>

							<div className="space-y-4">
								<Input
									type="number"
									placeholder="Enter your age"
									value={ageInput}
									onChange={(e) => setAgeInput(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === 'Enter') {
											handleAgeSubmit();
										}
									}}
									className="text-center text-xl font-mono text-cyan-300 tracking-widest bg-cyan-950/20 border-cyan-500/30 placeholder:text-cyan-600/50 focus-visible:border-cyan-400 focus-visible:ring-cyan-500/50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
									autoFocus
								/>
								<Button onClick={handleAgeSubmit} size="lg" className="w-full font-mono bg-cyan-900/80 hover:bg-cyan-800 text-cyan-100 border-cyan-500/30">
									Initiate Encounter
								</Button>
							</div>
						</div>
					</Card>
				</div>
			)}

			{/* Game Over Screen — only after death sequence completes */}
			{gameState.isGameOver && !gameState.deathSequence && (
				<div className="absolute inset-0 flex items-center justify-center bg-black/85">
					<Card className="w-full max-w-md p-8 bg-gradient-to-b from-zinc-950/95 to-black/95 border-cyan-500/10">
						<div className="text-center space-y-6">
							<h1 className="text-lg font-mono text-cyan-300/50 tracking-[0.3em]">
								ALL CONTACT LOST
							</h1>

							<div className="space-y-3 text-cyan-400/30 font-mono text-xs tracking-wider">
								<div>LAST.KNOWN.AGE: {currentAge}</div>
								<div>MISSION.DURATION: {durationInYears} YEARS</div>
							</div>

							<p className="font-mono text-cyan-500/25 italic text-xs tracking-wider pt-2">
								You were never heard from again.
							</p>

							<div className="flex justify-center pt-4">
								<Button onClick={restartGame} size="lg" className="font-mono bg-cyan-900/50 hover:bg-cyan-800/70 text-cyan-200/70 border-cyan-500/20">
									New Pilot
								</Button>
							</div>
						</div>
					</Card>
				</div>
			)}
		</div>
	);
}
