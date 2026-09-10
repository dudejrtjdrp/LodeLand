import Phaser from 'phaser';
import EnemyManager from '../systems/EnemyManager';
import ProgressionSystem from '../systems/ProgressionSystem';
import SwordOrbitSystem from '../systems/sword/SwordOrbitSystem';
import VisualEffectsSystem from '../systems/VisualEffectsSystem';
import StatusEffectSystem from '../systems/StatusEffectSystem';
import LevelUpSystem from '../systems/LevelUpSystem';
import WaveSystem from '../systems/WaveSystem';
import PickupSystem from '../systems/PickupSystem';
import MetaProgression from '../systems/MetaProgression';
import type { MetaBonuses } from '../systems/MetaProgression';
import SoundSystem from '../systems/SoundSystem';
import BgmSystem from '../systems/BgmSystem';
import { createAudioSettings, type AudioSettingsUi } from '../ui/audioSettings';
import ShopSystem from '../systems/shop/ShopSystem';
import AugmentSystem from '../systems/AugmentSystem';
import HudSystem from '../systems/HudSystem';
import BossBarSystem from '../systems/BossBarSystem';
import StatsPanel from '../systems/StatsPanel';
import VillageSystem from '../systems/VillageSystem';
import TutorialSystem from '../systems/TutorialSystem';
import ActiveSkillSystem from '../systems/ActiveSkillSystem';
import KeeperSystem from '../systems/KeeperSystem';
import AchievementSystem from '../systems/AchievementSystem';
import BossCutInSystem from '../systems/BossCutInSystem';
import DangerEventSystem from '../systems/DangerEventSystem';
import SkillTreeSystem from '../systems/SkillTreeSystem';
import SkillWindow from '../systems/SkillWindow';
import * as codexApi from '../core/codex';
import * as statsApi from '../core/stats';
import { consumeTutorialRequest } from '../core/onboarding';
import GamepadSystem from '../systems/GamepadSystem';
import { getBinding, getBindingCode, onKeybindsChanged } from '../core/keybinds';
import { createControlsPanel, combatControlRows } from '../ui/controlsPanel';
import { openKeybindWindow, type KeybindWindow } from '../ui/keybindPanel';
import { KEYWORDS } from '../ui/keywords';
import { MAP_THEMES, type MapTheme } from '../logic/mapThemes';
import ElementSetSystem from '../systems/ElementSetSystem';
import ElementAuraSystem from '../systems/ElementAuraSystem';
import swordCatalogJson from '../data/swordCatalog.json';
import playerCatalogJson from '../data/playerCatalog.json';
import enemyCatalogJson from '../data/enemyCatalog.json';
import { GameEvents } from '../core/events';
import { DECO_ATLAS } from '../core/textures';
import RunSave from '../core/RunSave';
import { recordRun } from '../core/telemetry';
import * as telemetryApi from '../core/telemetry';
import { behaviorOf } from '../logic/swordBehavior';
import { mitigatePlayerDamage } from '../logic/combat';
import { healWithinBudget } from '../logic/lifesteal';
import { hpScaleOf, playerDamageGrowth, playerHpGrowth, formatHudNumber } from '../logic/growth';
import { screenShakeEnabled, reduceMotion, saveSettings, loadSettings, hitStopEnabled } from '../core/settings';
import * as settingsApi from '../core/settings';
import * as keybindsApi from '../core/keybinds';
import {
  FONT, UI, style, panel, insetPanel, button, divider, slot, selectFrame, dimVignette,
  createUiRoot, iconImage, RARITY_THEME, type UiRoot, TEXT_RESOLUTION,
} from '../ui/theme';
import type {
  DamageType,
  EnemyDefinition,
  PlayerDefinition,
  PlayerTraits,
  SwordDefinition,
} from '../types/catalogs';
import type { EnemyProjectile, EnemySprite, PlayerSprite } from '../types/actors';

const swordCatalog = swordCatalogJson as unknown as SwordDefinition[];
const playerCatalog = playerCatalogJson as unknown as PlayerDefinition[];
const enemyCatalog = enemyCatalogJson as unknown as EnemyDefinition[];

const defaultPlayer = playerCatalog[0];

const DANGER_LEVELS = [
  { hpMult: 1.0, damageMult: 1.0, goldMult: 1.0 },
  { hpMult: 1.3, damageMult: 1.3, goldMult: 1.25 },
  { hpMult: 1.6, damageMult: 1.6, goldMult: 1.5 },
];

/** A pooled ground chunk: one tilemap and its painted layer. */
interface ChunkTile {
  map: Phaser.Tilemaps.Tilemap;
  layer: Phaser.Tilemaps.TilemapLayer;
  /** 청크 좌표. 컬링/재도색이 매번 키 문자열을 잘라 Number() 하지 않도록 들고 있는다. */
  cx: number;
  cy: number;
  /** Tiny Swords 지형 장식 (청크 언로드 시 파괴). */
  decos: Phaser.GameObjects.GameObject[];
  /** 장식이 현재 보이는 상태인지 (컬링 상태 전이 감지용). */
  decosVisible?: boolean;
  /** 로드 반경을 벗어난 시각 + 유예. 이 시각을 지나야 실제로 해제한다(경계 왕복 방지). */
  unloadAt?: number;
}

/**
 * 로드 반경을 벗어난 청크를 곧바로 버리지 않고 기다리는 시간.
 * 반경에 여유가 없어서(createInitialChunks 참고) 경계 위에서 왔다갔다 하면
 * 한 열(3청크 × 장식 ~4개)이 매번 파괴·재생성돼 GC 스파이크가 된다 — 이 유예가 막는다.
 */
const CHUNK_UNLOAD_GRACE_MS = 2000;

/** 전투 BGM 긴장도에서 "라운드 진행률"이 1.0 이 되는 라운드 (combatTension) */
const TENSION_ROUND_SPAN = 60;

/** A chunk build request queued for the per-frame budgeted builder. */
interface ChunkMeta {
  x: number;
  y: number;
  key: string;
}

/** Data passed into the scene via scene.start / scene.restart. */
interface GameSceneData {
  characterId?: string;
  danger?: number;
  /** true면 RunSave에서 라운드 사이 상태를 복원해 이어한다. */
  resume?: boolean;
  /**
   * 재도전 시 사망 시점의 지갑 잔액 (2026-09-08): 검·레벨·증강은 스냅샷으로 되감기지만
   * 골드만은 사망 순간의 값을 그대로 이어간다 — 벌었으면 늘고, 마을에서 썼으면 줄어든다.
   *
   * (구 carryGold 방식은 `스냅샷 + max(0, 사망골드 − 스냅샷)` 이라 사망 골드가 스냅샷보다
   *  적을 때 — 마을에서 쓰고 죽었을 때 — 잔액이 스냅샷 값으로 되살아났다. 그래서 몇 번을
   *  죽어도 골드가 특정 값에 못 박혔다.)
   */
  retryGold?: number;
}

type PhysicsCallbackObject =
  | Phaser.Types.Physics.Arcade.GameObjectWithBody
  | Phaser.Physics.Arcade.Body
  | Phaser.Physics.Arcade.StaticBody
  | Phaser.Tilemaps.Tile;

export default class GameScene extends Phaser.Scene {
  tileSize: number;
  chunkTiles: number;
  chunkPixelSize: number;
  chunkLoadRadius: number;
  /** 축별 청크 로드 반경 — 가로/세로 비율이 다른 화면에서 과잉 로드를 막는다. */
  chunkLoadRadiusX = 2;
  chunkLoadRadiusY = 2;
  /** 장식 컬링 스로틀 타임스탬프 */
  private lastDecoCullAt = 0;
  loadedChunks: Map<string, ChunkTile>;
  chunkPool: ChunkTile[];
  maxPoolSize: number;
  chunkBuildQueue: ChunkMeta[];
  pendingChunkKeys: Set<string>;
  chunkBuildBudgetMs: number;
  playerChunkX: number | null;
  playerChunkY: number | null;

  isGameOver!: boolean;
  /** 마지막으로 플레이어를 때린 적 이름 (FLAMEOUT 사인 표기) */
  lastHitBy: string | null = null;
  isPaused!: boolean;
  pauseUi!: Phaser.GameObjects.GameObject[];
  pauseMenuText?: Phaser.GameObjects.Text | null;
  pauseButtons?: Array<{ button: ReturnType<typeof button>; getLabel?: () => string }>;
  pauseRoot?: UiRoot | null;
  /** 일시정지 메뉴의 음량 설정 블록 */
  private pauseAudioUi: AudioSettingsUi | null = null;
  soundSystem!: SoundSystem;
  /** 배경음 (게임당 싱글턴 — 씬을 넘나들어도 같은 인스턴스) */
  bgm!: BgmSystem;
  /** BGM 상황 판정 스로틀 (매 프레임 볼 필요가 없다) */
  private bgmPollAt = 0;
  /** 저체력 경고음 중복 방지 (25% 아래로 "진입"할 때만 1회) */
  private lowHpWarned = false;
  metaBonuses!: MetaBonuses;
  revivalsLeft!: number;
  characterId!: string;
  dangerLevel!: number;
  dangerConfig!: (typeof DANGER_LEVELS)[number];
  playerConfig!: PlayerDefinition;
  traits!: PlayerTraits;
  player!: PlayerSprite;
  swordOrbit!: SwordOrbitSystem;
  visualEffects!: VisualEffectsSystem;
  /** 상태이상 부여 헬퍼 + 지속 표시(틴트·오버레이) — 2026-09-04 */
  statusEffects!: StatusEffectSystem;
  enemyManager!: EnemyManager;
  progression!: ProgressionSystem;
  levelUpSystem!: LevelUpSystem;
  waveSystem!: WaveSystem;
  pickupSystem!: PickupSystem;
  shopSystem!: ShopSystem;
  augmentSystem!: AugmentSystem;
  hudSystem!: HudSystem;
  /** 화면 상단 대형 보스 HP바 */
  bossBar!: BossBarSystem;
  statsPanel!: StatsPanel;
  /** 대기마을 (라운드 사이 허브 — 상점/에다/증강 제단/게이트) */
  villageSystem!: VillageSystem;
  /** 첫 런 온보딩 튜토리얼 (localStorage 로 1회 — 설정에서 다시 보기) */
  tutorial!: TutorialSystem;
  /** 능동 스킬 (활공 사냥 Q·우클릭 / 귀소 SPACE / 대시 SHIFT) */
  activeSkills!: ActiveSkillSystem;
  /** 키퍼 고유 메커닉 (승계 / 반격 사출 / 질풍 보법 / 감정사의 내기) */
  keeper!: KeeperSystem;
  /** 도전과제 (이벤트 훅 판정 + 달성 토스트) */
  achievements!: AchievementSystem;
  /** 보스 등장 컷인 배너 */
  bossCutIn!: BossCutInSystem;
  /** 위험 이벤트 (2026-09-04): 15라부터 라운드 중 처리/방치 사건 */
  dangerEvents!: DangerEventSystem;
  /** 스킬 트리 (2026-09-04): 포인트·패시브·트리 능동 스킬 */
  skillTree!: SkillTreeSystem;
  /** 스킬 창 (K) — 트리 열람·배우기·핫키 배정 */
  skillWindow!: SkillWindow;
  /** 이번 런에 튜토리얼이 예약됐는가 (인트로의 초심자 힌트 중복 방지) */
  private tutorialQueued = false;
  /** 현재 맵 테마 (라운드 입장 시 WaveSystem 이 교체) */
  currentTheme: MapTheme = MAP_THEMES[0];
  /** 라운드 입장 연출 오브젝트 (중복 연출 방지·정리용) */
  private roundEntryObjects: Phaser.GameObjects.GameObject[] = [];
  /** 원소 세트 (2~7단계 스탯/스킬) */
  elementSets!: ElementSetSystem;
  /** 원소 세트 오라 렌더러 */
  elementAura!: ElementAuraSystem;
  enemyHitOverlap!: Phaser.Physics.Arcade.Collider;
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  /** 리맵된 이동 키 (기본 방향키 — cursors 와 같은 키지만 리맵 시 달라진다) */
  moveKeys!: Record<'up' | 'left' | 'down' | 'right', Phaser.Input.Keyboard.Key>;
  /** 게임패드 (미연결이면 아무 것도 하지 않는다) */
  gamepad: GamepadSystem | null = null;
  /** 리맵 구독 해제 함수 */
  private unbindKeybinds: (() => void) | null = null;
  /** 일시정지 메뉴에서 연 조작 키 설정 창 (열려 있으면 ESC 는 이 창부터 닫는다) */
  private keybindWindow: KeybindWindow | null = null;

  constructor() {
    super('GameScene');

    this.tileSize = 64; // Tiny Swords 타일 규격
    this.chunkTiles = 8; // 8×64 = 512px — 기존 청크 픽셀 크기 유지
    this.chunkPixelSize = this.tileSize * this.chunkTiles;
    this.chunkLoadRadius = 2;
    this.loadedChunks = new Map();
    this.chunkPool = [];
    this.maxPoolSize = 64;
    this.chunkBuildQueue = [];
    this.pendingChunkKeys = new Set();
    this.chunkBuildBudgetMs = 1.8;
    this.playerChunkX = null;
    this.playerChunkY = null;
  }

  create() {
    const { width, height } = this.scale;

    // Recover cleanly from a restart (previous run may have left physics paused).
    if (this.physics.world.isPaused) {
      this.physics.resume();
    }
    // 히트스톱은 시간 배율만 건드리지만, 재시작이 복구 타이머를 지웠을 수 있으므로
    // 런 시작마다 배율을 원위치시킨다 (느려진 채로 시작하는 것을 방지).
    this.physics.world.timeScale = 1;
    this.tweens.timeScale = 1;
    this.anims.globalTimeScale = 1;
    this.isGameOver = false;
    this.isPaused = false;
    this.tutorialQueued = false;
    this.lastHitBy = null;
    this.pauseUi = [];
    this.soundSystem = new SoundSystem(this);
    this.lowHpWarned = false;
    this.bgmPollAt = 0;
    // 전투 트랙으로 시작 — 이후 상황(보스/대기마을)은 update() 가 판정해 전환한다
    this.bgm = BgmSystem.for(this);
    this.bgm.play('battle');

    // 재시작 시 이전 런의 청크 상태 초기화 — 풀/맵에 남은 레이어들은
    // 씬 shutdown 때 이미 파괴됐으므로 참조를 들고 있으면 fill()에서 크래시한다.
    this.loadedChunks.clear();
    this.chunkPool.length = 0;
    this.chunkBuildQueue.length = 0;
    this.pendingChunkKeys.clear();
    this.playerChunkX = null;
    this.playerChunkY = null;

    this.createInitialChunks(width, height);
    this.updateChunksAroundPlayer(width / 2, height / 2, true);
    this.processChunkQueue(6);

    this.metaBonuses = MetaProgression.getBonuses();
    this.revivalsLeft = this.metaBonuses.revival ?? 0;

    const sceneData = (this.scene.settings.data ?? {}) as GameSceneData;
    const resumeData = sceneData.resume ? RunSave.peek() : null;
    if (!resumeData) {
      // 새 런 시작 = 이전 런 세이브 무효화 (roguelite 단일 세이브 슬롯)
      RunSave.clear();
    }
    this.characterId = resumeData?.characterId ?? sceneData.characterId ?? defaultPlayer.id;
    this.dangerLevel = Phaser.Math.Clamp(resumeData?.dangerLevel ?? sceneData.danger ?? 0, 0, DANGER_LEVELS.length - 1);
    this.dangerConfig = DANGER_LEVELS[this.dangerLevel];

    this.playerConfig = playerCatalog.find((entry) => entry.id === this.characterId) ?? defaultPlayer;
    this.traits = this.playerConfig.traits ?? {};
    this.player = this.physics.add.sprite(width / 2, height / 2, this.playerConfig.spritesheets.idle.textureKey, this.playerConfig.spritesheets.idle.frameStart) as PlayerSprite;
    this.player.setCollideWorldBounds(false);
    this.player.setDepth(10);
    this.player.setDisplaySize(this.playerConfig.displaySize.width, this.playerConfig.displaySize.height);
    this.applyPlayerHitbox(this.player, this.playerConfig);
    this.player.setDrag(900, 900);
    this.player.maxHp = Math.round((this.playerConfig.stats.maxHp + (this.metaBonuses.maxHpFlat ?? 0)) * (this.traits.hpMult ?? 1));
    this.player.hp = this.player.maxHp;
    this.player.attackDamage = this.playerConfig.stats.damage;
    this.player.defense = this.playerConfig.stats.defense;
    this.player.moveSpeed = Math.round(this.playerConfig.stats.moveSpeed * (1 + (this.metaBonuses.moveSpeedMult ?? 0)));
    this.player.critChance = this.playerConfig.stats.critChance ?? 0;
    this.player.critDamageMultiplier = this.playerConfig.stats.critDamageMultiplier ?? 1.0;
    this.player.luck = (this.playerConfig.stats.luck ?? 0) + (this.metaBonuses.luck ?? 0) + (this.traits.luckBonus ?? 0);
    this.player.dodgeChance = 0;
    this.player.hpRegen = 0;
    this.player.killHeal = 0;
    this.player.thorns = 0;
    this.player.physicalResist = 0;
    this.player.magicResist = 0;
    // 해금 스탯 (대응 스탯 MAX 시 레벨업 선택지에 등장 — statCaps.UNLOCK_CAPS)
    this.player.damageReduction = 0;
    this.player.lifesteal = 0;
    this.player.goldBonus = 0;
    this.player.executeDamage = 0;
    this.player.pen = 0;

    if (this.playerConfig.tint) {
      this.player.setTint(Phaser.Display.Color.HexStringToColor(this.playerConfig.tint).color);
    }
    this.player.isDead = false;
    this.player.isHurting = false;
    this.player.isKnockedBack = false;
    this.player.invulnerableUntil = 0;
    this.player.knockbackUntil = 0;

    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    this.swordOrbit = new SwordOrbitSystem(this, {
      swordCatalog,
      damageMultiplier: (1 + (this.metaBonuses.damageMult ?? 0)) * (this.traits.damageMult ?? 1),
      cooldownMultiplier: (1 - (this.metaBonuses.cooldownRed ?? 0)) * (this.traits.cooldownMult ?? 1),
      maxSwords: this.traits.maxSwords ?? 7, // 이중 궤도: 안쪽 3 + 바깥 4
      noLaunch: this.traits.noLaunch ?? false,
      orbitDamageMult: this.traits.orbitDamageMult ?? 1,
    });
    this.swordOrbit.radius *= this.traits.orbitRadiusMult ?? 1;
    // 도전과제는 첫 검(=도감 기록)보다 먼저 있어야 신규 획득 판정을 받는다
    this.achievements = new AchievementSystem(this);
    this.bossCutIn = new BossCutInSystem(this);
    this.visualEffects = new VisualEffectsSystem(this);
    // 상태이상 표시는 적보다 먼저 있어야 첫 스폰부터 틴트가 잡힌다
    this.statusEffects = new StatusEffectSystem(this);
    this.enemyManager = new EnemyManager(this, {
      enemyCatalog,
      hpMult: this.dangerConfig.hpMult,
      damageMult: this.dangerConfig.damageMult,
    });
    this.progression = new ProgressionSystem(this, this.swordOrbit);
    this.progression.attachPlayer(this.player);
    this.progression.magnetRadius *= 1 + (this.metaBonuses.magnetMult ?? 0);

    // 스탯 상한(statCaps) 기준값 스냅샷 — 메타/특성 적용 직후의 값
    this.player.baseMoveSpeed = this.player.moveSpeed;
    this.progression.baseMagnetRadius = this.progression.magnetRadius;
    this.swordOrbit.baseRadius = this.swordOrbit.radius;
    this.swordOrbit.baseOrbitSpeed = this.swordOrbit.orbitSpeed;
    this.swordOrbit.addSword(this);

    // ARMORY(시작 검 +N): 시작 해금 슬롯(2칸)이 기본 검으로 이미 차 있으므로
    // 슬롯도 함께 해방해야 한다 — 안 그러면 addSword가 조용히 실패해 보상이 증발 (2026-08-29)
    for (let i = 0; i < (this.metaBonuses.extraSword ?? 0); i += 1) {
      if (this.swordOrbit.swords.length >= this.swordOrbit.getEffectiveMaxSwords()) {
        this.swordOrbit.unlockSlot();
      }
      this.swordOrbit.addSword(this);
    }

    this.levelUpSystem = new LevelUpSystem(this, {
      swordOrbit: this.swordOrbit,
      progression: this.progression,
      swordCatalog,
    });
    this.events.on(GameEvents.LEVEL_UP, (level: number) => {
      if (this.player?.isDead) {
        return;
      }
      this.applyLevelGrowth(level);
      this.levelUpSystem.enqueue();
    });

    this.waveSystem = new WaveSystem(this, { enemyManager: this.enemyManager });
    this.pickupSystem = new PickupSystem(this, {
      progression: this.progression,
      levelUpSystem: this.levelUpSystem,
      enemyManager: this.enemyManager,
      goldMult: (this.traits.goldMult ?? 1) * this.dangerConfig.goldMult,
    });

    this.shopSystem = new ShopSystem(this, {
      swordOrbit: this.swordOrbit,
      pickupSystem: this.pickupSystem,
      progression: this.progression,
    });

    // 증강: 라운드 10/25/40/55 진입 전 3택1 드래프트 (상점과 축 분리)
    this.augmentSystem = new AugmentSystem(this, {
      swordOrbit: this.swordOrbit,
      progression: this.progression,
      pickupSystem: this.pickupSystem,
    });

    this.hudSystem = new HudSystem(this);
    this.bossBar = new BossBarSystem(this);
    this.statsPanel = new StatsPanel(this);
    // 대기마을: 라운드 사이 걸어다니는 허브 (상점/에다/증강 제단/게이트)
    this.villageSystem = new VillageSystem(this);
    // 온보딩 튜토리얼 (실제 첫 런 위에 얹는 코치 카드 — 전용 라운드가 아니다)
    this.tutorial = new TutorialSystem(this);
    // 능동 스킬 (검 궤도·HUD 배율을 읽으므로 swordOrbit·hudSystem 뒤에 만든다)
    // 키퍼 고유 메커닉 — 능동 스킬보다 먼저 만든다 (대시 쿨다운 배율을 읽으므로)
    this.keeper = new KeeperSystem(this);
    this.activeSkills = new ActiveSkillSystem(this);
    this.dangerEvents = new DangerEventSystem(this);
    this.skillTree = new SkillTreeSystem(this);
    this.skillWindow = new SkillWindow(this);

    // 원소 세트: 같은 원소 2~7자루에 따라 스탯/스킬이 순차 개방된다.
    // 스탯 보정을 얹기 전에 생성해야 하므로 다른 시스템이 모두 준비된 뒤 마지막에 만든다.
    this.elementSets = new ElementSetSystem(this);
    this.elementAura = new ElementAuraSystem(this);
    this.elementSets.recompute();

    // Enemy projectiles hurt the player
    this.physics.add.overlap(this.player, this.enemyManager.projectiles, (playerObj, bulletObj) => {
      const bullet = bulletObj as EnemyProjectile;
      if (!bullet.active) {
        return;
      }
      this.applyPlayerDamage(bullet.damage ?? 12, bullet.x, bullet.y, 'magic', bullet.shooterName ?? '독 가시');
      this.enemyManager.recycleProjectile(bullet);
    });

    // 처치 회복: 고정 +N 은 체력 규모로 환산, 초당 회복 예산 안에서만 (logic/lifesteal.ts)
    this.events.on(GameEvents.ENEMY_DIED, (payload: { enemy?: EnemySprite }) => {
      if (!this.player.isDead && (this.player.killHeal ?? 0) > 0) {
        healWithinBudget(this.player, Math.round(this.player.killHeal * hpScaleOf(this.player.maxHp)), this.time.now);
      }
      // 도전과제 누적 집계 — 메모리 카운터만 올린다 (저장은 라운드 경계에서)
      const enemy = payload?.enemy;
      // 필살기 게이지 충전 (처치 종류별)
      this.activeSkills?.addUltCharge(this.activeSkills.chargeForKill(enemy));
      this.achievements?.onEnemyKilled(
        enemy?.catalog?.isBoss === true,
        enemy?.affixIds?.length ?? 0,
      );
    });

    if (this.dangerLevel > 0) {
      // 상단 라운드 패널 우측 자맥 깊이 배지 (배지 원은 WaveSystem.drawHudPanel이 그림)
      const hs = this.waveSystem.hs;
      const vein = iconImage(this, 'g-vein', this.scale.width / 2 + 246 * hs, 40 * hs, 22 * hs, 0xfffdf5);
      (vein as Phaser.GameObjects.Image).setScrollFactor?.(0);
      vein.setDepth(1002);
      const depthLabel = ['위험도 Ⅰ', '위험도 Ⅱ', '위험도 Ⅲ'][this.dangerLevel] ?? `${this.dangerLevel}`;
      const dangerNum = this.add.text(this.scale.width / 2 + 246 * hs, 60 * hs, depthLabel,
        style(11 * hs, UI.emberText, { display: true }))
        .setOrigin(0.5).setScrollFactor(0).setDepth(1002);
      dangerNum.setShadow(0, 2, '#000000', 3, false, true);
    }

    if (resumeData) {
      // 이어하기: 모든 시스템이 준비된 뒤 스냅샷을 덮어쓴다
      RunSave.apply(this, resumeData);
      // 재도전 지갑: 골드는 되감지 않고 사망 시점 잔액을 그대로 쓴다.
      // (배율(goldMult/미다스)은 획득 시 이미 적용됐으므로 원값 그대로 대입)
      const retryGold = sceneData.retryGold == null
        ? null
        : Math.max(0, Math.round(sceneData.retryGold));
      let carry = 0;
      if (retryGold != null && this.pickupSystem) {
        carry = retryGold - (resumeData.runGold ?? 0);
        this.pickupSystem.runGold = retryGold;
        this.pickupSystem.spendGold(0); // 잔액 텍스트 갱신용 (0원 차감)
        // 스냅샷도 갱신 — 다시 죽어도 이 잔액이 되살아나거나 되감기지 않게
        RunSave.save(RunSave.capture(this));
      }
      this.time.delayedCall(400, () => {
        if (!this.isGameOver) {
          this.waveSystem?.announce?.(carry > 0
            ? `재도전 — 라운드 ${resumeData.round + 1} · 지난 도전의 골드 ${carry.toLocaleString()} 이월`
            : `이어하기 — 라운드 ${resumeData.round + 1}`, '#8fc3d8');
        }
      });
    } else {
      // 튜토리얼은 새 런에서만 — 이어하기는 이미 흐름을 아는 플레이어다.
      // (판정은 인트로보다 먼저: 인트로가 초심자 힌트를 띄울지 결정해야 한다)
      if (consumeTutorialRequest()) {
        this.time.delayedCall(1200, () => {
          if (!this.isGameOver && !this.player?.isDead) {
            this.tutorial.start();
          }
        });
        this.tutorialQueued = true;
      }
      this.showRunIntro();
    }

    // Scene restarts reuse the same event emitter: drop this run's listeners on shutdown.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.handleResize, this); // ScaleManager는 전역 — 매 재시작마다 리스너가 누적되는 것을 방지
      this.events.off(GameEvents.ENEMY_DIED);
      this.events.off(GameEvents.LEVEL_UP);
      this.events.off(GameEvents.UPGRADE_CHOSEN);
      this.events.off(GameEvents.SWORD_FUSED);
      this.waveSystem?.destroy();
      this.pickupSystem?.destroy();
      this.augmentSystem?.destroy();
      this.hudSystem?.destroy();
      this.bossBar?.destroy();
      this.statsPanel?.destroy();
      this.villageSystem?.destroy();
      this.tutorial?.destroy();
      this.activeSkills?.destroy();
      this.keeper?.destroy();
      this.dangerEvents?.destroy();
      this.skillWindow?.destroy();
      this.skillTree?.destroy();
      this.achievements?.destroy();
      this.bossCutIn?.destroy();
      // 씬이 내려갈 때 히트스톱 배율이 남아 있으면 다음 씬이 느리게 시작한다
      this.visualEffects?.releaseHitStop();
      this.elementSets?.destroy();
      this.elementAura?.destroy();
      this.statusEffects?.destroy();
      this.gamepad?.destroy();
      this.gamepad = null;
      this.unbindKeybinds?.();
      this.unbindKeybinds = null;
    });

    // 키퍼 머리 위 체력바는 2026-09-04 제거 — 하단 화로 게이지가 단일 출처다 (사용자 요청)

    this.enemyHitOverlap = this.physics.add.overlap(
      this.player,
      this.enemyManager.enemies,
      this.handlePlayerEnemyOverlap,
      undefined,
      this,
    );

    this.player.anims.play(this.playerConfig.animations.idle);
    this.player.on(Phaser.Animations.Events.ANIMATION_COMPLETE, this.handlePlayerAnimationComplete, this);

    this.cursors = this.input.keyboard!.createCursorKeys();
    // 이동 키 — 2026-09-04 부터 기본 화살표 (W/A/S/D 는 스킬 핫키 풀로). 리맵은 core/keybinds.
    this.rebuildMoveKeys();
    this.unbindKeybinds = onKeybindsChanged(() => this.rebuildMoveKeys());

    // 게임패드: 좌스틱 이동은 update() 가 직접 읽고, 버튼은 키 이벤트로 합성된다.
    // 창(일시정지·레벨업·상점·마을 시설)이 열려 있으면 'ui' 맥락으로 바꿔 A=확정이 된다.
    this.gamepad = new GamepadSystem(this, {
      context: () => (this.isPaused || this.isGameOver || this.levelUpSystem?.isOpen
        || this.shopSystem?.isOpen || this.augmentSystem?.isOpen
        || this.villageSystem?.windowOpen || this.villageSystem?.scoutOpen
        || this.statsPanel?.isOpen || this.skillWindow?.isOpen ? 'ui' : 'game'),
    });

    this.input.keyboard!.on('keydown-ESC', () => this.togglePause());
    this.input.keyboard!.addCapture('TAB'); // 브라우저 포커스 이동 방지
    // 캐릭터창은 리맵 가능 — 기본값 TAB
    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      if (event.keyCode === getBindingCode('stats')) {
        this.statsPanel?.toggle();
      } else if (event.keyCode === getBindingCode('skills')) {
        // 스킬 창 (K): 키 배정 대기 중이면 그 키 입력은 창이 먼저 먹는다
        if (!this.skillWindow?.isCapturingKey) {
          this.skillWindow?.toggle();
        }
      }
    });
    // 총람 패널이 열려 있을 때만 갈래 전환 (평소 이동 입력과 겹치지 않도록 좌우 화살표만)
    this.input.keyboard!.on('keydown-LEFT', () => this.statsPanel?.cycleTab(-1));
    this.input.keyboard!.on('keydown-RIGHT', () => this.statsPanel?.cycleTab(1));
    this.input.keyboard!.on('keydown-M', () => {
      this.soundSystem.toggleMute();
      this.refreshPauseUi();
    });
    this.input.keyboard!.on('keydown-R', () => {
      if (this.isPaused) {
        this.scene.restart({ characterId: this.characterId, danger: this.dangerLevel });
      }
    });
    this.input.keyboard!.on('keydown-T', () => {
      if (this.isPaused) {
        this.scene.start('TitleScene');
      }
    });

    this.scale.on('resize', this.handleResize, this);

    // 출격 집계 (이어하기는 새 런이 아니다)
    if (!resumeData) {
      this.achievements.onRunStart();
    }

    if (import.meta.env.DEV) {
      window.__gameScene = this; // dev-only debug hook (stripped from production builds)
      window.__RunSave = RunSave; // 세이브 왕복 회귀 테스트용
      window.__keywords = KEYWORDS; // 온보딩 용어 사전 회귀 테스트용
      window.__codex = codexApi; // 도감 이력 회귀 테스트용 (meta-test.mjs)
      window.__stats = statsApi; // 누적 통계 회귀 테스트용
      window.__telemetry = telemetryApi; // 로컬 런 기록 회귀 테스트용 (meta-test.mjs)
      window.__achievements = AchievementSystem; // 도전과제 회귀 테스트용
      window.__settings = settingsApi; // 접근성 설정 회귀 테스트용 (polish-test.mjs)
      window.__keybinds = keybindsApi; // 키 리맵 회귀 테스트용 (polish-test.mjs)
    }
  }

  /**
   * 런 시작 인트로: 스토리 3줄(항상) + 초심자 조작 힌트(초반 플레이어만).
   * 좌측 중단에 순차 등장 — 배너 스택과 겹치지 않고, 전투를 가리지 않는다.
   */
  showRunIntro() {
    const hs = this.waveSystem?.hs ?? 1;
    const baseX = 24 * hs;
    const baseY = this.scale.height * 0.32;
    const lines: Array<{ text: string; color: string }> = [];

    // 월드(어두운 들판) 위에 뜨는 텍스트 — 밝은 색만 쓴다
    if (this.dangerLevel === 0) {
      lines.push(
        { text: '스승이 사라진 지 마흔 밤.', color: '#dfe5e9' },
        { text: '남은 것은 검 두 자루, 그리고 식지 않는 화로의 심장.', color: '#dfe5e9' },
        { text: '오늘, 검들이 먼저 광맥 쪽으로 날개를 폈다.', color: '#4fb8ff' },
      );
    } else {
      lines.push(
        { text: `위험도 ${['', 'Ⅱ', 'Ⅲ'][this.dangerLevel]} — 녹이 더 짙다.`, color: UI.emberText },
      );
    }

    // 튜토리얼이 곧 뜨는 런에서는 같은 내용을 두 번 말하지 않는다
    const isNewKeeper = !this.tutorialQueued && MetaProgression.load().lifetimeGold < 500;
    if (isNewKeeper) {
      lines.push(
        { text: '검은 스스로 사냥합니다 — 이동(화살표)으로 무리를 몰기만 하면 됩니다.', color: '#b7c1c9' },
        { text: '은빛 XP 조각을 모으면 LEVEL UP — 무리가 강해집니다.', color: '#b7c1c9' },
      );
    }

    lines.forEach((line, index) => {
      const text = this.add.text(baseX, baseY + index * 26 * hs, line.text, style(14 * hs, line.color, { bold: false }))
        .setOrigin(0, 0.5).setScrollFactor(0).setDepth(1500).setAlpha(0);
      text.setShadow(0, 2, '#000000', 4, false, true);
      if (reduceMotion()) {
        text.setAlpha(1);
        this.time.delayedCall(5200, () => text.destroy());
        return;
      }
      this.tweens.add({
        targets: text, alpha: 1, x: baseX + 6,
        duration: 300, delay: 500 + index * 650, ease: 'Quad.easeOut',
        onComplete: () => {
          this.tweens.add({
            targets: text, alpha: 0, delay: 3600, duration: 500,
            onComplete: () => text.destroy(),
          });
        },
      });
    });
  }

  /** 전체 화면 오버레이(레벨업·상점·결과)가 열릴 때 인게임 HUD 를 숨긴다 */
  setGameHudVisible(visible: boolean) {
    if (!visible) {
      this.statsPanel?.close();
    }
    this.hudSystem?.setVisible(visible);
    this.bossBar?.setVisible(visible);
    this.activeSkills?.setVisible(visible);
    this.waveSystem?.setHudVisible(visible);
    for (const icon of this.swordOrbit?.hudIcons ?? []) {
      (icon as Phaser.GameObjects.Image).setVisible(visible);
    }
    if (!visible) {
      this.swordOrbit?.hideHudTooltip();
    }
  }

  applyPlayerHitbox(player: PlayerSprite, playerConfig: PlayerDefinition) {
    const hitbox = playerConfig?.hitbox;

    if (!player || !hitbox) {
      return;
    }

    if (hitbox.shape === 'circle') {
      player.setCircle?.(hitbox.radius!, hitbox.offsetX, hitbox.offsetY);
      return;
    }

    if (hitbox.shape === 'box') {
      player.setSize(hitbox.width!, hitbox.height!);
      player.setOffset(hitbox.offsetX ?? 0, hitbox.offsetY ?? 0);
    }
  }

  createInitialChunks(viewportWidth: number, viewportHeight: number) {
    // 예전엔 "긴 축 기준 정사각 반경 + 1"이라 1280×720에서 반경 3 → 7×7=49청크
    // (3584×3584px = 가시 면적의 약 14배)를 항상 로드했다. 청크당 장식 ~3.9개이므로
    // 시작하자마자 화면 밖 장식 190개가 상주했고, 창이 크면 81청크/310개까지 갔다.
    // → 축별 반경으로 바꾸고 여유분을 1칸으로 유지해 실제 필요한 만큼만 로드한다.
    // 2026-09-01: 여유 +1 도 걷어냈다. 반경 ceil(반쪽 화면 / 청크) 이면 **수학적으로**
    // 화면 전체가 덮인다 — 플레이어가 청크 안 어디에 서 있든(오프셋 f∈[0,512))
    // 필요한 최소 청크 인덱스는 floor((px-half)/size) ≥ cx - ceil(half/size) 이다.
    // 1280×720 기준 7×5=35 → 5×3=15 로 줄어든다(표시 레이어는 어차피 12).
    // 여유분이 하던 "미리 굽기" 역할은 경계를 넘은 프레임에 즉시 굽는 것으로 대신한다
    // (updateChunksAroundPlayer 의 urgent 경로).
    this.chunkLoadRadiusX = Math.max(1, Math.ceil((viewportWidth / 2) / this.chunkPixelSize));
    this.chunkLoadRadiusY = Math.max(1, Math.ceil((viewportHeight / 2) / this.chunkPixelSize));
    // 언로드 판정 등 단일 값을 쓰는 기존 경로와의 호환을 위해 최대값을 남겨 둔다.
    this.chunkLoadRadius = Math.max(this.chunkLoadRadiusX, this.chunkLoadRadiusY);
  }

  handleResize(gameSize: Phaser.Structs.Size) {
    const { width, height } = gameSize;

    if (this.player) {
      this.createInitialChunks(width, height);
      this.updateChunksAroundPlayer(this.player.x, this.player.y, true);
    }
  }

  updateChunksAroundPlayer(playerX: number, playerY: number, forceUpdate = false) {
    const currentChunkX = Math.floor(playerX / this.chunkPixelSize);
    const currentChunkY = Math.floor(playerY / this.chunkPixelSize);

    if (!forceUpdate && currentChunkX === this.playerChunkX && currentChunkY === this.playerChunkY) {
      return;
    }

    this.playerChunkX = currentChunkX;
    this.playerChunkY = currentChunkY;

    const requiredKeys = new Set<string>();

    const missingChunks: ChunkMeta[] = [];

    for (let y = currentChunkY - this.chunkLoadRadiusY; y <= currentChunkY + this.chunkLoadRadiusY; y += 1) {
      for (let x = currentChunkX - this.chunkLoadRadiusX; x <= currentChunkX + this.chunkLoadRadiusX; x += 1) {
        const key = `${x},${y}`;
        requiredKeys.add(key);

        if (!this.loadedChunks.has(key) && !this.pendingChunkKeys.has(key)) {
          missingChunks.push({ x, y, key });
        }
      }
    }

    missingChunks.sort((a, b) => {
      const distA = Math.abs(a.x - currentChunkX) + Math.abs(a.y - currentChunkY);
      const distB = Math.abs(b.x - currentChunkX) + Math.abs(b.y - currentChunkY);
      return distA - distB;
    });

    for (const chunkMeta of missingChunks) {
      this.chunkBuildQueue.push(chunkMeta);
      this.pendingChunkKeys.add(chunkMeta.key);
    }

    this.unloadFarChunks(requiredKeys);

    // 로드 반경에 여유가 없으므로(위 주석) 새로 필요해진 청크는 **이번 프레임에** 채운다.
    // 경계 통과는 몇 초에 한 번뿐이고 청크 하나가 1ms 미만이라, 한 열(3개)을 몰아 구워도
    // 3ms 남짓이다 — 화면 가장자리에 빈 땅이 비치는 것보다 낫다.
    if (!forceUpdate && missingChunks.length > 0) {
      this.processChunkQueue(6);
    }
  }

  processChunkQueue(forcedBudgetMs = this.chunkBuildBudgetMs) {
    if (this.chunkBuildQueue.length === 0) {
      return;
    }

    const startedAt = performance.now();

    while (this.chunkBuildQueue.length > 0) {
      const nextChunk = this.chunkBuildQueue.shift();

      if (!nextChunk) {
        break;
      }

      this.pendingChunkKeys.delete(nextChunk.key);

      if (this.loadedChunks.has(nextChunk.key)) {
        continue;
      }

      const chunk = this.acquireChunk(nextChunk.x, nextChunk.y);
      if (chunk) {
        chunk.cx = nextChunk.x;
        chunk.cy = nextChunk.y;
      }
      this.paintChunk(chunk, nextChunk.x, nextChunk.y);
      this.decorateChunk(chunk, nextChunk.x, nextChunk.y);
      this.loadedChunks.set(nextChunk.key, chunk as ChunkTile);

      if (performance.now() - startedAt >= forcedBudgetMs) {
        break;
      }
    }
  }

  acquireChunk(chunkX: number, chunkY: number): ChunkTile | null {
    // 파괴된 레이어(scene 없음)가 풀에 섞여 있으면 버리고 살아있는 것만 재사용
    let pooledChunk = this.chunkPool.pop();
    while (pooledChunk && !pooledChunk.layer.scene) {
      pooledChunk = this.chunkPool.pop();
    }

    if (pooledChunk) {
      pooledChunk.layer.setPosition(chunkX * this.chunkPixelSize, chunkY * this.chunkPixelSize);
      pooledChunk.layer.setVisible(true);
      pooledChunk.layer.setActive(true);
      return pooledChunk;
    }

    const map = this.make.tilemap({
      tileWidth: this.tileSize,
      tileHeight: this.tileSize,
      width: this.chunkTiles,
      height: this.chunkTiles,
    });

    // 테마 타일 스트립 한 장 (themes64.png) — 타일 인덱스 = MAP_THEMES[n].tile
    const themeTileset = map.addTilesetImage('themes', 'ts-themes', this.tileSize, this.tileSize, 0, 0, 0);
    if (!themeTileset) {
      return null;
    }

    const layer = map.createBlankLayer('ground', themeTileset, chunkX * this.chunkPixelSize, chunkY * this.chunkPixelSize)!;
    layer.setDepth(-5);
    // 틴트는 paintChunk 가 현재 맵 테마로 칠한다 (라운드마다 바뀐다)

    return { map, layer, decos: [], cx: chunkX, cy: chunkY };
  }

  /**
   * 청크에 Tiny Swords 장식을 결정론적으로 흩뿌린다 (같은 청크는 언제나 같은 배치).
   * depth -4: 바닥(-5) 위, 플레이어·적 아래 — 이동을 가리지 않는다.
   */
  decorateChunk(chunk: ChunkTile | null, chunkX: number, chunkY: number) {
    if (!chunk) {
      return;
    }

    // mulberry32 — 청크 좌표 해시 시드
    let seed = (Math.imul(chunkX, 0x9e3779b1) ^ Math.imul(chunkY, 0x85ebca6b)) >>> 0;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const baseX = chunkX * this.chunkPixelSize;
    const baseY = chunkY * this.chunkPixelSize;
    const place = (obj: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image, size: number) => {
      obj.setDepth(-4);
      // 프레임 종횡비 유지 — tree1·2는 192×256이라 정사각형으로 누르면 찌그러진다
      const frame = obj.frame;
      const aspect = frame && frame.width > 0 ? frame.height / frame.width : 1;
      obj.setDisplaySize(size, size * aspect);
      obj.setTint(this.currentTheme.decoTint); // 맵 테마 톤으로 통일
      chunk.decos.push(obj);
    };
    const px = () => baseX + 24 + rand() * (this.chunkPixelSize - 48);
    const py = () => baseY + 24 + rand() * (this.chunkPixelSize - 48);

    // ── 테마 전용 장식 (deco2/*) — 있으면 이 분기로 끝난다.
    // 큰 장식(나무·기둥) 0~2 + 소형(잔풀·돌·버섯) 0~4×밀도. 흔들림 애니는 없다.
    const themed = this.currentTheme.decos;
    if (themed && themed.length > 0) {
      const density = this.currentTheme.density ?? 1;
      const bigDecos = themed.filter((entry) => !entry.small);
      const smallDecos = themed.filter((entry) => entry.small);
      const placeThemed = (list: typeof themed, count: number) => {
        for (let i = 0; i < count; i += 1) {
          const spec = list[Math.floor(rand() * list.length)];
          if (!spec || !this.textures.exists(spec.key)) {
            continue;
          }
          // spec.size = 표시 높이(px) — 원본 종횡비 유지
          const img = this.add.image(px(), py(), spec.key);
          const aspect = img.frame && img.frame.height > 0 ? img.frame.width / img.frame.height : 1;
          img.setDisplaySize(Math.round(spec.size * aspect), spec.size);
          img.setDepth(-4);
          img.setTint(this.currentTheme.decoTint);
          chunk.decos.push(img);
        }
      };
      if (bigDecos.length > 0) {
        placeThemed(bigDecos, rand() < 0.55 * density ? (rand() < 0.3 ? 2 : 1) : 0);
      }
      if (smallDecos.length > 0) {
        placeThemed(smallDecos, Math.floor(rand() * 5 * density));
      }
      return;
    }

    // ── 폴백: Tiny Swords DECO_ATLAS (잿불·서리 테마 — 흔들림 애니메이션 유지)
    // 프레임 이름은 `${원본 키}/${프레임 번호}` (예: deco-tree1/0).
    const hasFrame = (name: string) => Boolean(this.textures.getFrame(DECO_ATLAS, name));

    // 나무 0~2그루 (흔들림 애니메이션)
    const treeCount = rand() < 0.55 ? (rand() < 0.3 ? 2 : 1) : 0;
    for (let i = 0; i < treeCount; i += 1) {
      const key = `deco-tree${1 + Math.floor(rand() * 4)}`;
      if (!hasFrame(`${key}/0`)) continue;
      const tree = this.add.sprite(px(), py(), DECO_ATLAS, `${key}/0`);
      if (this.anims.exists(`${key}-sway`)) {
        tree.play({ key: `${key}-sway`, startFrame: Math.floor(rand() * 8) });
      }
      place(tree, 96);
    }

    // 덤불 0~3
    const bushCount = Math.floor(rand() * 4);
    for (let i = 0; i < bushCount; i += 1) {
      const key = `deco-bush${1 + Math.floor(rand() * 4)}`;
      if (!hasFrame(`${key}/0`)) continue;
      const bush = this.add.sprite(px(), py(), DECO_ATLAS, `${key}/0`);
      if (this.anims.exists(`${key}-sway`)) {
        bush.play({ key: `${key}-sway`, startFrame: Math.floor(rand() * 8) });
      }
      place(bush, 40);
    }

    // 바위 0~3
    const rockCount = Math.floor(rand() * 4);
    for (let i = 0; i < rockCount; i += 1) {
      const frame = `deco-rock${1 + Math.floor(rand() * 4)}/0`;
      if (!hasFrame(frame)) continue;
      place(this.add.image(px(), py(), DECO_ATLAS, frame), 22);
    }

    // 금덩이 — 드물게 (광맥 무드)
    if (rand() < 0.18) {
      const frame = `deco-goldstone${1 + Math.floor(rand() * 6)}/0`;
      if (hasFrame(frame)) {
        place(this.add.image(px(), py(), DECO_ATLAS, frame), 44);
      }
    }
  }

  paintChunk(chunk: ChunkTile | null, _chunkX: number, _chunkY: number) {
    if (!chunk) {
      return;
    }

    const { layer } = chunk;
    const theme = this.currentTheme;

    // 맵당 타일 정확히 1종 — 2종 이상 섞으면 색 경계가 뚝뚝 끊긴다 (사용자 결정).
    // 분위기는 (타일 × 레이어 틴트 × 전용 장식) 조합으로 낸다.
    layer.fill(theme.tile, 0, 0, this.chunkTiles, this.chunkTiles);
    layer.setTint(theme.layerTint);
  }

  /**
   * 맵 테마 교체 — 로드된 청크 전부를 새 테마로 다시 칠하고 장식 톤을 맞춘다.
   * 라운드 입장 연출(stageRoundEntry)의 가림막 뒤에서 호출된다.
   */
  applyMapTheme(theme: MapTheme) {
    this.currentTheme = theme;
    this.cameras.main.setBackgroundColor(theme.bgColor);
    for (const [, chunk] of this.loadedChunks.entries()) {
      const chunkX = chunk.cx;
      const chunkY = chunk.cy;
      this.paintChunk(chunk, chunkX, chunkY);
      // 장식은 테마 전용 스프라이트가 다르므로 재생성한다 (같은 시드 → 같은 배치 골격)
      for (const deco of chunk.decos) {
        deco.destroy();
      }
      chunk.decos.length = 0;
      this.decorateChunk(chunk, chunkX, chunkY);
    }
  }

  /**
   * 라운드 입장: 새 맵으로 "걸어 들어가는" 연출.
   * 동기부(즉시): 테마 교체 + 플레이어/검 원점 복귀 + 청크 재구축 — 가림막이 전부 가린다.
   * 연출부: 검은 가림막 위 타이틀 카드(라운드·지명·목표) → 걷히며 카메라 줌 스냅.
   * WaveSystem.startRound 가 스폰 **이전**에 호출한다 (스폰 위치가 새 원점을 따르도록).
   */
  stageRoundEntry(round: number, theme: MapTheme, objectiveLabel: string, dangerNote: string | null = null) {
    // ── 동기부: 화면이 가려진 사이 세계를 통째로 갈아끼운다
    this.applyMapTheme(theme);
    const px = this.scale.width / 2;
    const py = this.scale.height / 2;
    if (this.player) {
      this.player.setPosition(px, py);
      (this.player.body as Phaser.Physics.Arcade.Body | null)?.reset(px, py);
    }
    for (const sword of this.swordOrbit?.swords ?? []) {
      sword.setPosition(px, py);
    }
    this.cameras.main.centerOn(px, py);
    this.updateChunksAroundPlayer(px, py, true);
    this.processChunkQueue(24); // 가림막 뒤라 프레임 스파이크 허용 — 즉시 채운다

    // ── 연출부: 이전 연출이 남아 있으면 정리
    for (const object of this.roundEntryObjects) {
      object.destroy();
    }
    this.roundEntryObjects = [];

    const { width, height } = this.scale;
    const cover = this.add.rectangle(width / 2, height / 2, width, height, 0x06080a, 1)
      .setScrollFactor(0).setDepth(2790);
    const accent = Phaser.Display.Color.HexStringToColor(theme.accent).color;
    const decoObjects = [
      divider(this, width / 2, height / 2 - 64, 260, accent),
      divider(this, width / 2, height / 2 + 58, 200, accent),
      this.add.image(width / 2, height / 2 - 64, 'uf-icon-point').setDisplaySize(10, 8).setTint(accent),
    ];
    for (const object of decoObjects) {
      object.setScrollFactor(0).setDepth(2791);
    }

    const roundText = this.add.text(width / 2, height / 2 - 30, `라운드 ${round}`, {
      fontFamily: FONT.display, resolution: TEXT_RESOLUTION,
      fontSize: '30px', fontStyle: '800', color: UI.textDim,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2792);
    const nameText = this.add.text(width / 2, height / 2 + 10, theme.name, {
      fontFamily: FONT.display, resolution: TEXT_RESOLUTION,
      fontSize: '44px', fontStyle: '900', color: theme.accent,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2792);
    nameText.setShadow(0, 4, '#000000', 10, false, true);
    const objText = this.add.text(width / 2, height / 2 + 80, `목표 — ${objectiveLabel}`, style(15, UI.text))
      .setOrigin(0.5).setScrollFactor(0).setDepth(2792);
    const moodText = this.add.text(width / 2, height / 2 + 104, theme.desc, style(12, UI.textFaint, { bold: false }))
      .setOrigin(0.5).setScrollFactor(0).setDepth(2792);

    // 계단식 파워 스파이크 경계: 타이틀 카드에 위험도 상승 한 줄을 얹는다
    // (WaveSystem 이 문구를 만들고, 여기서는 표시만 한다 — 새 시스템을 만들지 않는다)
    const dangerText = dangerNote
      ? this.add.text(width / 2, height / 2 + 130, dangerNote, style(13, '#e0623c'))
        .setOrigin(0.5).setScrollFactor(0).setDepth(2792)
      : null;

    this.roundEntryObjects = [cover, ...decoObjects, roundText, nameText, objText, moodText];
    if (dangerText) {
      this.roundEntryObjects.push(dangerText);
    }
    const finish = () => {
      for (const object of this.roundEntryObjects) {
        object.destroy();
      }
      this.roundEntryObjects = [];
    };

    if (reduceMotion()) {
      // 모션 최소화: 가림막 없이 타이틀만 잠깐 — 지도 교체는 이미 끝났다
      cover.setAlpha(0.55);
      this.time.delayedCall(1400, finish);
      return;
    }

    const texts = [roundText, nameText, objText, moodText, ...(dangerText ? [dangerText] : [])];
    for (const text of texts) {
      text.setAlpha(0);
    }
    for (const object of decoObjects) {
      object.setAlpha(0);
    }
    this.tweens.add({ targets: [...decoObjects, roundText, nameText], alpha: 1, duration: 240, ease: 'Quad.easeOut' });
    this.tweens.add({
      targets: [objText, moodText, ...(dangerText ? [dangerText] : [])],
      alpha: 1, duration: 240, delay: 260, ease: 'Quad.easeOut',
    });
    // 걷히기: 커버·텍스트 페이드 + 카메라 줌 스냅 (새 땅에 내려서는 느낌)
    this.tweens.add({
      targets: this.roundEntryObjects,
      alpha: 0,
      delay: 1150,
      duration: 420,
      ease: 'Quad.easeIn',
      onComplete: finish,
    });
    const camera = this.cameras.main;
    this.tweens.killTweensOf(camera); // 직전 라운드의 줌 트윈 잔여분 제거
    camera.setZoom(1.08);
    this.tweens.add({ targets: camera, zoom: 1, delay: 1150, duration: 520, ease: 'Quad.easeOut' });
  }

  /**
   * 청크 단위 장식 컬링.
   *
   * Phaser는 임의 GameObject를 프러스텀 컬링하지 않는다 — 화면 밖 장식도 매 프레임
   * 렌더 배치에 올라가고, sway 애니메이션까지 계속 돈다. 라운드 14 시점에 화면 밖
   * 오브젝트가 display list의 80%를 넘어 렌더가 게임 로직의 3배를 먹고 있었다.
   *
   * 개별 오브젝트가 아니라 **청크 사각형 단위**로 판정하므로 프레임당 검사 횟수는
   * 로드된 청크 수(십여 개)뿐이다.
   */
  private cullChunkDecorations(): void {
    const now = this.time.now;
    // 카메라는 부드럽게 움직이므로 매 프레임 판정할 필요가 없다
    if (now - this.lastDecoCullAt < 120) {
      return;
    }
    this.lastDecoCullAt = now;
    // 유예가 끝난 청크 해제도 이 주기에 태운다 (경계를 넘은 뒤 멈춰 서 있어도 정리된다)
    this.sweepExpiredChunks(now);

    const camera = this.cameras.main;
    const margin = 96; // 큰 장식(나무 96px)이 경계에서 튀지 않도록 여유
    const left = camera.scrollX - margin;
    const right = camera.scrollX + camera.width + margin;
    const top = camera.scrollY - margin;
    const bottom = camera.scrollY + camera.height + margin;
    const size = this.chunkPixelSize;

    for (const [, chunk] of this.loadedChunks.entries()) {
      const originX = chunk.cx * size;
      const originY = chunk.cy * size;
      const chunkTouches = originX + size >= left && originX <= right
        && originY + size >= top && originY <= bottom;

      // 바닥 타일 레이어도 청크 단위로 컬링한다. Phaser는 화면 밖 TilemapLayer에도
      // 레이어당 컬링 연산·렌더 준비 비용을 매 프레임 지불한다 — 로드 반경(7×5=35)에서
      // 화면에 걸치는 청크는 ~8개뿐이라 나머지 27개 레이어 비용이 통째로 낭비였다.
      // (2026-08-31 A/B: 화면 밖 레이어만 숨겨도 샌드박스 기준 프레임 시간 45→23ms)
      if (chunk.layer.visible !== chunkTouches) {
        chunk.layer.setVisible(chunkTouches);
      }

      if (chunk.decos.length === 0) {
        continue;
      }

      // 청크 전체가 화면 밖이면 개별 검사 없이 통째로 숨긴다 (대부분의 청크가 여기 해당).
      if (!chunkTouches) {
        if (chunk.decosVisible !== false) {
          chunk.decosVisible = false;
          for (const deco of chunk.decos) {
            this.setDecoVisible(deco as Phaser.GameObjects.Sprite, false);
          }
        }
        continue;
      }

      // 경계에 걸친 청크는 장식 하나씩 판정한다 — 청크 단위로만 자르면 걸친 청크의
      // 화면 밖 장식(청크당 최대 ~4개)이 그대로 남는다. 개수가 적어 비용은 무시할 수준.
      chunk.decosVisible = true;
      for (const deco of chunk.decos) {
        const obj = deco as Phaser.GameObjects.Sprite;
        const visible = obj.x >= left && obj.x <= right && obj.y >= top && obj.y <= bottom;
        this.setDecoVisible(obj, visible);
      }
    }
  }

  /** 장식 하나의 표시/애니메이션 상태를 바꾼다 (값이 그대로면 아무것도 하지 않는다). */
  private setDecoVisible(obj: Phaser.GameObjects.Sprite, visible: boolean): void {
    if (obj.visible === visible) {
      return;
    }
    obj.setVisible(visible);
    // sway 애니메이션도 화면 밖에서는 멈춘다 (UpdateList 부담 제거)
    if (obj.anims?.currentAnim) {
      if (visible) {
        obj.anims.resume();
      } else {
        obj.anims.pause();
      }
    }
  }

  unloadFarChunks(requiredKeys: Set<string>) {
    const now = this.time.now;
    for (const [key, chunk] of this.loadedChunks.entries()) {
      if (requiredKeys.has(key)) {
        chunk.unloadAt = undefined; // 다시 필요해졌다 — 유예 취소
      } else if (chunk.unloadAt === undefined) {
        chunk.unloadAt = now + CHUNK_UNLOAD_GRACE_MS;
      }
    }
    this.sweepExpiredChunks(now);

    if (requiredKeys.size > 0) {
      this.chunkBuildQueue = this.chunkBuildQueue.filter((queued) => requiredKeys.has(queued.key));
      this.pendingChunkKeys = new Set(this.chunkBuildQueue.map((queued) => queued.key));
    }
  }

  /** 유예가 끝난 청크를 실제로 해제한다 (레이어·타일맵은 풀로, 장식은 파괴). */
  private sweepExpiredChunks(now: number): void {
    for (const [key, chunk] of this.loadedChunks.entries()) {
      if (chunk.unloadAt === undefined || now < chunk.unloadAt) {
        continue;
      }
      chunk.layer.setVisible(false);
      chunk.layer.setActive(false);

      // 장식은 풀링하지 않고 파괴 — 재로드 시 같은 시드로 다시 생성된다
      for (const deco of chunk.decos) {
        deco.destroy();
      }
      chunk.decos.length = 0;
      chunk.decosVisible = undefined;
      chunk.unloadAt = undefined;

      if (this.chunkPool.length < this.maxPoolSize) {
        this.chunkPool.push(chunk);
      } else {
        chunk.layer.destroy();
        chunk.map.destroy();
      }

      this.loadedChunks.delete(key);
    }
  }

  tileNoise(x: number, y: number): number {
    const seed = (x * 374761393 + y * 668265263) ^ 0x27d4eb2d;
    const hashed = (seed ^ (seed >>> 13)) * 1274126177;
    return ((hashed ^ (hashed >>> 16)) >>> 0) / 4294967295;
  }

  update(time: number, delta: number) {
    // 게임패드는 모든 조기 반환보다 먼저 — 일시정지·레벨업·결과 화면에서도 버튼이 먹어야 한다.
    // (패드 미연결이면 즉시 반환하므로 비용 0)
    this.gamepad?.update(time);
    // 배경음 상황 판정은 어떤 조기 반환보다 먼저 (일시정지·레벨업 중에도 음악은 흐른다)
    this.updateBgm(time);
    // 튜토리얼도 조기 반환 위 — 마을/레벨업/일시정지 상황을 스스로 판정해야 한다
    // (하는 일은 숫자 비교 몇 번 + 하이라이트 좌표 갱신뿐)
    this.tutorial?.update(delta);

    if (this.player?.isDead) {
      this.player.setVelocity(0, 0);
      return;
    }

    if (this.levelUpSystem?.isOpen || this.isPaused || this.shopSystem?.isOpen || this.augmentSystem?.isOpen || this.skillWindow?.isOpen) {
      return;
    }

    // 히트스톱 감시자: 복구 타이머를 놓쳤거나 시간 배율이 남아 있으면 되돌린다.
    // (히트스톱은 더 이상 physics.pause 를 쓰지 않는다 — 과거 재시작 프리즈의 원인)
    this.visualEffects?.syncHitStop(time);

    // 유령 pause 감시자: UI/사망/게임오버 어느 것도 물리를 멈출 이유가 없는데
    // 월드가 멈춰 있으면 복구한다 (다른 경로의 pause 유실 대비).
    if (this.physics.world.isPaused && !this.isGameOver) {
      this.physics.resume();
    }

    // Passive regen — 피 7세트 [혈계]는 회복량을 깎는다
    if ((this.player.hpRegen ?? 0) > 0 && this.player.hp < this.player.maxHp) {
      const healMult = this.elementSets?.healMultiplier?.() ?? 1;
      // 재생(고정 N/s)은 체력 규모(hpScaleOf)로 환산 — 인플레이션 후에도 "초당 N%"로 읽히게
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + (this.player.hpRegen * hpScaleOf(this.player.maxHp) * healMult * delta) / 1000);
    }

    // 바람 6세트 [질풍]: 3초 무피격 시 이동이 빨라진다
    // 증강 [귀소의 방벽]: 귀소 직후 잠깐 더 빨라진다 (activeSkills.moveSpeedMult)
    const galeMult = (this.elementSets?.galeActive ? 1.25 : 1) * (this.activeSkills?.moveSpeedMult(time) ?? 1);
    const speed = (this.player?.moveSpeed ?? this.playerConfig?.stats?.moveSpeed ?? 150) * galeMult;
    const velocityX = this.getHorizontalInput() * speed;
    const velocityY = this.getVerticalInput() * speed;

    if (time >= this.player.knockbackUntil) {
      this.player.isKnockedBack = false;
      this.player.setVelocity(velocityX, velocityY);
    }

    this.updatePlayerFacing(velocityX);
    this.updatePlayerAnimation(velocityX, velocityY, time);
    this.updateChunksAroundPlayer(this.player.x, this.player.y);
    this.processChunkQueue();
    this.cullChunkDecorations();

    // 능동 스킬 (대시 잔상 · 귀소 넉백 창 · 쿨다운 HUD)
    this.activeSkills?.update(delta);
    this.keeper?.update(delta);

    // 대기마을: 적 스폰·웨이브·픽업은 멈추고 이동/궤도/상호작용만 돈다
    if (this.villageSystem?.isActive) {
      this.swordOrbit.update(this.player, delta, this.enemyManager.enemies);
      // 원소 세트 오라는 플레이어를 따라다녀야 한다 — 빼먹으면 순간이동한
      // 플레이어 대신 옛 자리(마을 중앙)에 오라가 남는다
      this.elementSets.update(delta);
      this.elementAura.update(delta);
      this.villageSystem.update();
      this.hudSystem.update();
      return;
    }

    this.enemyManager.update(this.player, delta);
    this.swordOrbit.update(this.player, delta, this.enemyManager.enemies);
    this.progression.update(this.player, delta);
    this.waveSystem.update(delta);
    this.pickupSystem.update();
    this.augmentSystem.update(delta);
    this.dangerEvents?.update(delta);
    this.skillTree?.update(delta);
    this.elementSets.update(delta);
    this.elementAura.update(delta);
    this.hudSystem.update();
    this.bossBar.update();

    // 적 체력바: 단일 Graphics 일괄 렌더 (적마다 Rectangle 2개 → 1패스, 성능)
    this.visualEffects?.drawEnemyHealthBars(this.enemyManager.enemies);
  }

  /**
   * 상황별 BGM 전환 — 대기마을 > 보스 > 전투 순으로 우선한다.
   * (마을 진입/출격은 villageSystem.isActive, 보스는 BossBarSystem 이 매 틱 갱신하는
   *  hasBoss 를 읽는다. 보스가 죽으면 자동으로 전투 트랙으로 되돌아온다.)
   */
  private updateBgm(now: number) {
    if (!this.bgm || this.isGameOver) {
      return;
    }
    if (now - this.bgmPollAt < 400) {
      return;
    }
    this.bgmPollAt = now;

    // 저체력 경고 재무장 (30% 위로 회복하면 다음 하락 때 다시 울린다)
    if (this.lowHpWarned && this.player && !this.player.isDead
      && (this.player.hp ?? 0) > (this.player.maxHp ?? 1) * 0.3) {
      this.lowHpWarned = false;
    }

    if (this.villageSystem?.isActive) {
      this.bgm.setTension(0);
      this.bgm.play('village');
      return;
    }
    this.bgm.play(this.bossBar?.hasBoss ? 'boss' : 'battle');
    this.bgm.setTension(this.combatTension());
  }

  /**
   * 전투 긴장도 0~1 — 전투 BGM 의 강화 레이어 음량을 정하는 값.
   *
   * 셋 다 이미 씬이 들고 있는 값이라 추가 계산이 거의 없다 (400ms 폴링에서만 호출):
   *   라운드 진행률  0.40  런이 깊어질수록 기본 톤이 올라간다
   *   적 밀도        0.40  화면에 살아 있는 적 수 (0~60마리 구간을 정규화)
   *   저체력         0.20  체력 45% 아래에서 선형으로 붙는다
   * 보스전은 별도 트랙(boss)이라 여기서 가산하지 않는다.
   *
   * 진행률 분모는 totalRounds(200)가 아니라 TENSION_ROUND_SPAN(60)이다 — 200 으로
   * 나누면 실제로 도달하는 구간(밸런스 시뮬 기준 30~50라)에서 값이 거의 0이라
   * 레이어 2가 평생 열리지 않는다.
   */
  private combatTension(): number {
    const round = this.waveSystem?.round ?? 0;
    const progress = Math.min(1, round / TENSION_ROUND_SPAN);

    const alive = this.enemyManager?.enemies?.countActive(true) ?? 0;
    const density = Math.min(1, alive / 60);

    const hp = this.player?.hp ?? 1;
    const maxHp = this.player?.maxHp ?? 1;
    const ratio = maxHp > 0 ? hp / maxHp : 1;
    const lowHp = ratio >= 0.45 ? 0 : Math.min(1, (0.45 - ratio) / 0.45);

    return Math.min(1, progress * 0.4 + density * 0.4 + lowHp * 0.2);
  }

  updatePlayerFacing(velocityX: number) {
    if (!this.player || this.player.isDead) {
      return;
    }

    if (velocityX < 0) {
      this.player.setFlipX(true);
      return;
    }

    if (velocityX > 0) {
      this.player.setFlipX(false);
    }
  }

  updatePlayerAnimation(velocityX: number, velocityY: number, time: number) {
    if (!this.player || this.player.isDead) {
      return;
    }

    if (this.player.isHurting) {
      return;
    }

    if (velocityX !== 0 || velocityY !== 0) {
      if (!this.player.anims.isPlaying || this.player.anims.currentAnim?.key !== this.playerConfig.animations.idle) {
        this.player.anims.play(this.playerConfig.animations.idle, true);
      }
      return;
    }

    if (this.player.anims.currentAnim?.key !== this.playerConfig.animations.idle) {
      this.player.anims.play(this.playerConfig.animations.idle, true);
    }
  }

  /**
   * 키퍼 레벨 성장 (logic/growth.ts, 2026-09-04):
   *  - 최대 체력 × (성장(L)/성장(L-1)) — 지금까지의 고정 가산분까지 같은 비율로 커진다
   *  - 체력 10% 회복 (사용자 요청) — 예산 밖(레벨업 보상)
   *  - 검 피해 성장 배율 갱신 (SwordOrbitSystem.setGrowthLevel)
   */
  applyLevelGrowth(level: number): void {
    const player = this.player;
    if (!player) {
      return;
    }
    const ratio = playerHpGrowth(level) / playerHpGrowth(Math.max(1, level - 1));
    if (ratio > 1) {
      const hpRatio = Math.max(0, Math.min(1, (player.hp ?? 0) / Math.max(1, player.maxHp ?? 1)));
      player.maxHp = Math.round(player.maxHp * ratio);
      player.hp = Math.round(player.maxHp * hpRatio);
    }
    const heal = Math.round(player.maxHp * 0.1);
    player.hp = Math.min(player.maxHp, player.hp + heal);
    if (heal > 0 && this.visualEffects) {
      this.visualEffects.showDamageText(player.x, player.y - 56, `+${formatHudNumber(heal)}`, false, '#84b04a');
    }
    this.swordOrbit?.setGrowthLevel(level);
  }

  handlePlayerEnemyOverlap(playerObj: PhysicsCallbackObject, enemyObj: PhysicsCallbackObject) {
    const player = playerObj as PlayerSprite;
    const enemy = enemyObj as EnemySprite;
    // 오라 버프(warlord/banneret) 반영된 접촉 피해
    const damage = this.enemyManager.effectiveContactDamage(enemy);
    const applied = this.applyPlayerDamage(damage, enemy.x, enemy.y, 'physical', enemy.catalog?.name ?? enemy.enemyType ?? null);

    // vampiric 어픽스: 플레이어를 문 만큼 자기 체력 회복
    if (applied && (enemy.vampiricHealMult ?? 0) > 0 && enemy.hp > 0) {
      enemy.hp = Math.min(enemy.maxHp, enemy.hp + Math.round(damage * enemy.vampiricHealMult!));
    }

    // Thorns: touching the player hurts (only when contact actually connected) — 고정값은 피해 규모로 환산
    if (applied && (player.thorns ?? 0) > 0) {
      this.enemyManager.takeDamage(enemy, Math.round(player.thorns * (this.swordOrbit?.flatDamageScale?.() ?? 1)), player, { silent: true });
    }
  }

  // Central player damage pipeline: invulnerability -> dodge -> defense/typed resist -> knockback
  applyPlayerDamage(rawDamage: number, sourceX: number | null = null, sourceY: number | null = null, damageType: DamageType = 'physical', sourceName: string | null = null): boolean {
    const player = this.player;

    if (!player || player.isDead) {
      return false;
    }

    const now = this.time.now;
    if (now < player.invulnerableUntil) {
      return false;
    }

    // 사인(死因) 추적 — FLAMEOUT 정산 화면에 "무엇에게 당했는지"를 띄운다
    if (sourceName) {
      this.lastHitBy = sourceName;
    }

    // 바람 7세트 [폭풍의 눈]: 날아드는 것을 회오리가 쳐낸다
    const negate = this.elementSets?.projectileNegateChance?.() ?? 0;
    if (negate > 0 && damageType === 'magic' && Math.random() < negate) {
      this.visualEffects?.fxArc(player.x, player.y, {
        r: 46, a0: 0, a1: Math.PI * 1.4, color: 0x9fd8c0, w: 3, alpha: 0.9, dur: 320, spin: 6,
      });
      player.invulnerableUntil = now + 200;
      return false;
    }

    // Dodge (회피)
    if ((player.dodgeChance ?? 0) > 0 && Math.random() < player.dodgeChance) {
      const missText = this.add.text(player.x, player.y - 60, '회피', {
        fontFamily: FONT.display,
        resolution: TEXT_RESOLUTION,
        fontSize: '19px',
        fontStyle: '700',
        color: '#9aa8b2',
        stroke: '#000000',
        strokeThickness: 3,
      }).setOrigin(0.5).setDepth(100);
      this.tweens.add({ targets: missText, y: missText.y - 40, alpha: 0, duration: 600, onComplete: () => missText.destroy() });
      player.invulnerableUntil = now + 300;
      return false;
    }

    // Defense (방어력, % 감소, 최대 60%) + 타입별 저항 (최대 50%)
    // 스킬 트리 [피의 갑옷]: 잃은 체력만큼 방어 가산
    const mitigated = mitigatePlayerDamage(rawDamage, (player.defense ?? 0) + (this.skillTree?.dynamicDefense?.() ?? 0), player.physicalResist ?? 0, player.magicResist ?? 0, damageType);
    // 증강: 받는 피해 배율 (수호 원환 0.94×, 리스크 계약 1.3× 등)
    // + BULWARK 해금 스탯: 받는 피해 감소 (최대 25%)
    const damage = Math.max(1, Math.round(
      mitigated
      * (this.augmentSystem?.damageTakenMult ?? 1)
      * (this.skillTree?.damageTakenMult?.() ?? 1)
      * (1 - Math.min(0.25, player.damageReduction ?? 0)),
    ));

    player.hp = Math.max(0, (player.hp ?? player.maxHp ?? 100) - damage);

    if (this.visualEffects) {
      this.visualEffects.showDamageText(player.x, player.y - 50, damage, false, '#ff7a7a');
    }

    this.soundSystem?.play('hurt');
    // 저체력 경고: 25% 아래로 "진입"할 때 1회 (심장박동은 SFX 안에 들어 있다).
    // 30% 위로 회복하면 다시 무장 — 경계선에서 연타되는 것을 막는다.
    const hpRatio = (player.hp ?? 0) / Math.max(1, player.maxHp ?? 1);
    if (!this.lowHpWarned && hpRatio > 0 && hpRatio <= 0.25) {
      this.lowHpWarned = true;
      this.soundSystem?.play('lowhp');
      this.waveSystem?.announce?.('화로가 꺼져간다 — 체력 25% 이하', UI.redBright);
    }
    // 원소 세트 훅: 얼음 6[서리 갑옷] 반격, 바람 6[질풍] 해제
    this.elementSets?.onPlayerHurt?.();
    // 필살기 게이지: 맞아도 찬다 (몰린 상황에서 반격 수단)
    this.activeSkills?.addUltCharge(this.activeSkills.catalog.ult.chargePerHurt);
    // 스킬 트리: 반격 폭풍 · 불사조 · 바람의 길 타이머
    this.skillTree?.onPlayerHurt?.();
    // 키퍼 고유 훅: BASTION [반격 사출] — 사슬 궤도의 검 한 자루가 풀린다
    this.keeper?.onPlayerHurt?.();
    // 도전과제: 보스전 무피격 판정 해제
    this.achievements?.onPlayerHit();
    player.invulnerableUntil = now + 850;
    player.isHurting = true;
    player.isKnockedBack = true;
    player.knockbackUntil = now + 180;

    if (sourceX !== null && sourceY !== null) {
      const knockbackAngle = Phaser.Math.Angle.Between(sourceX, sourceY, player.x, player.y);
      const knockbackSpeed = 260;
      const knockbackX = Math.cos(knockbackAngle) * knockbackSpeed;
      const knockbackY = Math.sin(knockbackAngle) * knockbackSpeed;

      player.setVelocity(knockbackX, knockbackY);
      player.setFlipX(knockbackX < 0);
    }

    player.anims.play(this.playerConfig.animations.hurt, true);

    if (player.hp <= 0) {
      this.killPlayer();
    }

    return true;
  }

  killPlayer() {
    if (!this.player || this.player.isDead) {
      return;
    }

    // 스킬 트리 [불굴]: 런당 1회 40% 로 다시 선다 (메타 부활보다 먼저 소모)
    if (this.skillTree?.consumeUnyielding?.()) {
      this.player.hp = Math.round(this.player.maxHp * 0.4);
      this.player.invulnerableUntil = this.time.now + 2000;
      this.player.isHurting = false;
      this.soundSystem?.play('revive');
      this.waveSystem?.announce?.('불굴 — 무릎은 꿇지 않는다', '#9bc25b');
      this.visualEffects?.fxRing(this.player.x, this.player.y, { r0: 20, r1: 160, w: 5, color: 0x9bc25b, alpha: 0.95, dur: 600 });
      return;
    }

    // 되지핌 (영구 강화): 화로가 다시 타오르며 50% 체력으로 복귀 + 충격파
    if (this.revivalsLeft > 0) {
      this.revivalsLeft -= 1;
      this.player.hp = Math.round(this.player.maxHp * 0.5);
      this.player.invulnerableUntil = this.time.now + 2500;
      this.player.isHurting = false;

      if (screenShakeEnabled()) {
        this.cameras.main.flash(600, 232, 135, 74);
      }
      this.soundSystem?.play('revive');
      this.waveSystem?.announce?.('부활 — 심장이 다시 탄다', '#9bc25b');

      for (const enemy of this.enemyManager.enemies.getChildren() as EnemySprite[]) {
        if (!this.enemyManager.isAliveEnemy(enemy) || enemy.catalog?.isReaper) {
          continue;
        }
        if (Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y) < 350) {
          this.enemyManager.takeDamage(enemy, Math.round(500 * (this.swordOrbit?.flatDamageScale?.() ?? 1)), this.player);
        }
      }

      return;
    }

    this.player.isDead = true;
    this.player.isHurting = false;
    this.player.isKnockedBack = false;
    this.player.setVelocity(0, 0);
    (this.player.body as Phaser.Physics.Arcade.Body | null)?.setEnable(false);
    this.player.anims.play(this.playerConfig.animations.death, true);

    this.visualEffects?.removeHealthBar(this.player);

    if (screenShakeEnabled()) {
      this.cameras.main.shake(400, 0.01);
    }
    this.soundSystem?.play('gameover');
    this.physics.pause();

    this.player.once(Phaser.Animations.Events.ANIMATION_COMPLETE, (animation: Phaser.Animations.Animation) => {
      if (animation.key !== this.playerConfig.animations.death) {
        return;
      }

      this.player.setVelocity(0, 0);
      this.showGameOver();
    });

    // Fallback in case the death animation never completes.
    this.time.delayedCall(1500, () => this.showGameOver());
  }

  togglePause() {
    // 조작 키 설정 창이 열려 있으면 ESC 는 그 창만 닫는다 (창 자체 핸들러가 처리)
    if (this.keybindWindow) {
      return;
    }
    if (this.skillWindow?.isOpen) {
      this.skillWindow.close();
      return;
    }
    if (this.levelUpSystem?.isOpen || this.isGameOver || this.player?.isDead || this.shopSystem?.isOpen || this.augmentSystem?.isOpen) {
      return;
    }
    // 정찰 보고/시설 창이 열려 있으면 ESC 는 그것만 닫는다 (마을 자체에서의 일시정지는 허용)
    if (this.villageSystem?.scoutOpen || this.villageSystem?.windowOpen) {
      return;
    }

    this.isPaused = !this.isPaused;
    this.soundSystem?.play('click');

    if (this.isPaused) {
      this.physics.pause();
      this.buildPauseUi();
    } else {
      this.destroyPauseUi();
      this.physics.resume();
    }
  }

  buildPauseUi() {
    const overlay = dimVignette(this, 2499, 0.78);
    this.pauseRoot = createUiRoot(this, 2500);

    const width = this.pauseRoot.width;
    const height = this.pauseRoot.height;
    const cx = width / 2;
    const cy = height / 2;

    // PAUSED (무리가 대기하는 시간) — 강판 프레임 패널.
    // 2단 구성: 좌 = 메뉴/음량, 우 = 조작 안내 + 튜토리얼 다시 보기.
    // (한 단으로 쌓으면 830px 디자인 높이를 넘어 잘린다)
    const panelH = 664;
    const panelW = Math.min(940, width - 60);
    const colW = (panelW - 60) / 2;
    const leftX = cx - colW / 2 - 14;
    const rightX = cx + colW / 2 + 14;
    const menuPanel = panel(this, cx, cy - 8, panelW, panelH, { origin: 0.5 })
      .setScrollFactor(0).setDepth(2500);
    const title = this.add.text(cx, cy - 272, '일시정지', {
      fontFamily: FONT.display,
      resolution: TEXT_RESOLUTION,
      fontSize: '44px',
      fontStyle: '900',
      color: UI.text,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2501);
    const sub = this.add.text(cx, cy - 234, '무리가 궤도에서 대기 중', style(14, UI.textDim, { bold: false }))
      .setOrigin(0.5).setScrollFactor(0).setDepth(2501);
    const div1 = divider(this, cx, cy - 212, 300).setScrollFactor(0).setDepth(2501);

    const entries: Array<{ label: string; icon?: string; key?: string; onClick: () => void; highlight?: boolean; getLabel?: () => string }> = [
      { label: '계속하기', icon: 'g-feather', key: 'ESC', highlight: true, onClick: () => this.togglePause() },
      { label: '다시 시작', key: 'R', onClick: () => this.scene.restart({ characterId: this.characterId, danger: this.dangerLevel }) },
      { label: '타이틀로', key: 'T', onClick: () => this.scene.start('TitleScene') },
      {
        label: '화면 흔들림',
        getLabel: () => (loadSettings().screenShake ? '화면 흔들림: 켬' : '화면 흔들림: 끔'),
        onClick: () => { saveSettings({ screenShake: !loadSettings().screenShake }); this.refreshPauseUi(); },
      },
      {
        label: '모션 줄이기',
        getLabel: () => (loadSettings().reduceMotion ? '모션 줄이기: 켬' : '모션 줄이기: 끔'),
        onClick: () => { saveSettings({ reduceMotion: !loadSettings().reduceMotion }); this.refreshPauseUi(); },
      },
      {
        // 타격 순간의 짧은 정지 — 모션 줄이기와 별개 축 (잔상은 괜찮은데 정지는 싫은 경우)
        label: '히트스톱',
        getLabel: () => (loadSettings().hitStop ? '히트스톱: 켬' : '히트스톱: 끔'),
        onClick: () => {
          saveSettings({ hitStop: !loadSettings().hitStop });
          if (!hitStopEnabled()) {
            this.visualEffects?.releaseHitStop();
          }
          this.refreshPauseUi();
        },
      },
    ];

    this.pauseUi = [...overlay, menuPanel, title, sub, div1];
    this.pauseButtons = [];

    // 항목이 6개(히트스톱 토글 추가)라 간격을 58→52 로 줄인다 — 아래 음량 블록과 겹치지 않게
    entries.forEach((entry, index) => {
      const b = button(this, leftX, cy - 186 + index * 52, colW, 48, entry.getLabel?.() ?? entry.label, {
        variant: entry.highlight ? 'gold' : 'dark',
        fontSize: 17, display: true, icon: entry.icon, key: entry.key, ornate: entry.highlight,
        onClick: entry.onClick,
      });
      b.container.setScrollFactor(0).setDepth(2501);
      this.pauseUi.push(b.container);
      this.pauseButtons!.push({ button: b, getLabel: entry.getLabel });
    });

    // 음량 (BGM/SFX 슬라이더 + 음소거) — 타이틀 설정 창과 같은 컴포넌트
    const div2 = divider(this, leftX, cy + 128, colW).setScrollFactor(0).setDepth(2501);
    const volumeLabel = this.add.text(leftX - colW / 2, cy + 112, '음량', style(13, UI.quenchText, { display: true }))
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(2501);
    this.pauseUi.push(div2, volumeLabel);
    this.pauseAudioUi = createAudioSettings(this, leftX - colW / 2, cy + 140, colW, {
      scrollFactor: 0,
      depth: 2501,
    });

    // ── 우측 단: 조작 안내 + 튜토리얼 다시 보기 (온보딩 — 2026-09-01)
    const rightLeft = rightX - colW / 2;
    const guideLabel = this.add.text(rightLeft, cy - 196, '안내', style(13, UI.quenchText, { display: true }))
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(2501);
    this.pauseUi.push(guideLabel);
    const controls = createControlsPanel(this, rightLeft, cy - 182, colW, {
      rows: combatControlRows(),
      scrollFactor: 0,
      depth: 2501,
      title: null,
    });
    this.pauseUi.push(...controls.objects);

    const tutorialY = cy - 182 + controls.height + 34;
    const replay = button(this, rightX, tutorialY, colW, 52, '튜토리얼 다시 보기', {
      variant: 'dark', fontSize: 16, display: true, icon: 'g-scroll',
      sub: '첫 런 안내를 지금 처음부터 다시 봅니다',
      onClick: () => {
        this.togglePause();
        this.tutorial?.restart();
      },
    });
    replay.container.setScrollFactor(0).setDepth(2501);
    this.pauseUi.push(replay.container);

    // 조작 키 리맵 — 설정 창(타이틀 O)의 '조작' 갈래와 같은 컴포넌트
    const keybindBtn = button(this, rightX, tutorialY + 62, colW, 44, '조작 키 설정', {
      variant: 'dark', fontSize: 15, display: true, icon: 'g-anvil',
      sub: '활공 · 귀소 · 대시 · 이동 키 바꾸기',
      onClick: () => {
        if (this.keybindWindow) return;
        this.keybindWindow = openKeybindWindow(this, 2700, {
          onClose: () => { this.keybindWindow = null; },
        });
      },
    });
    keybindBtn.container.setScrollFactor(0).setDepth(2501);
    this.pauseUi.push(keybindBtn.container);

    const glossaryNote = this.add.text(rightLeft, tutorialY + 116,
      'TAB 캐릭터창의 능력치·검·세트 항목과 상점 상품은\n마우스를 올리면 자세한 설명이 나옵니다.',
      { ...style(11.5, UI.textFaint, { bold: false }), lineSpacing: 4, wordWrap: { width: colW } })
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2501);
    this.pauseUi.push(glossaryNote);

    const ver = this.add.text(16, height - 24, 'LODELAND v0.3', style(12, UI.textFaint, { bold: false }))
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(2501);
    this.pauseUi.push(ver);

    // 딤(overlay)을 뺀 나머지를 스케일 루트로 이동
    for (const object of this.pauseUi) {
      if (!overlay.includes(object)) {
        this.pauseRoot.root.add(object);
      }
    }
    for (const object of this.pauseAudioUi.objects) {
      this.pauseRoot.root.add(object);
    }
    this.pauseRoot.sort();
  }

  refreshPauseUi() {
    if (!this.isPaused || !this.pauseButtons) {
      return;
    }
    for (const entry of this.pauseButtons) {
      if (entry.getLabel) {
        entry.button.setLabel(entry.getLabel());
      }
    }
    this.pauseAudioUi?.refresh();
  }

  destroyPauseUi() {
    this.keybindWindow?.close();
    this.keybindWindow = null;
    this.pauseAudioUi?.destroy();
    this.pauseAudioUi = null;
    for (const object of this.pauseUi) {
      object.destroy();
    }
    this.pauseRoot?.destroy();
    this.pauseRoot = null;
    this.pauseUi = [];
    this.pauseMenuText = null;
    this.pauseButtons = [];
  }

  /**
   * 런 종료 한 줄 기록 — src/core/telemetry.ts (로컬 전용, 전송 없음).
   * 검 구성은 장착 + 보관을 합쳐 원소·아키타입 카운트로만 요약한다 (id 목록은 남기지 않는다).
   */
  private recordRunTelemetry(results: { survivedMs: number; killCount: number; round?: number }, won: boolean) {
    try {
      const elements: Record<string, number> = {};
      const archetypes: Record<string, number> = {};
      let count = 0;
      const tally = (definition: SwordDefinition | null | undefined) => {
        if (!definition) {
          return;
        }
        count += 1;
        const element = definition.element ?? 'none';
        elements[element] = (elements[element] ?? 0) + 1;
        const archetype = behaviorOf(definition);
        archetypes[archetype] = (archetypes[archetype] ?? 0) + 1;
      };
      for (const sword of this.swordOrbit?.swords ?? []) {
        tally(sword.definition as SwordDefinition | null);
      }
      for (const entry of this.swordOrbit?.reserve ?? []) {
        tally(entry.definition as SwordDefinition | null);
      }

      recordRun({
        round: results.round ?? this.waveSystem?.round ?? 1,
        keeper: this.characterId,
        won,
        durationMs: results.survivedMs,
        kills: results.killCount,
        level: this.progression?.level ?? 1,
        affixes: this.enemyManager?.affixPoolSize ?? 0,
        swords: { count, elements, archetypes },
      });
    } catch {
      // 기록 실패가 결과 화면을 막아서는 안 된다
    }
  }

  showGameOver() {
    if (this.isGameOver) {
      return;
    }

    this.isGameOver = true;
    // 결과 화면은 조용하게 — 다시 시작하거나 타이틀로 가면 각 씬이 곡을 다시 건다
    this.bgm?.stop(1200);
    // 런 종료: 누적 통계 확정 + 마지막 도전과제 판정 (컷인/토스트는 정리)
    this.bossCutIn?.hide();
    this.achievements?.onRunEnd(this.waveSystem?.round ?? 0);
    // 세이브 처리: 승리 = 런 종료(소멸). 사망 = 유지 — "이 라운드 재도전"이
    // 라운드 시작 시점(마지막 상점 종료 스냅샷)으로 되돌릴 수 있어야 한다.
    this.physics.pause();
    this.setGameHudVisible(false);
    this.levelUpSystem?.destroyUi?.();
    if (this.shopSystem?.isOpen) {
      this.shopSystem.destroyUi();
      this.shopSystem.isOpen = false;
    }
    if (this.augmentSystem?.isOpen) {
      this.augmentSystem.destroyUi();
      this.augmentSystem.isOpen = false;
    }

    const results = (this.waveSystem?.getResults?.() ?? { survivedMs: 0, killCount: 0, completed: false }) as {
      survivedMs: number;
      killCount: number;
      completed: boolean;
      round?: number;
    };
    const totalSeconds = Math.floor(results.survivedMs / 1000);
    const timeLabel = `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;

    // 골드 정산은 "런을 끝내는 선택"을 했을 때만 — 재도전을 고르면 이 라운드에서
    // 번 골드는 라운드 시작 시점으로 함께 되감기므로 은행에 넣지 않는다.
    // (사망 즉시 넣으면 재도전 → 재사망 반복으로 같은 골드가 중복 적립된다)
    const earnedGold = this.pickupSystem?.runGold ?? 0;
    const won = results.completed;
    if (won) {
      MetaProgression.addGold(earnedGold);
      RunSave.clear();
    }
    const totalGold = MetaProgression.load().gold + (won ? 0 : earnedGold);

    // 로컬 런 기록 (movesword-runlog-v1) — 밸런스 튜닝의 실측 근거.
    // 런당 정확히 한 번, 게임오버 화면을 그리기 전에 남긴다. 전송은 없다.
    this.recordRunTelemetry(results, won);

    // 승리=귀소(담금 청·짚쇠), 패배=식은 화로(잉걸 잔불)
    const themeMain = won ? 0x6fa7bd : 0xa5502a;
    const themeGlow = won ? 0x3f6b7d : 0x5c2c14;
    const valueColor = won ? UI.goldText : UI.emberText;

    const overlay = dimVignette(this, 2999, won ? 0.72 : 0.78);
    const resultRoot = createUiRoot(this, 3000);
    const width = resultRoot.width;
    const height = resultRoot.height;
    const cx = width / 2;
    const cy = height / 2;
    const resultStart = this.children.list.length;

    // 테마 컬러 무드 글로우
    const mood = this.add.graphics().setScrollFactor(0).setDepth(3000);
    mood.fillStyle(themeMain, 0.05);
    mood.fillCircle(cx, cy, Math.min(width, height) * 0.45);

    const panelW = Math.min(500, width - 80);
    // 최종 무리(검 7자리) 줄이 들어가며 +54 — 디자인 높이 830 기준 상한(770)을 넘지 않는다
    const panelH = Math.min(won ? 694 : 744, height - 60);
    const px = cx - panelW / 2;
    const py = cy - panelH / 2;

    // Flat 프레임 + 셀렉트 코너 (테마색)
    panel(this, px, py, panelW, panelH).setScrollFactor(0).setDepth(3001);
    selectFrame(this, cx, cy, panelW + 18, panelH + 18, { tint: themeMain })
      .setScrollFactor(0).setDepth(3001);

    // 헤더 엠블럼 (귀소하는 새 / 식은 화로) — 팩 슬롯 위 글리프
    const emblemY = py + 66;
    slot(this, cx, emblemY, 72, won ? 'blue' : 'orange').setScrollFactor(0).setDepth(3001);
    const emblem = iconImage(this, won ? 'g-bird' : 'g-furnace', cx, emblemY, 36, 0xfffdf5);
    (emblem as Phaser.GameObjects.Image).setScrollFactor?.(0);
    emblem.setDepth(3002);

    const titleText = this.add.text(cx, py + 140, won ? '귀환' : '사망', {
      fontFamily: FONT.display,
      resolution: TEXT_RESOLUTION,
      fontSize: won ? '48px' : '46px',
      fontStyle: '900',
      color: won ? UI.quenchText : UI.red,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(3002);

    const quote = won
      ? '"돌아왔구나. …다음 광맥으로."'
      : '잉걸은 남았다 — 다시 지피면 된다.';
    this.add.text(cx, py + 174, quote, style(13, UI.textDim, { bold: false }))
      .setOrigin(0.5).setScrollFactor(0).setDepth(3002);

    // 스탯 그리드 2×2 (컴팩트 — FLOCK 리포트 공간 확보)
    const listX = px + 34;
    const listW = panelW - 68;
    const listY = py + 192;
    const gridRowH = 36;
    const cells: Array<[string, string]> = [
      ['라운드', `${results.round ?? 1} / ${this.waveSystem?.totalRounds ?? 200}`],
      ['생존', timeLabel],
      ['레벨', `${this.progression?.level ?? 1}`],
      ['처치', results.killCount.toLocaleString()],
    ];
    insetPanel(this, listX, listY, listW, gridRowH * 2 + 14).setScrollFactor(0).setDepth(3001);
    cells.forEach(([label, value], index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const cellX = listX + 22 + col * (listW / 2);
      const cellY = listY + 7 + row * gridRowH + gridRowH / 2;
      this.add.text(cellX, cellY, label, style(12, UI.textDim, { display: true }))
        .setOrigin(0, 0.5).setScrollFactor(0).setDepth(3002);
      this.add.text(cellX + listW / 2 - 44, cellY, value, style(17, valueColor, { display: true }))
        .setOrigin(1, 0.5).setScrollFactor(0).setDepth(3002);
    });

    // 최종 무리 — 검 7자리 아이콘 + 등급색 밑줄 (이 런이 어떤 무리로 끝났는가)
    const flockY = listY + gridRowH * 2 + 16 + 12;
    const flockH = 54;
    insetPanel(this, listX, flockY, listW, flockH).setScrollFactor(0).setDepth(3001);
    this.add.text(listX + 20, flockY + 13, '최종 무리', style(12, UI.textDim, { display: true }))
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(3002);
    const finalSwords = this.swordOrbit?.swords ?? [];
    const flockSlots = Math.max(finalSwords.length, this.swordOrbit?.maxSwords ?? 7);
    this.add.text(listX + listW - 20, flockY + 13, `${finalSwords.length} / ${flockSlots}자루`, style(11, UI.textFaint))
      .setOrigin(1, 0.5).setScrollFactor(0).setDepth(3002);
    const cellSize = Math.min(30, Math.floor((listW - 40) / flockSlots) - 5);
    const cellGap = 5;
    const flockRowW = flockSlots * cellSize + (flockSlots - 1) * cellGap;
    const flockStartX = listX + listW / 2 - flockRowW / 2 + cellSize / 2;
    const flockRowY = flockY + 34;
    for (let i = 0; i < flockSlots; i += 1) {
      const sword = finalSwords[i];
      const sx = flockStartX + i * (cellSize + cellGap);
      slot(this, sx, flockRowY, cellSize, sword ? 'gray' : 'ghost')
        .setScrollFactor(0).setDepth(3001);
      if (!sword) {
        continue;
      }
      const definition = sword.definition;
      const rarityId = definition?.rarity ?? (definition?.evolved ? 'legendary' : 'common');
      const rarity = RARITY_THEME[rarityId] ?? RARITY_THEME.common;
      this.add.image(sx, flockRowY - 1, 'sword', definition?.sheetOrder ?? 0)
        .setDisplaySize(cellSize - 9, cellSize - 9).setScrollFactor(0).setDepth(3002);
      // 등급 밑줄 (칸 아래 3px 스트립 — 색 하나로 등급을 읽는다)
      this.add.image(sx, flockRowY + cellSize / 2 - 1, 'uf-fill-cream')
        .setDisplaySize(cellSize - 6, 3).setTint(rarity.num)
        .setScrollFactor(0).setDepth(3002);
    }

    // FLOCK 리포트 — 검별 딜 지분 바 (상위 4)
    const reportY = flockY + flockH + 12;
    const damageEntries = Object.entries(this.swordOrbit?.runDamage ?? {})
      .sort((a, b) => b[1] - a[1]);
    const totalDamage = damageEntries.reduce((sum, [, v]) => sum + v, 0);
    const topEntries = damageEntries.slice(0, 4);
    const barRowH = 22;
    const reportH = 26 + Math.max(1, topEntries.length) * barRowH + 6;
    insetPanel(this, listX, reportY, listW, reportH).setScrollFactor(0).setDepth(3001);
    this.add.text(listX + 20, reportY + 14, '검 활약', style(12, UI.textDim, { display: true }))
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(3002);
    this.add.text(listX + listW - 20, reportY + 14, `총 피해 ${totalDamage.toLocaleString()}`, style(11, UI.textFaint))
      .setOrigin(1, 0.5).setScrollFactor(0).setDepth(3002);
    if (topEntries.length === 0) {
      this.add.text(cx, reportY + 26 + barRowH / 2, '기록된 사냥이 없다', style(12, UI.textFaint, { bold: false }))
        .setOrigin(0.5).setScrollFactor(0).setDepth(3002);
    }
    const barMaxW = listW - 196;
    const topValue = topEntries[0]?.[1] ?? 1;
    topEntries.forEach(([name, value], index) => {
      const rowY = reportY + 26 + index * barRowH + barRowH / 2;
      const pct = totalDamage > 0 ? Math.round((value / totalDamage) * 100) : 0;
      this.add.text(listX + 20, rowY, name, style(12, index === 0 ? UI.text : UI.textDim, { display: true }))
        .setOrigin(0, 0.5).setScrollFactor(0).setDepth(3002);
      const barX = listX + 128;
      const barW = Math.max(3, Math.round(barMaxW * (value / topValue)));
      this.add.image(barX, rowY - 5, 'uf-fill-dark').setOrigin(0, 0).setDisplaySize(barMaxW, 10)
        .setScrollFactor(0).setDepth(3002).setAlpha(0.85);
      this.add.image(barX, rowY - 5, 'uf-fill-cream').setOrigin(0, 0).setDisplaySize(barW, 10)
        .setScrollFactor(0).setDepth(3002)
        .setTint(index === 0 ? (won ? UI.quench : UI.straw) : themeMain)
        .setAlpha(index === 0 ? 1 : 0.75);
      this.add.text(listX + listW - 20, rowY, `${pct}%`, style(12, index === 0 ? valueColor : UI.textDim, { display: true }))
        .setOrigin(1, 0.5).setScrollFactor(0).setDepth(3002);
    });

    // 사인(死因) — 패배 시에만
    let afterReportY = reportY + reportH;
    if (!won && this.lastHitBy) {
      this.add.text(cx, afterReportY + 12, `${this.lastHitBy}에게 쪼였다`, style(12, UI.emberText, { bold: false }))
        .setOrigin(0.5).setScrollFactor(0).setDepth(3002);
      afterReportY += 20;
    }

    // 정철 수확 강조 박스
    const goldY = afterReportY + 8;
    const goldH = 46;
    insetPanel(this, listX, goldY, listW, goldH).setScrollFactor(0).setDepth(3001);
    const goldChip = iconImage(this, 'g-chip', listX + 34, goldY + goldH / 2, 24, 0xd9a83c);
    (goldChip as Phaser.GameObjects.Image).setScrollFactor?.(0);
    goldChip.setDepth(3002);
    this.add.text(listX + 62, goldY + goldH / 2 - 8, '이번 런 획득 골드', style(14, UI.goldDeep, { display: true }))
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(3002);
    this.add.text(listX + 62, goldY + goldH / 2 + 10, '영구 강화(잉걸)에 쓰는 재화', style(10.5, UI.textFaint, { bold: false }))
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(3002);
    this.add.text(listX + listW - 24, goldY + goldH / 2, earnedGold.toLocaleString(), style(26, UI.goldText, { display: true }))
      .setOrigin(1, 0.5).setScrollFactor(0).setDepth(3002);

    // 버튼 — leaving 가드: 더블클릭/키 중복으로 restart·start가 겹쳐 호출되면
    // 씬 전환 도중 파괴된 오브젝트를 만져 프리즈가 날 수 있다. 첫 입력만 통과.
    let leaving = false;
    // 런을 끝내는 출구(다시 시작/타이틀/영구 강화): 이 시점에 골드를 은행에 넣고 세이브를 지운다
    const settleRun = () => {
      if (!won) {
        MetaProgression.addGold(earnedGold);
        RunSave.clear();
      }
    };
    const restartRun = () => {
      if (leaving) return;
      leaving = true;
      settleRun();
      this.scene.restart({ characterId: this.characterId, danger: this.dangerLevel });
    };
    const goTitle = () => {
      if (leaving) return;
      leaving = true;
      settleRun();
      this.scene.start('TitleScene');
    };
    const goReignite = () => {
      if (leaving) return;
      leaving = true;
      settleRun();
      this.scene.start('PowerUpScene');
    };
    // 재도전(부활과 다른 개념): 라운드 시작 시점 스냅샷으로 되돌아가 같은 라운드에 다시 도전.
    // 검·레벨·증강은 되감기지만 **지갑은 되감지 않는다** (2026-09-04, 2026-09-08 수정) —
    // 죽었을 때 다시 강해질 방법이 없으면 재도전이 같은 죽음의 반복이 된다.
    // 사망 시점 잔액을 그대로 넘긴다: 벌었으면 늘고, 마을에서 썼으면 줄어든 채로 간다.
    const snapshotGold = RunSave.peek()?.runGold ?? 0;
    const carryGold = Math.max(0, earnedGold - snapshotGold);
    const retryRound = () => {
      if (leaving) return;
      leaving = true;
      this.scene.restart({
        characterId: this.characterId,
        danger: this.dangerLevel,
        resume: RunSave.has(), // 라운드 1 사망(세이브 없음)은 새 시작과 동일
        retryGold: RunSave.has() ? earnedGold : undefined,
      });
    };

    if (!won) {
      const retryRoundNo = results.round ?? 1;
      const retry = button(this, cx, py + panelH - 164, panelW - 88, 54, `라운드 ${retryRoundNo} 재도전`, {
        variant: 'gold', fontSize: 17, display: true, key: 'SPACE', ornate: true, icon: 'g-rekindle',
        sub: carryGold > 0
          ? `라운드 시작 시점으로 되돌아간다 · 이번에 번 골드 ${carryGold.toLocaleString()}은 가져간다`
          : '라운드 시작 시점으로 되돌아간다 (검·레벨 되감김, 골드는 이월)',
        onClick: retryRound,
      });
      retry.container.setScrollFactor(0).setDepth(3002);
      this.input.keyboard!.once('keydown-SPACE', retryRound);
      // 게임패드 A(=ENTER 합성)로도 재도전할 수 있어야 한다
      this.input.keyboard!.once('keydown-ENTER', retryRound);
    }

    // 런 종료 동선: 번 골드를 영구 강화에 쓰고 새로 내려간다
    const reigniteY = py + panelH - (won ? 108 : 106);
    const reignite = button(this, cx, reigniteY, panelW - 88, 48, '영구 강화 — 잉걸을 지핀다', {
      variant: won ? 'gold' : 'dark', fontSize: 15, display: true, key: 'U', ornate: won, icon: 'g-furnace',
      sub: won
        ? `골드 ${totalGold.toLocaleString()}으로 영구 강화`
        : `런 종료 + 정산 (골드 ${totalGold.toLocaleString()})`,
      onClick: goReignite,
    });
    reignite.container.setScrollFactor(0).setDepth(3002);

    const buttonY = py + panelH - 46;
    const restart = button(this, cx - (panelW / 4) - 6, buttonY, panelW / 2 - 48, 40, '처음부터', {
      variant: 'dark', fontSize: 13, display: true, key: 'R',
      onClick: restartRun,
    });
    restart.container.setScrollFactor(0).setDepth(3002);
    const toTitle = button(this, cx + (panelW / 4) + 6, buttonY, panelW / 2 - 48, 40, '타이틀로', {
      variant: 'dark', fontSize: 13, display: true, key: 'T',
      onClick: goTitle,
    });
    toTitle.container.setScrollFactor(0).setDepth(3002);

    // 결과 패널 전체를 스케일 루트로 이동 (딤은 화면 크기 그대로 유지)
    for (const child of this.children.list.slice(resultStart)) {
      if (child !== resultRoot.root && !overlay.includes(child)) {
        resultRoot.root.add(child);
      }
    }
    resultRoot.sort();

    this.input.keyboard!.once('keydown-R', restartRun);
    this.input.keyboard!.once('keydown-T', goTitle);
    this.input.keyboard!.once('keydown-U', goReignite);
  }

  handlePlayerAnimationComplete(animation: Phaser.Animations.Animation) {
    if (!this.player || this.player.isDead || !animation) {
      return;
    }

    if (animation.key === this.playerConfig.animations.hurt) {
      this.player.isHurting = false;
      this.player.anims.play(this.playerConfig.animations.idle, true);
    }
  }

  /**
   * 리맵된 이동 키를 다시 잡는다.
   * 이전 Key 객체는 반드시 해제한다 — 남겨 두면 옛 키가 계속 먹는다.
   */
  rebuildMoveKeys() {
    const keyboard = this.input?.keyboard;
    if (!keyboard) {
      return;
    }
    if (this.moveKeys) {
      for (const key of Object.values(this.moveKeys)) {
        keyboard.removeKey(key, false);
      }
    }
    this.moveKeys = {
      up: keyboard.addKey(getBinding('moveUp'), false),
      left: keyboard.addKey(getBinding('moveLeft'), false),
      down: keyboard.addKey(getBinding('moveDown'), false),
      right: keyboard.addKey(getBinding('moveRight'), false),
    };
  }

  getHorizontalInput(): number {
    // 방향키는 리맵과 무관한 고정 보조키 (되돌리지 못하는 사고 방지)
    let direction = 0;

    if (this.cursors.left.isDown || this.moveKeys?.left.isDown) {
      direction -= 1;
    }

    if (this.cursors.right.isDown || this.moveKeys?.right.isDown) {
      direction += 1;
    }

    if (direction === 0) {
      // 게임패드 좌스틱 (미연결이면 0) — 아날로그 값을 그대로 돌려준다
      const axis = this.gamepad?.axis().x ?? 0;
      if (axis !== 0) {
        return axis;
      }
    }

    return direction;
  }

  getVerticalInput(): number {
    let direction = 0;

    if (this.cursors.up.isDown || this.moveKeys?.up.isDown) {
      direction -= 1;
    }

    if (this.cursors.down.isDown || this.moveKeys?.down.isDown) {
      direction += 1;
    }

    if (direction === 0) {
      const axis = this.gamepad?.axis().y ?? 0;
      if (axis !== 0) {
        return axis;
      }
    }

    return direction;
  }
}
