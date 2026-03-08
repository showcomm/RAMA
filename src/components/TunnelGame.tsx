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
import { PlaylistSettings } from "@/components/PlaylistSettings";
import geometricModelUrl from "@/assets/geometric_o.glb?url";
import torusModelUrl from "@/assets/torus_shap_1208213451_texture.glb?url";
import orbModelUrl from "@/assets/orb_shaped_1208213459_texture.glb?url";

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
	flybyAudio: HTMLAudioElement | null; // Audio that plays 5 seconds after spawn
	flybyPlayCount: number; // How many times the flyby has played
	lastFlybyEndTime: number; // When the last flyby finished playing
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
	});
	const [highScores, setHighScores] = useState<HighScoreModel[]>([]);
	const [showHighScores, setShowHighScores] = useState(false);
	const [ageInput, setAgeInput] = useState("");
	const [showStoryModal, setShowStoryModal] = useState(true);
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

	// Audio system refs
	const playlistManagerRef = useRef<PlaylistManager | null>(null);
	const proximitySoundRef = useRef<HTMLAudioElement | null>(null);
	const atmosphericAmbientRef = useRef<HTMLAudioElement | null>(null);
	const audioAmplitudeRef = useRef<number>(0);
	const knockbackRef = useRef<{ vx: number; vy: number; spin: number }>({ vx: 0, vy: 0, spin: 0 });
	const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
	const playlistTracks = usePlaylistStore((s) => s.tracks);
	const playlistVolume = usePlaylistStore((s) => s.volume);
	const playlistShuffle = usePlaylistStore((s) => s.shuffle);

	// Living behavior system - obstacles communicate through formation changes
	const behaviorStateRef = useRef<{
		mode: "scattered" | "clustered";
		transitionProgress: number;
		lastChangeTime: number;
		nextChangeDuration: number;
		clusterCenter: THREE.Vector3;
		lastCorkscrewSpawn?: number;
	}>({
		mode: "scattered",
		transitionProgress: 1,
		lastChangeTime: Date.now(),
		nextChangeDuration: 5000 + Math.random() * 3000, // 5-8 seconds
		clusterCenter: new THREE.Vector3(0, 0, -25),
		lastCorkscrewSpawn: 0,
	});

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
		pm.play();

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
	}, []);

	// Load high scores
	useEffect(() => {
		loadHighScores();
	}, []);

	// Typing effect for story modal
	useEffect(() => {
		if (!showStoryModal) return;

		const fullStoryText = "In the year 2139, Rama entered our solar system. Over 500 km in length, it appears to be on autopilot. Scouts exploring inside report an alien ecosystem of biomechanical creatures. They show no interest in humanity. No scout has ever returned from inside Rama.";

		let currentIndex = 0;
		const typingSpeed = 30; // milliseconds per character

		const typingInterval = setInterval(() => {
			if (currentIndex < fullStoryText.length) {
				setStoryText(fullStoryText.substring(0, currentIndex + 1));
				currentIndex++;
			} else {
				clearInterval(typingInterval);
				// Show button immediately after typing completes
				setShowContinueButton(true);
			}
		}, typingSpeed);

		return () => clearInterval(typingInterval);
	}, [showStoryModal]);

	// Monitor readout audio — plays during the story modal typing effect.
	// May be blocked on first load (no user gesture yet), that's fine.
	useEffect(() => {
		if (!showStoryModal) {
			if (atmosphericAmbientRef.current) {
				atmosphericAmbientRef.current.pause();
				atmosphericAmbientRef.current.currentTime = 0;
				atmosphericAmbientRef.current = null;
			}
			return;
		}

		const audio = new Audio(monitorReadoutAudio);
		audio.loop = true;
		audio.volume = 0.3;
		atmosphericAmbientRef.current = audio;
		audio.play().catch(() => {});

		return () => {
			audio.pause();
			atmosphericAmbientRef.current = null;
		};
	}, [showStoryModal]);

	// Stop audio when typing finishes (when continue button appears)
	useEffect(() => {
		if (showContinueButton && atmosphericAmbientRef.current) {
			atmosphericAmbientRef.current.pause();
			atmosphericAmbientRef.current.currentTime = 0;
		}
	}, [showContinueButton]);

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
		sound.volume = 0.15;
		sound.play().catch(() => {});
	};

	const playFlareHitSound = () => {
		const sound = new Audio(bombAudio);
		sound.volume = 0.10;
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
			if (gameStateRef.current.isGameOver || gameStateRef.current.isPaused) {
				animationFrameRef.current = requestAnimationFrame(gameLoop);
				return;
			}

			const currentTime = Date.now();
			const deltaTime = (currentTime - lastTime) / 1000;
			lastTime = currentTime;

			updateGame(deltaTime);

			// Slow lighting cycle — two sine waves at different speeds
			// for an organic, unpredictable feel. Mostly dark, occasional swells.
			const t = currentTime / 1000;
			const cycle = 0.5 + 0.5 * Math.sin(t * 0.15) * Math.sin(t * 0.07 + 1.3);
			// cycle is 0–1, where 0 = darkest, 1 = brightest
			ambientLight.intensity = 0.04 + cycle * 0.08;
			directionalLight.intensity = 0.1 + cycle * 0.5;
			rimLight.intensity = 0.05 + cycle * 0.25;

			renderer.render(scene, camera);

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
			return {
				mesh: group as unknown as THREE.Mesh, // Type assertion for compatibility
				zPosition,
				basePosition: basePosition.clone(),
				targetPosition: basePosition.clone(),
				velocity: new THREE.Vector3(0, 0, 0),
				birthTime: Date.now(),
				angerLevel: 0,
				angerTime: 0,
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
			return {
				mesh,
				zPosition,
				basePosition: basePosition.clone(),
				targetPosition: basePosition.clone(),
				velocity: new THREE.Vector3(0, 0, 0),
				birthTime: Date.now(),
				angerLevel: 0,
				angerTime: 0,
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

		return {
			mesh,
			zPosition,
			velocity: new THREE.Vector3(
				(Math.random() - 0.5) * 0.2, // Slow drift
				(Math.random() - 0.5) * 0.2,
				0
			),
			baseIntensity: 0.3 + Math.random() * 0.4, // 0.3-0.7
			wobblePhase: Math.random() * Math.PI * 2,
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

	const createCorkscrewGroup = (startZ: number): CorkscrewGroup => {
		const groupId = `corkscrew-${Date.now()}-${Math.random()}`;
		const obstacles: CorkscrewObstacle[] = [];
		const birthTime = Date.now();
		const numObstacles = 12;
		const corkscrewRadius = getTunnelRadius(Math.floor(-startZ / 5)) * 0.5;

		// Create flyby audio for this group
		const flybyAudio = new Audio(flybyAudioFile);
		flybyAudio.preload = "auto";
		flybyAudio.volume = 0.3;
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
				const zOffset = startZ - (i * 3); // Spread along z-axis

				group.position.set(0, 0, zOffset);

				// Random initial rotation for variety
				group.rotation.set(
					Math.random() * Math.PI,
					Math.random() * Math.PI,
					Math.random() * Math.PI
				);

				sceneRef.current?.add(group);

				obstacles.push({
					mesh: group as unknown as THREE.Mesh,
					groupId,
					angleOffset,
					zPosition: zOffset,
					radius: corkscrewRadius,
					birthTime,
				});
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
				const zOffset = startZ - (i * 3); // Spread along z-axis

				mesh.position.set(0, 0, zOffset);
				sceneRef.current?.add(mesh);

				obstacles.push({
					mesh,
					groupId,
					angleOffset,
					zPosition: zOffset,
					radius: corkscrewRadius,
					birthTime,
				});
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
		};
	};

	const fireProjectile = () => {
		if (!spaceshipRef.current || !sceneRef.current) return;

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
		// Progressive speed: starts at 4, increases to max 40% (1.4x)
		const baseSpeed = 4;
		const maxMultiplier = 1.4; // 40% increase maximum
		const speedMultiplier = Math.min(maxMultiplier, 1 + (state.level - 1) * 0.04);
		const speed = baseSpeed * speedMultiplier;

		// Fade damage flash
		if (state.damageFlash > 0) {
			setGameState((prev) => ({
				...prev,
				damageFlash: Math.max(0, prev.damageFlash - deltaTime * 3),
			}));
		}

		// Update spaceship position based on arrow keys
		const moveSpeed = 8 * deltaTime;
		const tunnelRadius = getTunnelRadius(0) * 0.85;

		if (keysRef.current.ArrowLeft) {
			spaceshipRef.current.position.x -= moveSpeed;
		}
		if (keysRef.current.ArrowRight) {
			spaceshipRef.current.position.x += moveSpeed;
		}
		if (keysRef.current.ArrowUp) {
			spaceshipRef.current.position.y += moveSpeed;
		}
		if (keysRef.current.ArrowDown) {
			spaceshipRef.current.position.y -= moveSpeed;
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

		// Constrain spaceship to tunnel - bounce off walls without damage
		const distFromCenter = Math.sqrt(
			spaceshipRef.current.position.x ** 2 + spaceshipRef.current.position.y ** 2
		);
		if (distFromCenter > tunnelRadius) {
			const angle = Math.atan2(spaceshipRef.current.position.y, spaceshipRef.current.position.x);
			// Bounce back from wall
			spaceshipRef.current.position.x = Math.cos(angle) * (tunnelRadius - 0.1);
			spaceshipRef.current.position.y = Math.sin(angle) * (tunnelRadius - 0.1);
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

		// Simulate audio amplitude with a sine pulse (no Web Audio analyser)
		audioAmplitudeRef.current = 0.3 + 0.2 * Math.sin(Date.now() / 500);

		// Update living behavior system - obstacles trying to communicate
		const currentTime = Date.now();
		const behaviorState = behaviorStateRef.current;
		const timeSinceChange = currentTime - behaviorState.lastChangeTime;

		// Check if it's time to transition to new behavior
		if (timeSinceChange > behaviorState.nextChangeDuration) {
			// Switch behavior mode
			behaviorState.mode = behaviorState.mode === "scattered" ? "clustered" : "scattered";
			behaviorState.transitionProgress = 0;
			behaviorState.lastChangeTime = currentTime;
			behaviorState.nextChangeDuration = 5000 + Math.random() * 3000; // 5-8 seconds

			// Pick new cluster center when switching to clustered mode
			if (behaviorState.mode === "clustered") {
				const angle = Math.random() * Math.PI * 2;
				const radius = getTunnelRadius(0) * 0.3;
				behaviorState.clusterCenter.set(
					Math.cos(angle) * radius,
					Math.sin(angle) * radius,
					-25
				);
			}
		}

		// Update transition progress with smooth easing
		if (behaviorState.transitionProgress < 1) {
			behaviorState.transitionProgress = Math.min(
				1,
				behaviorState.transitionProgress + deltaTime * 0.4 // 2.5 second transition
			);
		}

		// Easing function for smooth transitions
		const easeInOutCubic = (t: number): number => {
			return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
		};
		const transitionEase = easeInOutCubic(behaviorState.transitionProgress);

		// Spawn obstacles - starts sparse, increases gradually
		// Level 1: ~1.5% chance, Level 5: ~3.5% chance, Level 10: ~6% chance
		const baseSpawnChance = 0.015;
		const spawnChanceIncrease = state.level * 0.005;
		const spawnChance = Math.min(0.08, baseSpawnChance + spawnChanceIncrease);

		if (Math.random() < spawnChance) {
			const obstacle = createObstacle(-50);
			obstaclesRef.current.push(obstacle);
		}

		// Spawn atmospheric motes - constant gentle flow
		if (Math.random() < 0.08) {
			const mote = createMote(-50);
			motesRef.current.push(mote);
		}

		// Spawn corkscrew groups - only after year 1, then once per year
		const currentTimeSurvived = (Date.now() - state.timeStarted) / 1000;
		const yearsLived = Math.floor(currentTimeSurvived / 60);

		// Track last corkscrew spawn time
		if (!behaviorStateRef.current.lastCorkscrewSpawn) {
			behaviorStateRef.current.lastCorkscrewSpawn = 0;
		}

		// Only spawn if: (1) at least year 1, AND (2) no active corkscrews, AND (3) 1 year since last spawn
		const timeSinceLastCorkscrew = currentTimeSurvived - behaviorStateRef.current.lastCorkscrewSpawn;
		// First spawn at year 1 (60 seconds), then every year (60 seconds) after
		const shouldSpawnCorkscrew = yearsLived >= 1
			&& corkscrewGroupsRef.current.length === 0
			&& timeSinceLastCorkscrew >= 60;

		if (shouldSpawnCorkscrew) {
			const group = createCorkscrewGroup(-60);
			corkscrewGroupsRef.current.push(group);
			behaviorStateRef.current.lastCorkscrewSpawn = currentTimeSurvived;
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
			sphere.radius = currentTunnelRadius * 0.8;

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

				// Damage player
				setGameState((prev) => {
					const newShields = Math.max(0, prev.shields - 0.25); // Moderate damage
					// Rolling spheres add moderate rage - reduced to 4-7
					const rageIncrease = 4 + Math.random() * 3;
					const newRageLevel = Math.min(100, prev.rageLevel + rageIncrease);

					if (newShields <= 0) {
						saveHighScore();
						return { ...prev, shields: 0, isGameOver: true, damageFlash: 0.5, rageLevel: 100 };
					}
					return { ...prev, shields: newShields, damageFlash: 0.5, rageLevel: newRageLevel };
				});

				// Remove the sphere on collision
				sceneRef.current?.remove(sphere.mesh);
				return false;
			}

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

				// Progressive volume levels: 10%, 15%, 20%, 25%, 30%, 20%
				const volumeLevels = [0.10, 0.15, 0.20, 0.25, 0.30, 0.20];

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
				group.obstacles.forEach((obs) => sceneRef.current?.remove(obs.mesh));
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
					sceneRef.current?.remove(obstacle.mesh);
					return false;
				}
				allBehindCamera = false;

				// Corkscrew motion
				const rotationSpeed = 2; // Radians per second
				const currentAngle = obstacle.angleOffset + (age * rotationSpeed);

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

				// Rotate the obstacle itself for visual interest
				obstacle.mesh.rotation.x += deltaTime * 2;
				obstacle.mesh.rotation.y += deltaTime * 1.5;

				// Check collision with spaceship
				const dist = obstacle.mesh.position.distanceTo(spaceshipRef.current!.position);
				if (dist < 0.65) {
					// Play collision sound
					playCollisionSound();

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

					// Damage player + RAGE SPIKE
					setGameState((prev) => {
						const newShields = Math.max(0, prev.shields - 0.3); // More damage than normal obstacles
						// Exploding corkscrew creates rage spike - reduced to 20-30 rage
						const rageSpike = 20 + Math.random() * 10;
						const newRageLevel = Math.min(100, prev.rageLevel + rageSpike);

						if (newShields <= 0) {
							saveHighScore();
							return { ...prev, shields: 0, isGameOver: true, damageFlash: 0.8, rageLevel: 100 };
						}
						return { ...prev, shields: newShields, damageFlash: 0.8, rageLevel: newRageLevel };
					});

					return false; // Remove this obstacle
				}

				return true;
			});

			// Remove group if all obstacles are gone or behind camera
			if (group.obstacles.length === 0 || allBehindCamera) {
				group.obstacles.forEach((obs) => sceneRef.current?.remove(obs.mesh));
				// Stop the flyby audio
				if (group.flybyAudio) {
					group.flybyAudio.pause();
					group.flybyAudio.currentTime = 0;
				}
				return false;
			}

			return true;
		});

		// Check if there are any corkscrew groups in the tunnel
		const hasCorkscrewsInTunnel = corkscrewGroupsRef.current.length > 0;

		// Update obstacles with living behavior
		obstaclesRef.current = obstaclesRef.current.filter((obstacle) => {
			// Move forward through tunnel
			obstacle.mesh.position.z += speed * deltaTime;
			obstacle.basePosition.z += speed * deltaTime;

			// Remove if behind camera
			if (obstacle.mesh.position.z > 5) {
				sceneRef.current?.remove(obstacle.mesh);
				return false;
			}

			// Calculate target position based on current behavior mode
			const age = (currentTime - obstacle.birthTime) / 1000; // age in seconds
			let targetX = obstacle.basePosition.x;
			let targetY = obstacle.basePosition.y;

			if (hasCorkscrewsInTunnel) {
				// Move toward edges when corkscrew obstacles are present
				const currentRadius = Math.sqrt(
					obstacle.basePosition.x ** 2 + obstacle.basePosition.y ** 2
				);
				const angle = Math.atan2(obstacle.basePosition.y, obstacle.basePosition.x);
				const tunnelEdgeRadius = getTunnelRadius(Math.floor(-obstacle.mesh.position.z / 5)) * 0.75;

				// Push toward the edge
				targetX = Math.cos(angle) * tunnelEdgeRadius;
				targetY = Math.sin(angle) * tunnelEdgeRadius;
			} else if (behaviorState.mode === "clustered") {
				// Move toward cluster center (cloud formation)
				targetX = behaviorState.clusterCenter.x;
				targetY = behaviorState.clusterCenter.y;
			} else {
				// Scattered mode - add organic wobble and spread
				const wobbleFreq = 0.5 + (obstacle.birthTime % 1000) / 1000; // Unique per obstacle
				const wobbleX = Math.sin(age * wobbleFreq * 2) * 1.5;
				const wobbleY = Math.cos(age * wobbleFreq * 1.7) * 1.5;
				targetX = obstacle.basePosition.x + wobbleX;
				targetY = obstacle.basePosition.y + wobbleY;
			}

			// Update target position
			obstacle.targetPosition.set(targetX, targetY, obstacle.mesh.position.z);

			// Apply smooth movement toward target with spring-like physics
			const dx = obstacle.targetPosition.x - obstacle.mesh.position.x;
			const dy = obstacle.targetPosition.y - obstacle.mesh.position.y;

			// Spring constant increases during transition for snappier response
			const springK = 2.0 + transitionEase * 3.0;
			const damping = 0.85;

			obstacle.velocity.x += dx * springK * deltaTime;
			obstacle.velocity.y += dy * springK * deltaTime;
			obstacle.velocity.multiplyScalar(damping);

			obstacle.mesh.position.x += obstacle.velocity.x * deltaTime;
			obstacle.mesh.position.y += obstacle.velocity.y * deltaTime;

			// Add pulsing effect synchronized with audio amplitude
			// Combine transition pulsing with audio reactivity
			const transitionPulse = (1 - transitionEase) * 0.2; // Reduced transition effect
			const audioPulse = audioAmplitudeRef.current * 0.4; // Audio-reactive pulsing (up to 40% scale change)
			const basePulse = 1 + Math.sin(currentTime / 100) * transitionPulse;
			const pulse = basePulse + audioPulse; // Combine both effects
			obstacle.mesh.scale.set(pulse, pulse, pulse);

			// Slow rolling rotation - creates a larger, more vast scene feel
			// Each cube rolls slowly on multiple axes
			const rollSpeed = 0.3; // Slow rolling speed
			obstacle.mesh.rotation.x += rollSpeed * deltaTime;
			obstacle.mesh.rotation.y += rollSpeed * deltaTime * 0.7;
			obstacle.mesh.rotation.z += rollSpeed * deltaTime * 0.5;

			// Check collision with spaceship - adjusted for GLB models
			const dist = obstacle.mesh.position.distanceTo(spaceshipRef.current!.position);
			if (dist < 0.6) {
				// Play collision sound
				playCollisionSound();

				// Make cloud being angry!
				obstacle.angerLevel = 1.0;
				obstacle.angerTime = currentTime;

				// Bounce back effect
				const bounceDir = spaceshipRef.current!.position.clone().sub(obstacle.mesh.position).normalize();
				spaceshipRef.current!.position.add(bounceDir.multiplyScalar(0.3));

				// Small diplomatic health loss - takes many hits to game over
				setGameState((prev) => {
					const newShields = Math.max(0, prev.shields - 0.15); // Lose 15% per hit, ~7 hits to game over
					// Standard obstacle collision adds moderate rage - reduced to 5-9
					const rageIncrease = 5 + Math.random() * 4;
					const newRageLevel = Math.min(100, prev.rageLevel + rageIncrease);

					if (newShields <= 0) {
						saveHighScore();
						return { ...prev, shields: 0, isGameOver: true, damageFlash: 0.3, rageLevel: 100 };
					}
					return { ...prev, shields: newShields, damageFlash: 0.3, rageLevel: newRageLevel };
				});
			}

			// Update anger visual effect - match global rage level
			// Calculate effective anger level: max of individual anger or global rage
			const globalRageFactor = state.rageLevel / 100; // 0-1 from global rage
			const effectiveAnger = Math.max(obstacle.angerLevel, globalRageFactor);

			if (obstacle.angerLevel > 0) {
				const timeSinceAnger = (currentTime - obstacle.angerTime) / 1000;
				obstacle.angerLevel = Math.max(0, 1 - timeSinceAnger / 8); // Calms down over 8 seconds
			}

			// Apply visual effects based on effective anger (individual or global rage)
			if (effectiveAnger > 0) {
				// Angry effects: red color, vibration, larger size
				// Handle both GLB models (Group) and fallback meshes
				obstacle.mesh.traverse((child) => {
					if (child instanceof THREE.Mesh && child.material) {
						const material = child.material as THREE.MeshStandardMaterial;
						const baseColor = new THREE.Color(0x8b6f47);
						const angryColor = new THREE.Color(0xff3333);
						material.color.lerpColors(baseColor, angryColor, effectiveAnger);
						material.emissive.setRGB(
							effectiveAnger * 0.5,
							0,
							0
						);
					}
				});

				// Angry vibration
				const vibrationAmount = effectiveAnger * 0.15;
				const vibrationX = Math.sin(currentTime / 50) * vibrationAmount;
				const vibrationY = Math.cos(currentTime / 50) * vibrationAmount;
				obstacle.mesh.position.x += vibrationX;
				obstacle.mesh.position.y += vibrationY;

				// Angry size pulsing - also reacts to audio
				const angryScale = 1 + effectiveAnger * 0.5;
				const transitionPulse = (1 - transitionEase) * 0.2;
				const audioPulse = audioAmplitudeRef.current * 0.4;
				const basePulse = 1 + Math.sin(currentTime / 100) * transitionPulse;
				const combinedPulse = basePulse + audioPulse;
				obstacle.mesh.scale.set(combinedPulse * angryScale, combinedPulse * angryScale, combinedPulse * angryScale);
			}

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

			// Remove if behind camera
			if (mote.mesh.position.z > 5) {
				sceneRef.current?.remove(mote.mesh);
				return false;
			}

			// Gentle drifting motion
			mote.wobblePhase += deltaTime * 0.5;
			mote.mesh.position.x += mote.velocity.x * deltaTime + Math.sin(mote.wobblePhase) * 0.05 * deltaTime;
			mote.mesh.position.y += mote.velocity.y * deltaTime + Math.cos(mote.wobblePhase * 1.3) * 0.05 * deltaTime;

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
			const targetVolume = Math.pow(wallProximity, 2) * 0.5; // Max volume 50%

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
			const newScore = prev.score + Math.floor(speed * deltaTime * 10);
			const newLevel = Math.floor(newScore / 1000) + 1;

			// Smooth rage level transitions
			// If target is higher, increase quickly (incidents cause rapid spikes)
			// If target is lower, decrease slowly (rage subsides gradually during calm)
			let newRageLevel = prev.rageLevel;
			if (targetRage > prev.rageLevel) {
				// Rage increases quickly - 40 units per second
				newRageLevel = Math.min(100, prev.rageLevel + 40 * deltaTime);
				newRageLevel = Math.min(newRageLevel, targetRage); // Don't overshoot
			} else {
				// Rage decreases very slowly during calm - 3 units per second
				newRageLevel = Math.max(0, prev.rageLevel - 3 * deltaTime);
				newRageLevel = Math.max(newRageLevel, targetRage); // Don't undershoot
			}

			// Check for death by old age
			const currentTimeSurvived = (Date.now() - prev.timeStarted) / 1000;
			const yearsLived = Math.floor(currentTimeSurvived / 60);
			const currentPlayerAge = (prev.playerAge || 0) + yearsLived;

			if (currentPlayerAge >= prev.maxAge) {
				saveHighScore();
				return {
					...prev,
					score: newScore,
					level: newLevel,
					isGameOver: true,
					rageLevel: newRageLevel,
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
			group.obstacles.forEach((obs) => sceneRef.current?.remove(obs.mesh));
		});
		corkscrewGroupsRef.current = [];
		rollingSpheresRef.current.forEach((sphere) => sceneRef.current?.remove(sphere.mesh));
		rollingSpheresRef.current = [];

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
		});
		setAgeInput("");

		// Reset story modal
		setShowStoryModal(true);
		setStoryText("");
		setShowContinueButton(false);

		// Stop playlist (will restart when game scene re-initializes)
		if (playlistManagerRef.current) {
			playlistManagerRef.current.stop();
		}

		// Reset spaceship position
		if (spaceshipRef.current) {
			spaceshipRef.current.position.set(0, 0, 0);
		}
	};

	const timeSurvived = gameState.isGameOver
		? Math.floor((Date.now() - gameState.timeStarted) / 1000)
		: Math.floor((Date.now() - gameState.timeStarted) / 1000);

	// Calculate duration in years (1 minute = 1 year, so 60 seconds = 1 year)
	const durationInYears = Math.floor(timeSurvived / 60);

	// Calculate current age
	const currentAge = gameState.playerAge !== null ? gameState.playerAge + durationInYears : 0;

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
			{!gameState.isGameOver && !gameState.showAgeInput && (
				<div className="absolute inset-0 pointer-events-none">
					{/* Top Status Bar */}
					<div className="absolute top-0 left-0 right-0 h-12 bg-gradient-to-b from-cyan-950/90 to-cyan-950/40 backdrop-blur-sm border-b border-cyan-500/30">
						<div className="flex items-center justify-between h-full px-6">
							<div className="flex items-center gap-8 font-mono text-xs tracking-wider">
								<div className="flex items-center gap-2">
									<div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
									<span className="text-green-400">SYS.ONLINE</span>
								</div>
								<div className="text-cyan-300">MISSION.TIME: {durationInYears}Y</div>
								<div className="text-cyan-300">PILOT.AGE: {currentAge}</div>
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
								<PlaylistSettings currentTrackId={currentTrackId} />
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
			{!gameState.isGameOver && !gameState.showAgeInput && (
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

			{/* Game Over Screen */}
			{gameState.isGameOver && (
				<div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm">
					<Card className="w-full max-w-md p-8 bg-gradient-to-b from-cyan-950/90 to-zinc-900 border-cyan-500/30 glitch-modal">
						<div className="text-center space-y-6">
							<h1 className="text-2xl font-bold font-mono text-cyan-300 tracking-widest glitch-text">
								{currentAge >= gameState.maxAge ? "MISSION.TERMINATED" : "PILOT.INCAPACITATED"}
							</h1>

							<p className="font-mono text-cyan-400/80 tracking-wider glitch-text">
								Pilot.Died.Aboard.RAMA. Age {currentAge}
							</p>

							<div className="space-y-2 text-cyan-300 font-mono text-sm tracking-wide">
								<div>FINAL.AGE: {currentAge}</div>
								<div>MISSION.DURATION: {durationInYears} YEARS</div>
								{currentAge >= gameState.maxAge && (
									<div className="text-cyan-400/60 italic mt-4 text-xs tracking-wider">
										BIOLOGICAL.LIMIT.REACHED...
									</div>
								)}
							</div>

							<div className="flex gap-3 justify-center">
								<Button onClick={restartGame} size="lg" className="font-mono bg-cyan-900/80 hover:bg-cyan-800 text-cyan-100 border-cyan-500/30">
									New Pilot
								</Button>
								<Button
									onClick={() => setShowHighScores(!showHighScores)}
									size="lg"
									variant="outline"
									className="font-mono border-cyan-500/30 text-cyan-300 hover:bg-cyan-950/50 hover:text-cyan-200"
								>
									{showHighScores ? "Hide" : "Show"} Records
								</Button>
							</div>

							{showHighScores && (
								<div className="mt-6 bg-cyan-950/30 rounded-lg p-4 border border-cyan-500/30">
									<h2 className="text-xl font-bold text-cyan-300 mb-3 font-mono tracking-wider">MISSION.RECORDS</h2>
									<div className="space-y-2 max-h-64 overflow-y-auto">
										{highScores.length === 0 ? (
											<div className="text-cyan-400/60 text-sm font-mono">NO.RECORDS.FOUND</div>
										) : (
											highScores.map((score, index) => (
												<div
													key={index}
													className="flex justify-between items-center text-cyan-300 font-mono text-sm bg-cyan-950/50 px-3 py-2 rounded border border-cyan-500/20"
												>
													<span className="font-bold text-cyan-400">#{index + 1}</span>
													<span>{score.player_name}</span>
													<span>{score.score} pts</span>
													<span className="text-cyan-400/60">Lvl {score.level_reached}</span>
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
