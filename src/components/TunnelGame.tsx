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
import { BehaviorSystem, getMurmurationZBoost } from "@/game/behavior";
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
		deathSequence: false,
		deathStartTime: 0,
	});
	const [highScores, setHighScores] = useState<HighScoreModel[]>([]);
	const [showHighScores, setShowHighScores] = useState(false);
	const [ageInput, setAgeInput] = useState("");
	const [showStoryModal, setShowStoryModal] = useState(true);
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
	const behaviorSystemRef = useRef<BehaviorSystem>(new BehaviorSystem());
	const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
	const playlistTracks = usePlaylistStore((s) => s.tracks);
	const playlistVolume = usePlaylistStore((s) => s.volume);
	const playlistShuffle = usePlaylistStore((s) => s.shuffle);
	const hydrateBlobs = usePlaylistStore((s) => s.hydrateBlobs);

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
	const manualOverrideRef = useRef(0); // timestamp of last manual input
	const cameraShakeRef = useRef(0); // current shake intensity, decays each frame
	const speedRef = useRef(0); // current game speed in z-units/sec for HUD
	const bassEnergyRef = useRef(0); // smoothed bass energy 0-1 from audio analyser
	const spikeRef = useRef(0); // current amplitude spike intensity, decays fast

	const lastCorkscrewSpawnRef = useRef(0);

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
		pm.updatePlaylist(playlistTracks, playlistVolume, playlistShuffle);
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

	// Initialize and play collision sound effect
	const playCollisionSound = () => {
		const sound = new Audio(bombAudio);
		sound.volume = sfxLevelsRef.current.collision;
		sound.play().catch(() => {});
	};

	const playFlareHitSound = () => {
		const sound = new Audio(bombAudio);
		sound.volume = sfxLevelsRef.current.flareHit;
		sound.play().catch(() => {});
	};


	// Start playlist when game scene is ready
	useEffect(() => {
		if (gameState.showAgeInput || showStoryModal || gameState.isGameOver) return;
		startGameAudio();
	}, [gameState.showAgeInput, showStoryModal, gameState.isGameOver]);

	// Keep playlist in sync when user changes settings mid-game
	useEffect(() => {
		if (playlistManagerRef.current) {
			playlistManagerRef.current.updatePlaylist(playlistTracks, playlistVolume, playlistShuffle);
		}
	}, [playlistTracks, playlistVolume, playlistShuffle]);

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
		if (!canvasRef.current || gameState.isGameOver || gameState.showAgeInput || showStoryModal) return;

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

			// After game over, keep rendering the dim tunnel but don't update game logic
			if (gameStateRef.current.isGameOver && !gameStateRef.current.deathSequence) {
				// Just render static scene with dim lighting
				renderer.render(scene, camera);
				animationFrameRef.current = requestAnimationFrame(gameLoop);
				return;
			}

			updateGame(deltaTime);

			// Slow lighting cycle — two sine waves at different speeds
			// for an organic, unpredictable feel. Mostly dark, occasional swells.
			const t = currentTime / 1000;
			const cycle = 0.5 + 0.5 * Math.sin(t * 0.15) * Math.sin(t * 0.07 + 1.3);
			// cycle is 0–1, where 0 = darkest, 1 = brightest
			let ambientIntensity = 0.04 + cycle * 0.08;
			let directionalIntensity = 0.1 + cycle * 0.5;
			let rimIntensity = 0.05 + cycle * 0.25;

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
					// Accelerate forward (negative z)
					const flySpeed = progress * progress * 30; // accelerating
					ship.position.z -= flySpeed * (currentTime - lastTime) / 1000;
					// Drift gently to center
					ship.position.x *= 0.97;
					ship.position.y *= 0.97;
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
	}, [gameState.isGameOver, gameState.showAgeInput, showStoryModal]);

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

	const getTunnelRadius = (segmentIndex: number): number => {
		const baseRadius = 5;
		const level = gameStateRef.current.level;
		// Gradual narrowing: 5% per level, minimum 60% of original
		const narrowing = Math.max(0.6, 1 - (level - 1) * 0.05);
		return baseRadius * narrowing;
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

		// Position on the inner surface of the tunnel (slightly inside to ensure visibility)
		const tunnelRadius = getTunnelRadius(Math.floor(-zPosition / 5));
		const radius = tunnelRadius * 0.8; // 80% of tunnel radius to sit on surface

		// Calculate position
		const x = Math.cos(angle) * radius;
		const y = Math.sin(angle) * radius;

		// Random size: 1x to 4x base scale
		const sizeMultiplier = 1 + Math.random() * 3;

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

	const createQuarkPair = (zPosition: number): QuarkPair => {
		const createShardMesh = (): THREE.Mesh => {
			if (shardModelRef.current) {
				const modelClone = shardModelRef.current.clone();
				modelClone.scale.set(1.2, 1.2, 1.2);
				// Add subtle emissive glow to all meshes so they're visible in the tunnel
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
			const geometry = new THREE.CylinderGeometry(0.08, 0.08, 0.8, 6);
			const material = new THREE.MeshStandardMaterial({
				color: 0x998877,
				emissive: 0x554433,
				emissiveIntensity: 0.4,
			});
			const mesh = new THREE.Mesh(geometry, material);
			mesh.position.set(0, 0, zPosition);
			sceneRef.current?.add(mesh);
			return mesh;
		};

		const meshA = createShardMesh();
		const meshB = createShardMesh();

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

		const baseRadius = 0.3 + Math.random() * 0.2; // 0.3-0.5 units — close but visible gap

		return {
			meshA,
			meshB,
			zPosition,
			birthTime: Date.now(),
			orbitAngle: Math.random() * Math.PI * 2,
			orbitRadius: baseRadius,
			baseOrbitRadius: baseRadius,
			orbitSpeed: 1.2 + Math.random() * 0.8, // 1.2-2.0 rad/s — slow ominous tumble
			centerX,
			centerY,
			driftPhase: "orbit",
			driftStartTime: 0,
			nextDriftTime: Date.now() + 5000 + Math.random() * 8000, // first drift 5-13s after spawn
			maxDriftRadius: baseRadius * 3 + Math.random() * baseRadius * 2, // 3-5x base for the confinement snap
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
		const rotSpeed = 0.5 + Math.random() * 3.5; // 0.5-4.0 rad/s

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

				if (autopilotStrength > 0.01) {
					const shipPos = spaceshipRef.current.position;
					const ap = autopilotVelRef.current;

					// Find nearest threat directly in our path
					let nearestDist = Infinity;
					let threatX = 0;
					let threatY = 0;
					const dangerZone = 8;
					const dangerXY = 2.0;

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

					// Gentle center pull when clear
					if (nearestDist === Infinity) {
						desiredX -= shipPos.x * 0.5;
						desiredY -= shipPos.y * 0.5;
					}

					const blend = 2.0 * deltaTime;
					ap.x += (desiredX - ap.x) * blend;
					ap.y += (desiredY - ap.y) * blend;

					spaceshipRef.current.position.x += ap.x * deltaTime * autopilotStrength;
					spaceshipRef.current.position.y += ap.y * deltaTime * autopilotStrength;
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
		if (Math.abs(kb.spin) > 0.01) {
			spaceshipRef.current.rotation.z += kb.spin * deltaTime;
			kb.spin *= 0.96;
		} else if (Math.abs(spaceshipRef.current.rotation.z) > 0.01) {
			// Gradually return to upright
			spaceshipRef.current.rotation.z *= 0.92;
		}

		// Constrain spaceship to tunnel — bounce off walls with knockback + camera shake
		const distFromCenter = Math.sqrt(
			spaceshipRef.current.position.x ** 2 + spaceshipRef.current.position.y ** 2
		);
		if (distFromCenter > tunnelRadius) {
			const angle = Math.atan2(spaceshipRef.current.position.y, spaceshipRef.current.position.x);
			// Push back inside
			spaceshipRef.current.position.x = Math.cos(angle) * (tunnelRadius - 0.15);
			spaceshipRef.current.position.y = Math.sin(angle) * (tunnelRadius - 0.15);
			// Bounce inward — strength based on how fast you were going outward
			const bounceStrength = 4 + Math.abs(kb.vx + kb.vy) * 0.3;
			knockbackRef.current.vx = -Math.cos(angle) * bounceStrength;
			knockbackRef.current.vy = -Math.sin(angle) * bounceStrength;
			knockbackRef.current.spin += (Math.random() - 0.5) * 3;
			// Camera shake
			cameraShakeRef.current = 0.15;
			// Subtle flash
			setGameState((prev) => ({ ...prev, damageFlash: 0.1 }));
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
		// Heavy smoothing for organic "bop" feel — slow rise, slow fall
		const prevBass = bassEnergyRef.current;
		const bassBlend = bassRaw > prevBass ? 0.08 : 0.04; // rise slightly faster than fall
		bassEnergyRef.current += (bassRaw - prevBass) * bassBlend;
		audioAmplitudeRef.current = midRaw > 0.01
			? 0.3 + midRaw * 0.4
			: 0.3 + 0.2 * Math.sin(Date.now() / 500); // fallback sine when no audio

		// Detect amplitude spikes for cube pulse
		const reactivity = pilot.musicReactivity ?? 1.0;
		const combinedEnergy = bassRaw * 0.6 + midRaw * 0.4;
		// Use raw energy delta (not smoothed) so spikes are actually detected
		const spike = Math.max(0, combinedEnergy - prevBass - 0.02);
		// Slower decay (0.92) so pulse is visible longer, stronger attack
		spikeRef.current = Math.max(spikeRef.current * 0.92, spike * 5 * reactivity);


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
			quarkShardPositions: quarkPairsRef.current.flatMap((pair) => {
				const center = new THREE.Vector3(pair.centerX, pair.centerY, pair.zPosition);
				return [center];
			}),
			globalMood: { avgAnger: 0, avgFear: 0, avgExcitement: 0 },
		};
		behaviorSystemRef.current.update(behaviorCtx);

		// Spawn obstacles - starts sparse, increases gradually
		// Level 1: ~1.5% chance, Level 5: ~3.5% chance, Level 10: ~6% chance
		const density = pilot.entityDensity;
		const baseSpawnChance = 0.015;
		const spawnChanceIncrease = state.level * 0.005;
		const spawnChance = Math.min(0.08, baseSpawnChance + spawnChanceIncrease) * density;

		if (Math.random() < spawnChance) {
			const obstacle = createObstacle(-50);
			obstaclesRef.current.push(obstacle);
		}

		// Spawn atmospheric motes - constant gentle flow
		if (Math.random() < 0.08 * density) {
			const mote = createMote(-50);
			motesRef.current.push(mote);
		}

		// Spawn corkscrew groups - only after year 1, then once per year
		const currentTimeSurvived = (Date.now() - state.timeStarted) / 1000;
		const yearsLived = Math.floor(currentTimeSurvived / 60);

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

		if (shouldSpawnCorkscrew) {
			const group = createCorkscrewGroup(-60);
			corkscrewGroupsRef.current.push(group);
			lastCorkscrewSpawnRef.current = currentTimeSurvived;
		}

		// Spawn quark pairs — from 30s onwards, up to 2 active
		if (currentTimeSurvived >= 30 && quarkPairsRef.current.length < 2 && Math.random() < 0.008 * density) {
			const pair = createQuarkPair(-55 - Math.random() * 10);
			quarkPairsRef.current.push(pair);
		}

		// Spawn rolling spheres - frequency based on current year
		// Year 1: only 1 (and not before 30 seconds)
		// Year 2: 2 total
		// Year 3: 3 total
		// Year 4+: random 1-6 per year
		const activeRollingSpheres = rollingSpheresRef.current.length;
		let targetRollingSpheres = 0;

		if (yearsLived === 0) {
			// First year (0-60 seconds): only 1 sphere, and only after 30 seconds
			if (currentTimeSurvived >= 30) {
				targetRollingSpheres = 1;
			}
		} else if (yearsLived === 1) {
			// Second year: 2 spheres
			targetRollingSpheres = 2;
		} else if (yearsLived === 2) {
			// Third year: 3 spheres
			targetRollingSpheres = 3;
		} else {
			// Year 4+: random 1-6 spheres
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
				sceneRef.current?.remove(sphere.mesh);
				return false;
			}

			// Update angle for spiral motion around the tunnel
			sphere.angle += sphere.angularVelocity * deltaTime;

			// Update radius based on current tunnel segment
			const currentTunnelRadius = getTunnelRadius(Math.floor(-sphere.zPosition / 5));
			const baseRadius = currentTunnelRadius * 0.8;

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
					const rageIncrease = 4 + Math.random() * 3;
					return { ...prev, damageFlash: 0.5, rageLevel: Math.min(100, prev.rageLevel + rageIncrease) };
				});

				// Remove the sphere on collision
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
				sceneRef.current?.remove(pair.meshA);
				sceneRef.current?.remove(pair.meshB);
				return false;
			}

			const now = Date.now();

			// Quark drift/snap state machine
			if (pair.driftPhase === "orbit" && now >= pair.nextDriftTime) {
				pair.driftPhase = "drifting";
				pair.driftStartTime = now;
			} else if (pair.driftPhase === "drifting") {
				const driftDuration = 2500; // 2.5s to drift apart
				const driftProgress = Math.min(1, (now - pair.driftStartTime) / driftDuration);
				// Ease out — fast at first, slows down (like stretching a spring)
				const ease = 1 - (1 - driftProgress) * (1 - driftProgress);
				pair.orbitRadius = pair.baseOrbitRadius + (pair.maxDriftRadius - pair.baseOrbitRadius) * ease;

				if (driftProgress >= 1) {
					pair.driftPhase = "snapping";
					pair.driftStartTime = now;
				}
			} else if (pair.driftPhase === "snapping") {
				const snapDuration = 300; // 0.3s snap back — sudden!
				const snapProgress = Math.min(1, (now - pair.driftStartTime) / snapDuration);
				// Ease in — accelerates (like a spring release)
				const ease = snapProgress * snapProgress * snapProgress;
				pair.orbitRadius = pair.maxDriftRadius - (pair.maxDriftRadius - pair.baseOrbitRadius) * ease;

				if (snapProgress >= 1) {
					pair.orbitRadius = pair.baseOrbitRadius;
					pair.driftPhase = "orbit";
					pair.nextDriftTime = now + 5000 + Math.random() * 8000; // next drift 5-13s
				}
			}

			// Advance helix orbit
			pair.orbitAngle += pair.orbitSpeed * deltaTime;

			// Position each shard on opposite sides of the orbit
			const ax = pair.centerX + Math.cos(pair.orbitAngle) * pair.orbitRadius;
			const ay = pair.centerY + Math.sin(pair.orbitAngle) * pair.orbitRadius;
			const bx = pair.centerX + Math.cos(pair.orbitAngle + Math.PI) * pair.orbitRadius;
			const by = pair.centerY + Math.sin(pair.orbitAngle + Math.PI) * pair.orbitRadius;

			pair.meshA.position.x = ax;
			pair.meshA.position.y = ay;
			pair.meshB.position.x = bx;
			pair.meshB.position.y = by;

			// Slow ominous tumble — each shard rotates lazily
			pair.meshA.rotation.x += deltaTime * 0.8;
			pair.meshA.rotation.z += deltaTime * 0.5;
			pair.meshB.rotation.x -= deltaTime * 0.6;
			pair.meshB.rotation.z -= deltaTime * 0.9;

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
						sceneRef.current?.remove(obs.mesh);
					});

					// RAGE SPIKE from corkscrew explosion
					setGameState((prev) => {
						const rageSpike = 20 + Math.random() * 10;
						return { ...prev, damageFlash: 0.8, rageLevel: Math.min(100, prev.rageLevel + rageSpike) };
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
				sceneRef.current?.remove(obstacle.mesh);
				return false;
			}

			// Apply behavior-driven position (x/y from behavior system)
			if (obstacle.behavior) {
				obstacle.mesh.position.x = obstacle.behavior.position.x;
				obstacle.mesh.position.y = obstacle.behavior.position.y;
			}

			// Music pulse — cubes breathe with bass + twitch on spikes
			const bassPulse = bassEnergyRef.current * 0.15 * reactivity; // gentle swell with bass
			const spikePulse = spikeRef.current * 0.6; // visible pop on amplitude spikes
			const pulse = 1 + bassPulse + spikePulse;
			obstacle.mesh.scale.set(pulse, pulse, pulse);

			// Slow rolling rotation
			const rollSpeed = 0.3;
			obstacle.mesh.rotation.x += rollSpeed * deltaTime;
			obstacle.mesh.rotation.y += rollSpeed * deltaTime * 0.7;
			obstacle.mesh.rotation.z += rollSpeed * deltaTime * 0.5;

			// Check collision with spaceship
			const dist = obstacle.mesh.position.distanceTo(spaceshipRef.current!.position);
			if (dist < 0.6) {
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
					return { ...prev, damageFlash: 0.3, rageLevel: Math.min(100, prev.rageLevel + rageIncrease) };
				});
			}

			// Anger visuals — scaled by global rage so low-rage hits are subtle
			const rageScale = Math.max(0.15, state.rageLevel / 100); // at least 15% visible
			if (obstacle.angerLevel > 0) {
				const timeSinceAnger = (currentTime - obstacle.angerTime) / 1000;
				obstacle.angerLevel = Math.max(0, 1 - timeSinceAnger / 6);
			}
			const moodAnger = obstacle.behavior?.mood.anger ?? 0;
			const rawAnger = Math.max(obstacle.angerLevel, moodAnger, state.rageLevel / 100);
			const effectiveAnger = rawAnger * rageScale;

			// Always update color — reset to base when calm, blend toward red when angry
			obstacle.mesh.traverse((child) => {
				if (child instanceof THREE.Mesh && child.material) {
					const material = child.material as THREE.MeshStandardMaterial;
					const baseColor = new THREE.Color(0x8b6f47);
					const angryColor = new THREE.Color(0xff3333);
					material.color.lerpColors(baseColor, angryColor, effectiveAnger);
					material.emissive.setRGB(effectiveAnger * 0.3, 0, 0);
				}
			});

			// Vibration and scale use rawAnger so the momentary pulse is always visible
			if (rawAnger > 0.01) {
				const vibrationAmount = rawAnger * 0.15;
				obstacle.mesh.position.x += Math.sin(currentTime / 50) * vibrationAmount;
				obstacle.mesh.position.y += Math.cos(currentTime / 50) * vibrationAmount;
			}

			const angryScale = 1 + rawAnger * 0.5;
			const combinedPulse = (1 + bassPulse + spikePulse) * angryScale;
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

			return true;
		});

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

		// Calculate rage level from environment
		// Sum up all obstacle anger levels and recent incidents
		let totalAnger = 0;
		let angryObstacleCount = 0;

		obstaclesRef.current.forEach((obstacle) => {
			if (obstacle.angerLevel > 0) {
				totalAnger += obstacle.angerLevel;
				angryObstacleCount++;
			}
		});

		// Calculate target rage level (0-100)
		// Base rage on: number of angry obstacles + their combined anger
		const angryObstacleFactor = Math.min(50, angryObstacleCount * 5); // Up to 50 from count
		const angerIntensityFactor = Math.min(50, totalAnger * 10); // Up to 50 from intensity
		const targetRage = angryObstacleFactor + angerIntensityFactor;

		// Update score based on distance
		setGameState((prev) => {
			// During death sequence, just advance the fade — no score/rage updates
			if (prev.deathSequence) {
				const deathElapsed = (Date.now() - prev.deathStartTime) / 1000;
				const DEATH_DURATION = 8;
				if (deathElapsed >= DEATH_DURATION) {
					return { ...prev, isGameOver: true };
				}
				return prev;
			}

			const newScore = prev.score + Math.floor(speed * deltaTime * 10);
			const newLevel = Math.floor(newScore / 1000) + 1;

			// Smooth rage level transitions
			let newRageLevel = prev.rageLevel;
			if (targetRage > prev.rageLevel) {
				newRageLevel = Math.min(100, prev.rageLevel + 40 * deltaTime);
				newRageLevel = Math.min(newRageLevel, targetRage);
			} else {
				newRageLevel = Math.max(0, prev.rageLevel - 10 * deltaTime);
				newRageLevel = Math.max(newRageLevel, targetRage);
			}

			// Check for death by old age
			const currentTimeSurvived = (Date.now() - prev.timeStarted) / 1000;
			const yearsLived = Math.floor(currentTimeSurvived / 60);
			const currentPlayerAge = (prev.playerAge || 0) + yearsLived;

			// Trigger death sequence: rage maxed out OR old age
			if ((newRageLevel >= 100 || currentPlayerAge >= prev.maxAge) && !prev.deathSequence) {
				saveHighScore();
				return {
					...prev,
					score: newScore,
					level: newLevel,
					rageLevel: newRageLevel,
					deathSequence: true,
					deathStartTime: Date.now(),
				};
			}

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

		// Clear obstacles and projectiles
		obstaclesRef.current.forEach((obs) => sceneRef.current?.remove(obs.mesh));
		obstaclesRef.current = [];
		projectilesRef.current.forEach((proj) => {
			sceneRef.current?.remove(proj.mesh);
			sceneRef.current?.remove(proj.light);
		});
		projectilesRef.current = [];
		motesRef.current.forEach((mote) => sceneRef.current?.remove(mote.mesh));
		motesRef.current = [];
		corkscrewGroupsRef.current.forEach((group) => {
			group.obstacles.forEach((obs) => {
					const beh = (obs.mesh as unknown as { _behavior?: BehaviorState })?._behavior;
					if (beh) behaviorSystemRef.current.unregister(beh);
					sceneRef.current?.remove(obs.mesh);
				});
		});
		corkscrewGroupsRef.current = [];
		rollingSpheresRef.current.forEach((sphere) => sceneRef.current?.remove(sphere.mesh));
		rollingSpheresRef.current = [];
		quarkPairsRef.current.forEach((pair) => {
			sceneRef.current?.remove(pair.meshA);
			sceneRef.current?.remove(pair.meshB);
			if (pair.behaviorA) behaviorSystemRef.current.unregister(pair.behaviorA);
			if (pair.behaviorB) behaviorSystemRef.current.unregister(pair.behaviorB);
		});
		quarkPairsRef.current = [];
		shatterFragmentsRef.current.forEach((frag) => {
			sceneRef.current?.remove(frag.meshA);
			sceneRef.current?.remove(frag.meshB);
		});
		shatterFragmentsRef.current = [];

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
			deathSequence: false,
			deathStartTime: 0,
		});
		setAgeInput("");

		// Reset story modal
		setShowStoryModal(true);
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

	// Calculate duration in years (1 minute = 1 year, so 60 seconds = 1 year)
	const durationInYears = Math.floor(timeSurvived / 60);

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
						<div className="flex items-center justify-between h-full px-6">
							<div className="flex items-center gap-4 font-mono text-xs tracking-wider">
								<PilotSettings currentAge={currentAge} />
								<div className="flex items-center gap-2">
									<div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
									<span className="text-green-400">SYS.ONLINE</span>
								</div>
								<div className="text-cyan-300">MISSION.TIME: {durationInYears}Y</div>
								<div className="text-cyan-300">{displaySpeed.toFixed(1)} km/s</div>
							</div>
							<div className="flex items-center gap-4">
								{/* Rage Meter - Heat Map */}
								<div className="flex items-center gap-3">
									<div className="font-mono text-xs text-cyan-400 tracking-widest">RAGE.LEVEL</div>
									<div className="flex items-center gap-0.5 h-5 bg-slate-900/50 px-1 rounded border border-cyan-500/20">
										{[...Array(20)].map((_, i) => {
											const threshold = (i / 20) * 100;
											const isActive = gameState.rageLevel > threshold;
											const barColor = getRageColor(threshold + 2.5);
											return (
												<div
													key={i}
													className="w-1.5 h-full transition-all duration-200 rounded-sm"
													style={{
														backgroundColor: isActive ? barColor : 'rgba(71, 85, 105, 0.3)',
														opacity: isActive ? 1 : 0.4,
													}}
												/>
											);
										})}
									</div>
									<div className="font-mono text-xs tracking-wider" style={{ color: getRageColor(gameState.rageLevel) }}>
										{Math.round(gameState.rageLevel)}%
									</div>
								</div>
								<div className="font-mono text-xs text-cyan-400 tracking-widest">
									RAMA.31/39.RENDEZVOUS
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

			{/* Controls Info */}
			{!gameState.isGameOver && !gameState.deathSequence && !gameState.showAgeInput && (
				<div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-slate-950/95 to-slate-900/95 backdrop-blur-md px-6 py-3 border border-cyan-500/30 pointer-events-none shadow-lg shadow-cyan-500/10">
					<div className="text-cyan-300 font-mono text-[10px] text-center tracking-widest">
						◄►▲▼: NAVIGATE | [SPACE]: DEPLOY.FLARE
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
				<div className="absolute inset-0 flex items-center justify-center bg-black/70">
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

							<div className="flex gap-3 justify-center pt-4">
								<Button onClick={restartGame} size="lg" className="font-mono bg-cyan-900/50 hover:bg-cyan-800/70 text-cyan-200/70 border-cyan-500/20">
									New Pilot
								</Button>
								<Button
									onClick={() => setShowHighScores(!showHighScores)}
									size="lg"
									variant="outline"
									className="font-mono border-cyan-500/20 text-cyan-400/50 hover:bg-cyan-950/50 hover:text-cyan-300/70"
								>
									{showHighScores ? "Hide" : "Show"} Records
								</Button>
							</div>

							{showHighScores && (
								<div className="mt-6 bg-cyan-950/30 rounded-lg p-4 border border-cyan-500/20">
									<h2 className="text-sm text-cyan-300/50 mb-3 font-mono tracking-wider">MISSION.RECORDS</h2>
									<div className="space-y-2 max-h-64 overflow-y-auto">
										{highScores.length === 0 ? (
											<div className="text-cyan-400/40 text-sm font-mono">NO.RECORDS.FOUND</div>
										) : (
											highScores.map((score, index) => (
												<div
													key={index}
													className="flex justify-between items-center text-cyan-300/60 font-mono text-sm bg-cyan-950/50 px-3 py-2 rounded border border-cyan-500/10"
												>
													<span className="font-bold text-cyan-400/50">#{index + 1}</span>
													<span>{score.player_name}</span>
													<span>{score.score} pts</span>
													<span className="text-cyan-400/40">Lvl {score.level_reached}</span>
												</div>
											))
										)}
									</div>
								</div>
							)}
						</div>
					</Card>
				</div>
			)}
		</div>
	);
}
