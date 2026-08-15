import Phaser from 'phaser';
import shopCatalog from '../data/shopCatalog.json';
import MetaProgression from './MetaProgression.js';

const ELEMENT_LABELS = { fire: '🔥화염', electric: '⚡전기', poison: '☠️독', void: '🕳️공허', gold: '🪙황금' };

// Between-round shop, visual edition: stat cards, sword cards with sprites,
// owned-sword panel with hover details, element set status.
export default class ShopSystem {
	constructor(scene, options = {}) {
		this.scene = scene;
		this.swordOrbit = options.swordOrbit ?? null;
		this.pickupSystem = options.pickupSystem ?? null;
		this.progression = options.progression ?? null;

		this.isOpen = false;
		this.uiObjects = [];
		this.purchaseCounts = {};
		this.round = 0;
		this.rerollCount = 0;
		this.swordOffers = [];
		this.useGuarantee = false;
		this.selectedSlot = null;
	}

	// ---------------------------------------------------------------
	// Floating tooltip (follows the hovered element)
	// ---------------------------------------------------------------

	showTooltip(anchorX, anchorY, title, body) {
		this.hideTooltip();

		const text = this.scene.add.text(anchorX, anchorY - 10, `${title}\n${body}`, {
			fontFamily: 'Arial, sans-serif',
			fontSize: '12px',
			color: '#e5e7eb',
			backgroundColor: '#0d1322',
			padding: { x: 12, y: 9 },
			lineSpacing: 4,
			wordWrap: { width: 300 },
		}).setOrigin(0.5, 1).setScrollFactor(0).setDepth(2400);

		// Clamp to screen
		const { width } = this.scene.scale;
		const halfWidth = text.width / 2;
		if (text.x - halfWidth < 6) {
			text.setX(halfWidth + 6);
		} else if (text.x + halfWidth > width - 6) {
			text.setX(width - halfWidth - 6);
		}
		if (text.y - text.height < 6) {
			text.setOrigin(0.5, 0).setY(anchorY + 40);
		}

		this.tooltip = text;
	}

	hideTooltip() {
		this.tooltip?.destroy();
		this.tooltip = null;
	}

	open(round) {
		if (this.isOpen) {
			return;
		}

		this.isOpen = true;
		this.round = round;
		this.rerollCount = 0;
		this.selectedSlot = null;

		this.scene.physics.pause();
		this.scene.player?.setVelocity?.(0, 0);
		this.scene.soundSystem?.play('chest', { volume: 0.5 });

		this.rollSwordOffers();
		this.buildUi();
	}

	close() {
		this.destroyUi();
		this.isOpen = false;

		if (!this.scene.levelUpSystem?.isOpen && !this.scene.isPaused && !this.scene.player?.isDead) {
			this.scene.physics.resume();
		}
	}

	getGold() {
		return this.pickupSystem?.runGold ?? 0;
	}

	spend(amount) {
		return this.pickupSystem?.spendGold?.(amount) ?? false;
	}

	// ---------------------------------------------------------------
	// Offers & prices
	// ---------------------------------------------------------------

	statPrice(entry) {
		const count = this.purchaseCounts[entry.id] ?? 0;
		return Math.ceil(entry.baseCost * Math.pow(shopCatalog.priceGrowth ?? 1.35, count));
	}

	swordPrice(definition, existingSword) {
		const tiers = this.swordOrbit?.getBaseTierList() ?? [];
		const tierIndex = Math.max(0, tiers.findIndex((tier) => tier.id === definition.id));
		const base = (shopCatalog.swordPriceBase ?? 25) + tierIndex * (shopCatalog.swordPricePerTier ?? 15);

		if (existingSword) {
			return Math.ceil(base * (1 + 0.6 * (existingSword.level ?? 1)));
		}

		return base;
	}

	rerollPrice() {
		return (shopCatalog.rerollBase ?? 5) + this.round * (shopCatalog.rerollPerRound ?? 2) + this.rerollCount * 5;
	}

	// 장착 + 창고를 합친 보유 정보 (레벨 있는 엔트리 반환)
	getOwnedInfo(id) {
		const equipped = this.swordOrbit?.getSwordById(id);
		if (equipped) {
			return equipped;
		}
		const reserveIndex = this.swordOrbit?.findReserveIndexById(id) ?? -1;
		return reserveIndex >= 0 ? this.swordOrbit.reserve[reserveIndex] : null;
	}

	rollSwordOffers() {
		const tiers = this.swordOrbit?.getBaseTierList() ?? [];
		const maxTier = Math.min(tiers.length - 1, 1 + Math.floor(this.round / 2));
		const pool = tiers.slice(0, maxTier + 1).filter((tier) => {
			const owned = this.getOwnedInfo(tier.id);
			return !(owned && owned.level >= (this.swordOrbit?.maxSwordLevel ?? 5));
		});

		Phaser.Utils.Array.Shuffle(pool);
		this.swordOffers = pool.slice(0, 2);
	}

	// ---------------------------------------------------------------
	// Purchasing
	// ---------------------------------------------------------------

	buyStat(entry) {
		const price = this.statPrice(entry);
		if (!this.spend(price)) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
			return;
		}

		this.purchaseCounts[entry.id] = (this.purchaseCounts[entry.id] ?? 0) + 1;
		this.applyStat(entry);
		this.scene.soundSystem?.play('gold', { volume: 0.6 });
		this.refresh();
	}

	applyStat(entry) {
		const player = this.scene.player;
		const value = entry.value;

		switch (entry.type) {
			case 'maxHpFlat':
				player.maxHp += value;
				player.hp = Math.min(player.maxHp, player.hp + value);
				break;
			case 'defenseAdd':
				player.defense = Math.min(60, (player.defense ?? 0) + value);
				break;
			case 'dodgeAdd':
				player.dodgeChance = Math.min(0.4, (player.dodgeChance ?? 0) + value);
				break;
			case 'moveSpeedMult':
				player.moveSpeed = Math.round(player.moveSpeed * (1 + value));
				break;
			case 'regenAdd':
				player.hpRegen = (player.hpRegen ?? 0) + value;
				break;
			case 'killHealAdd':
				player.killHeal = (player.killHeal ?? 0) + value;
				break;
			case 'damageMultAdd':
				if (this.swordOrbit) {
					this.swordOrbit.damageMultiplier += value;
					for (const sword of this.swordOrbit.swords) {
						this.swordOrbit.recalculateSwordStats(sword);
					}
				}
				break;
			case 'critChanceAdd':
				player.critChance = (player.critChance ?? 0) + value;
				break;
			case 'critDamageAdd':
				player.critDamageMultiplier = (player.critDamageMultiplier ?? 1) + value;
				break;
			case 'cooldownReduce':
				this.swordOrbit?.applyCooldownMultiplier?.(1 - value);
				break;
			case 'magnetMult':
				if (this.progression) {
					this.progression.magnetRadius *= (1 + value);
				}
				break;
			case 'luckAdd':
				player.luck = (player.luck ?? 0) + value;
				break;
			case 'xpGainAdd':
				if (this.progression) {
					this.progression.xpMultiplier = (this.progression.xpMultiplier ?? 1) + value;
				}
				break;
			case 'thornsAdd':
				player.thorns = (player.thorns ?? 0) + value;
				break;
			case 'physResistAdd':
				player.physicalResist = Math.min(50, (player.physicalResist ?? 0) + value);
				break;
			case 'magicResistAdd':
				player.magicResist = Math.min(50, (player.magicResist ?? 0) + value);
				break;
			default:
				break;
		}
	}

	buySword(definition) {
		const so = this.swordOrbit;
		const equipped = so.getSwordById(definition.id);
		const reserveIndex = so.findReserveIndexById(definition.id);
		const reserveEntry = reserveIndex >= 0 ? so.reserve[reserveIndex] : null;
		const owned = equipped ?? reserveEntry;
		const price = this.swordPrice(definition, owned);

		if (!this.spend(price)) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
			return;
		}

		if (equipped) {
			so.levelUpSword(equipped);
		} else if (reserveEntry) {
			// 창고의 검도 중복 구매로 레벨업
			reserveEntry.level = Math.min(so.maxSwordLevel ?? 5, reserveEntry.level + 1);
		} else if (so.swords.length < so.getEffectiveMaxSwords()) {
			so.addSword(this.scene, definition);
			so.checkFusions();
		} else {
			// 칸이 가득 차도 구매 가능 — 창고로 입고
			so.addToReserve(definition);
			this.scene.waveSystem?.announce?.(`🎒 ${definition.name} 창고 보관`, '#93c5fd');
		}

		this.swordOffers = this.swordOffers.filter((offer) => offer.id !== definition.id);
		this.scene.soundSystem?.play('evolve', { volume: 0.5 });
		this.refresh();
	}

	reroll() {
		if (!this.spend(this.rerollPrice())) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
			return;
		}

		this.rerollCount += 1;
		this.rollSwordOffers();
		this.scene.soundSystem?.play('click', { volume: 0.5 });
		this.refresh();
	}

	// ---------------------------------------------------------------
	// Slot economy actions
	// ---------------------------------------------------------------

	buySlotUnlock() {
		const so = this.swordOrbit;
		if (!so || so.unlockedSlots >= so.maxSwords) {
			return;
		}

		const price = so.nextSlotUnlockCost();
		if (!this.spend(price)) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
			return;
		}

		so.unlockSlot();
		this.scene.soundSystem?.play('chest', { volume: 0.5 });
		this.refresh();
	}

	enhanceSlot(slotIndex, useGuarantee = false) {
		const so = this.swordOrbit;
		const state = so?.getSlotState(slotIndex);
		if (!state || slotIndex >= so.unlockedSlots) {
			return;
		}

		if (state.enhance >= (shopCatalog.slots?.enhanceMaxLevel ?? 10)) {
			return;
		}

		if (useGuarantee && MetaProgression.getGuaranteeCoins() <= 0) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
			return;
		}

		const price = so.enhanceCost(slotIndex);
		if (!this.spend(price)) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
			return;
		}

		if (useGuarantee) {
			MetaProgression.useGuaranteeCoin();
		}

		const result = so.tryEnhanceSlot(slotIndex, useGuarantee);

		if (result === 'success') {
			this.scene.soundSystem?.play('evolve', { volume: 0.6 });
			this.scene.cameras.main.flash(200, 167, 139, 250);
			this.showSlotResult(slotIndex, `+${state.enhance} 성공!`, '#4ade80');
		} else if (result === 'fail') {
			this.scene.soundSystem?.play('hurt', { volume: 0.4 });
			this.scene.cameras.main.shake(150, 0.004);
			this.showSlotResult(slotIndex, '실패...', '#ef4444');
		}

		this.refresh();
	}

	pullTraitFor(slotIndex) {
		const so = this.swordOrbit;
		if (!so?.canAddTrait(slotIndex)) {
			return;
		}

		if (!this.spend(150)) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
			return;
		}

		const trait = so.pullTrait(slotIndex);
		if (trait) {
			this.scene.soundSystem?.play('chest');
			this.scene.cameras.main.flash(350, 251, 191, 36);
			const sword = so.swords[slotIndex];
			const synergy = sword?.definition?.element && sword.definition.element === trait.element;
			this.showSlotResult(slotIndex, `${trait.icon} ${trait.name}${synergy ? ' ⚡시너지!' : ''}`, synergy ? '#fbbf24' : '#e5e7eb');
		}

		this.refresh();
	}

	showSlotResult(slotIndex, message, color) {
		const button = this.slotButtons?.[slotIndex];
		if (!button) {
			return;
		}

		const text = this.scene.add.text(button.x, button.y - 48, message, {
			fontFamily: 'Arial Black, Arial, sans-serif',
			fontSize: '14px',
			color,
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2306);
		text.setShadow(0, 2, '#000000', 3, false, true);

		this.scene.tweens.add({
			targets: text,
			y: text.y - 24,
			alpha: 0,
			duration: 1100,
			onComplete: () => text.destroy(),
		});
	}

	// Click = select (강화/특성 버튼 대상). 이동은 드래그 앤 드랍.
	handleSlotClick(slotIndex) {
		const so = this.swordOrbit;

		if (slotIndex >= so.unlockedSlots) {
			if (slotIndex === so.unlockedSlots && so.unlockedSlots < so.maxSwords) {
				this.buySlotUnlock();
			}
			return;
		}

		this.selectedSlot = this.selectedSlot === slotIndex ? null : slotIndex;
		this.scene.soundSystem?.play('click', { volume: 0.4 });
		this.refresh();
	}

	// ---------------------------------------------------------------
	// Drag & drop: 창고 → 칸(장착/교환), 칸 → 칸(교환), 칸 → 창고(해제)
	// ---------------------------------------------------------------

	findSlotAt(x, y) {
		if (!this.slotButtons) {
			return -1;
		}
		return this.slotButtons.findIndex((button) =>
			Math.abs(x - button.x) <= 37 && Math.abs(y - button.y) <= 37,
		);
	}

	isOverInventory(x, y) {
		const rect = this.invStripRect;
		return Boolean(rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h);
	}

	handleDrop(gameObject, pointer) {
		const so = this.swordOrbit;
		const type = gameObject.getData('shopDragType');
		const index = gameObject.getData('shopDragIndex');
		const slotIndex = this.findSlotAt(pointer.x, pointer.y);
		let acted = false;

		if (type === 'reserve') {
			if (slotIndex >= 0 && slotIndex < so.unlockedSlots) {
				acted = so.equipFromReserve(index, slotIndex);
			}
		} else if (type === 'slot') {
			if (slotIndex >= 0 && slotIndex !== index && slotIndex < so.unlockedSlots) {
				acted = so.swapSlots(index, slotIndex);
			} else if (this.isOverInventory(pointer.x, pointer.y)) {
				acted = so.unequipToReserve(index);
			}
		}

		this.scene.soundSystem?.play(acted ? 'evolve' : 'click', { volume: 0.4 });
		this.refresh();
	}

	// ---------------------------------------------------------------
	// UI
	// ---------------------------------------------------------------

	buildUi() {
		const { width, height } = this.scene.scale;

		const dim = this.scene.add.rectangle(width / 2, height / 2, width, height, 0x05070d, 0.88)
			.setScrollFactor(0).setDepth(2300);
		this.uiObjects.push(dim);

		const title = this.scene.add.text(width / 2, 30, `⚔ ROUND ${this.round} 클리어 ⚔`, {
			fontFamily: 'Arial Black, Arial, sans-serif',
			fontSize: '30px',
			color: '#4ade80',
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2301);
		title.setShadow(0, 4, '#000000', 6, false, true);
		this.uiObjects.push(title);

		this.goldText = this.scene.add.text(width / 2, 68, '', {
			fontFamily: 'Arial Black, Arial, sans-serif',
			fontSize: '22px',
			color: '#fbbf24',
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2301);
		this.uiObjects.push(this.goldText);

		// ── 스탯 카드 그리드 (좌측, 4열)
		this.statButtons = [];
		const cardWidth = 150;
		const cardHeight = 62;
		const gap = 8;
		const gridCols = 4;
		const gridX = 34;
		const gridY = 122;

		const statTitle = this.scene.add.text(gridX + (cardWidth * gridCols + gap * 3) / 2, gridY - 22, '📊 스탯', {
			fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '16px', color: '#e5e7eb',
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2301);
		this.uiObjects.push(statTitle);

		shopCatalog.stats.forEach((entry, index) => {
			const col = index % gridCols;
			const row = Math.floor(index / gridCols);
			const x = gridX + col * (cardWidth + gap) + cardWidth / 2;
			const y = gridY + row * (cardHeight + gap) + cardHeight / 2;

			const background = this.scene.add.rectangle(x, y, cardWidth, cardHeight, 0x141c2e, 0.97)
				.setStrokeStyle(1, 0x2b3a55)
				.setScrollFactor(0).setDepth(2301)
				.setInteractive({ useHandCursor: true });

			const icon = this.scene.add.text(x - cardWidth / 2 + 18, y - 12, entry.icon, { fontSize: '20px' })
				.setOrigin(0.5).setScrollFactor(0).setDepth(2302);

			const name = this.scene.add.text(x - cardWidth / 2 + 36, y - 12, '', {
				fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '13px', color: '#e5e7eb',
			}).setOrigin(0, 0.5).setScrollFactor(0).setDepth(2302);

			const priceText = this.scene.add.text(x + cardWidth / 2 - 10, y + 14, '', {
				fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '13px', color: '#fbbf24',
			}).setOrigin(1, 0.5).setScrollFactor(0).setDepth(2302);

			const valueText = this.scene.add.text(x - cardWidth / 2 + 10, y + 14, '', {
				fontFamily: 'Arial, sans-serif', fontSize: '10px', color: '#8fa3c0',
			}).setOrigin(0, 0.5).setScrollFactor(0).setDepth(2302);

			background.on('pointerover', () => {
				background.setFillStyle(0x1f2c47, 0.97);
				const count = this.purchaseCounts[entry.id] ?? 0;
				this.showTooltip(x, y - cardHeight / 2, `${entry.icon} ${entry.name}${count > 0 ? ` (구매 ${count}회)` : ''}`, entry.desc);
			});
			background.on('pointerout', () => {
				background.setFillStyle(0x141c2e, 0.97);
				this.hideTooltip();
			});
			background.on('pointerdown', () => this.buyStat(entry));

			this.uiObjects.push(background, icon, name, priceText, valueText);
			this.statButtons.push({ entry, name, priceText, valueText });
		});

		// ── 검 상점 (우측 상단, 스프라이트 카드 2개)
		const offerX = 700;
		const offerY = 128;
		const offerWidth = 176;
		const offerHeight = 196;

		const offerTitle = this.scene.add.text(offerX + offerWidth + 12, offerY - 24, '🗡️ 검 상점', {
			fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '16px', color: '#e5e7eb',
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2301);
		this.uiObjects.push(offerTitle);

		this.swordButtons = [];
		for (let i = 0; i < 2; i += 1) {
			const x = offerX + i * (offerWidth + 22) + offerWidth / 2;
			const y = offerY + offerHeight / 2;

			const background = this.scene.add.rectangle(x, y, offerWidth, offerHeight, 0x141c2e, 0.97)
				.setStrokeStyle(2, 0x4b5563)
				.setScrollFactor(0).setDepth(2301)
				.setInteractive({ useHandCursor: true });

			const sprite = this.scene.add.image(x, y - 56, 'sword', 0)
				.setDisplaySize(46, 46).setScrollFactor(0).setDepth(2302);

			const nameText = this.scene.add.text(x, y - 18, '', {
				fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '15px', color: '#e5e7eb', align: 'center',
			}).setOrigin(0.5).setScrollFactor(0).setDepth(2302);

			const badgeText = this.scene.add.text(x, y + 6, '', {
				fontFamily: 'Arial, sans-serif', fontSize: '12px', color: '#8fa3c0',
			}).setOrigin(0.5).setScrollFactor(0).setDepth(2302);

			const statText = this.scene.add.text(x, y + 30, '', {
				fontFamily: 'Arial, sans-serif', fontSize: '12px', color: '#c7d4e8', align: 'center',
			}).setOrigin(0.5).setScrollFactor(0).setDepth(2302);

			const priceText = this.scene.add.text(x, y + 70, '', {
				fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '16px', color: '#fbbf24',
			}).setOrigin(0.5).setScrollFactor(0).setDepth(2302);

			background.on('pointerdown', () => {
				const offer = this.swordButtons[i]?.offer;
				if (offer) {
					this.buySword(offer);
				}
			});
			background.on('pointerover', () => {
				const offer = this.swordButtons[i]?.offer;
				if (offer) {
					this.showTooltip(x, y - offerHeight / 2, offer.name, this.describeSwordDefinition(offer));
				}
			});
			background.on('pointerout', () => this.hideTooltip());

			this.uiObjects.push(background, sprite, nameText, badgeText, statText, priceText);
			this.swordButtons.push({ background, sprite, nameText, badgeText, statText, priceText, offer: null });
		}

		this.rerollButton = this.scene.add.text(offerX + offerWidth + 12, offerY + offerHeight + 22, '', {
			fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#e5e7eb',
			backgroundColor: '#1f2937', padding: { x: 12, y: 6 },
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2301).setInteractive({ useHandCursor: true });
		this.rerollButton.on('pointerdown', () => this.reroll());
		this.uiObjects.push(this.rerollButton);

		// ── 창고 (보유 검 인벤토리) — 드래그 앤 드랍의 출발/도착지
		const invY = 452;
		const invW = 624;
		this.invStripRect = { x: 34, y: invY - 29, w: invW, h: 58 };

		const invTitle = this.scene.add.text(34, invY - 44, '🎒 창고 (보유 검) — 아래 칸으로 드래그해서 장착', {
			fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '14px', color: '#e5e7eb',
		}).setOrigin(0, 0.5).setScrollFactor(0).setDepth(2301);

		const invStrip = this.scene.add.rectangle(34 + invW / 2, invY, invW, 58, 0x0d1322, 0.95)
			.setStrokeStyle(1, 0x2b3a55).setScrollFactor(0).setDepth(2300);

		this.uiObjects.push(invTitle, invStrip);
		this.reserveIcons = [];
		this.invScroll = 0;

		// 마스크: 스트립 바깥 아이콘은 잘라냄 (스크롤용)
		this.invMaskShape = this.scene.make.graphics();
		this.invMaskShape.fillRect(this.invStripRect.x, this.invStripRect.y, invW, this.invStripRect.h);
		this.invMask = this.invMaskShape.createGeometryMask();

		// 스크롤 버튼 + 휠
		this.invLeftButton = this.scene.add.text(this.invStripRect.x - 18, invY, '◀', {
			fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '18px', color: '#5b6b84',
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2301).setInteractive({ useHandCursor: true });
		this.invRightButton = this.scene.add.text(this.invStripRect.x + invW + 18, invY, '▶', {
			fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '18px', color: '#5b6b84',
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2301).setInteractive({ useHandCursor: true });
		this.invLeftButton.on('pointerdown', () => this.scrollInventory(-168));
		this.invRightButton.on('pointerdown', () => this.scrollInventory(168));
		this.uiObjects.push(this.invLeftButton, this.invRightButton);

		this.onWheel = (pointer, gameObjects, deltaX, deltaY) => {
			const rect = this.invStripRect;
			if (pointer.y >= rect.y - 20 && pointer.y <= rect.y + rect.h + 20
				&& pointer.x >= rect.x - 30 && pointer.x <= rect.x + rect.w + 30) {
				this.scrollInventory(deltaY > 0 ? 112 : -112);
			}
		};
		this.scene.input.on('wheel', this.onWheel);

		// 드래그 앤 드랍 핸들러 (씬 전역)
		this.prevDragThreshold = this.scene.input.dragDistanceThreshold;
		this.scene.input.dragDistanceThreshold = 8;

		this.onDragStart = (pointer, gameObject) => {
			if (gameObject.getData('shopDragType')) {
				gameObject.setDepth(2500);
				gameObject.clearMask(); // 창고 밖으로 드래그해도 보이게
				this.hideTooltip();
			}
		};
		this.onDrag = (pointer, gameObject, dragX, dragY) => {
			if (gameObject.getData('shopDragType')) {
				gameObject.setPosition(dragX, dragY);
			}
		};
		this.onDragEnd = (pointer, gameObject) => {
			if (gameObject.getData('shopDragType')) {
				this.handleDrop(gameObject, pointer);
			}
		};
		this.scene.input.on('dragstart', this.onDragStart);
		this.scene.input.on('drag', this.onDrag);
		this.scene.input.on('dragend', this.onDragEnd);

		// ── 내 검 (하단 슬롯 패널)
		this.slotButtons = [];
		const slotY = height - 130;
		const slotSpacing = 76;
		const slotStartX = 60;

		const slotTitle = this.scene.add.text(slotStartX - 22, slotY - 66, '', {
			fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '15px', color: '#e5e7eb',
		}).setOrigin(0, 0.5).setScrollFactor(0).setDepth(2301);
		this.slotTitle = slotTitle;
		this.uiObjects.push(slotTitle);

		for (let i = 0; i < 8; i += 1) {
			const x = slotStartX + i * slotSpacing;

			const box = this.scene.add.rectangle(x, slotY, 66, 66, 0x141c2e, 0.97)
				.setStrokeStyle(2, 0x2b3a55)
				.setScrollFactor(0).setDepth(2301)
				.setInteractive({ useHandCursor: true });

			const icon = this.scene.add.image(x, slotY - 6, 'sword', 0)
				.setDisplaySize(34, 34).setScrollFactor(0).setDepth(2302).setVisible(false);
			icon.setInteractive({ useHandCursor: true });
			this.scene.input.setDraggable(icon);
			icon.setData('shopDragType', 'slot');
			icon.setData('shopDragIndex', i);
			icon.on('pointerdown', () => this.handleSlotClick(i));
			icon.on('pointerover', () => {
				const info = this.getSlotInfoContent(i);
				this.showTooltip(x, slotY - 36, info.title, info.body);
			});
			icon.on('pointerout', () => this.hideTooltip());

			const enhText = this.scene.add.text(x + 23, slotY - 25, '', {
				fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '12px', color: '#fbbf24',
			}).setOrigin(0.5).setScrollFactor(0).setDepth(2303);

			const levelText = this.scene.add.text(x - 23, slotY - 25, '', {
				fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '12px', color: '#4ade80',
			}).setOrigin(0.5).setScrollFactor(0).setDepth(2303);

			const traitText = this.scene.add.text(x, slotY + 21, '', { fontSize: '11px' })
				.setOrigin(0.5).setScrollFactor(0).setDepth(2303);

			const actionText = this.scene.add.text(x, slotY + 48, '', {
				fontFamily: 'Arial, sans-serif', fontSize: '11px', color: '#8fa3c0', align: 'center',
			}).setOrigin(0.5).setScrollFactor(0).setDepth(2302);

			box.on('pointerdown', () => this.handleSlotClick(i));
			box.on('pointerover', () => {
				box.setFillStyle(0x1f2c47, 0.97);
				const info = this.getSlotInfoContent(i);
				this.showTooltip(x, slotY - 36, info.title, info.body);
			});
			box.on('pointerout', () => {
				box.setFillStyle(0x141c2e, 0.97);
				this.hideTooltip();
			});

			this.uiObjects.push(box, icon, enhText, levelText, traitText, actionText);
			this.slotButtons.push({ x, y: slotY, box, icon, enhText, levelText, traitText, actionText });
		}

		// ── 슬롯 액션 버튼 (선택된 칸에 적용: 강화 / 특성 / 💎)
		const buttonX = slotStartX + 8 * slotSpacing + 4;

		const makeButton = (offsetY, color) => {
			const button = this.scene.add.text(buttonX, slotY - 34 + offsetY, '', {
				fontFamily: 'Arial, sans-serif', fontSize: '13px', color,
				backgroundColor: '#1f2937', padding: { x: 10, y: 5 }, align: 'center',
			}).setOrigin(0, 0.5).setScrollFactor(0).setDepth(2301).setInteractive({ useHandCursor: true });
			this.uiObjects.push(button);
			return button;
		};

		this.enhanceButton = makeButton(0, '#e5e7eb');
		this.enhanceButton.on('pointerdown', () => {
			if (this.selectedSlot === null) {
				this.scene.soundSystem?.play('hurt', { volume: 0.2 });
				return;
			}
			this.enhanceSlot(this.selectedSlot, this.useGuarantee);
		});

		this.traitButton = makeButton(30, '#fbbf24');
		this.traitButton.on('pointerdown', () => {
			if (this.selectedSlot === null) {
				this.scene.soundSystem?.play('hurt', { volume: 0.2 });
				return;
			}
			this.pullTraitFor(this.selectedSlot);
		});

		this.guaranteeButton = makeButton(60, '#93c5fd');
		this.guaranteeButton.on('pointerdown', () => {
			this.useGuarantee = !this.useGuarantee;
			this.scene.soundSystem?.play('click', { volume: 0.4 });
			this.refresh();
		});

		this.selectHint = this.scene.add.text(slotStartX - 22, slotY + 44 + 22, '', {
			fontFamily: 'Arial, sans-serif', fontSize: '12px', color: '#8fa3c0',
		}).setOrigin(0, 0.5).setScrollFactor(0).setDepth(2301);
		this.uiObjects.push(this.selectHint);

		// ── 계속
		const continueText = this.scene.add.text(width / 2, height - 26, 'SPACE — 다음 라운드', {
			fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '20px', color: '#ffffff',
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2301);
		this.scene.tweens.add({ targets: continueText, alpha: 0.45, yoyo: true, repeat: -1, duration: 650 });
		this.uiObjects.push(continueText);

		this.keyHandler = (event) => {
			if (event.code === 'Space') {
				this.close();
			}
		};
		this.scene.input.keyboard.on('keydown', this.keyHandler);

		this.refresh();
	}

	// ---------------------------------------------------------------
	// Info panel helpers
	// ---------------------------------------------------------------


	describeSwordDefinition(definition, sword = null) {
		const lines = [];
		const typeLabel = definition.damageType === 'magic' ? '🔮 마법' : '⚔️ 물리';
		const pen = definition.damageType === 'magic' ? definition.magicPen : definition.physicalPen;

		lines.push(`${typeLabel} 피해 ${sword?.damage ?? definition.damage}${pen ? ` · 관통 ${Math.round(pen * 100)}%` : ''}`);
		lines.push(`쿨다운 ${Math.round(sword?.scanInterval ?? definition.cooldownMs)}ms · 연속타 ${sword?.hitsPerLaunch ?? definition.maxHits}`);

		if (definition.element) {
			const resonance = this.swordOrbit?.hasSetResonance(definition.element);
			lines.push(`원소 ${ELEMENT_LABELS[definition.element] ?? definition.element}${resonance ? ' (세트 공명 중!)' : ''}`);
		}
		if (definition.special) {
			lines.push(`✨ ${definition.special.label}`);
		}
		if (definition.trueDamage) {
			lines.push(`💛 고정 피해 +${definition.trueDamage} (저항 무시)`);
		}
		if (definition.maxHpDamage) {
			lines.push(`💛 최대 체력 ${Math.round(definition.maxHpDamage * 100)}% 추가 피해`);
		}

		return lines.join('\n');
	}

	getSlotInfoContent(slotIndex) {
		const so = this.swordOrbit;
		const sword = so.swords[slotIndex] ?? null;
		const state = so.getSlotState(slotIndex);

		if (slotIndex >= so.unlockedSlots) {
			return { title: `슬롯 ${slotIndex + 1} (잠김)`, body: '클릭해서 해방하면 검을 하나 더 장착할 수 있습니다' };
		}

		if (!sword) {
			return { title: `슬롯 ${slotIndex + 1} (비어있음)`, body: `강화 +${state.enhance}\n검 상점에서 새 검을 구매하면 이 슬롯에 장착됩니다\n클릭: 다른 검을 이 칸으로 이동` };
		}

		const lines = [this.describeSwordDefinition(sword.definition, sword)];
		lines.push(`강화 +${state.enhance} (피해 +${Math.round(state.enhance * 4)}%)`);

		if (state.traits.length > 0) {
			const traitLines = state.traits.map((id) => {
				const trait = so.getTraitById(id);
				const synergy = trait?.element && trait.element === sword.definition?.element;
				return `${trait?.icon} ${trait?.name}${synergy ? ' ⚡2배' : ''}`;
			});
			lines.push(traitLines.join('  '));
		}

		lines.push('클릭: 선택 → 다른 칸 클릭 시 이동/교환');

		return { title: `${sword.definition.name}  Lv${sword.level}`, body: lines.join('\n') };
	}

	getSetStatusLabel() {
		const counts = this.swordOrbit?.getElementCounts() ?? {};
		const parts = [];

		for (const [element, label] of Object.entries(ELEMENT_LABELS)) {
			const count = counts[element] ?? 0;
			if (count > 0) {
				const resonance = count >= 2 ? '공명!' : `${count}/2`;
				const ultimate = this.swordOrbit?.isUltimateUnlocked(element) ? '·필살' : '';
				parts.push(`${label} ${resonance}${ultimate}`);
			}
		}

		return parts.length > 0 ? `⚔ 내 검   |   세트: ${parts.join('   ')}` : '⚔ 내 검';
	}

	// ---------------------------------------------------------------
	// Refresh
	// ---------------------------------------------------------------

	refresh() {
		if (!this.isOpen) {
			return;
		}

		const gold = this.getGold();
		this.goldText.setText(`🪙 ${gold}`);
		this.slotTitle?.setText(this.getSetStatusLabel());

		for (const button of this.statButtons) {
			const count = this.purchaseCounts[button.entry.id] ?? 0;
			const price = this.statPrice(button.entry);
			button.name.setText(`${button.entry.name}${count > 0 ? ` ×${count}` : ''}`);
			button.valueText.setText(button.entry.desc.split('(')[0].trim());
			button.priceText.setText(`🪙${price}`).setColor(gold >= price ? '#fbbf24' : '#5b6b84');
		}

		this.swordButtons.forEach((button, index) => {
			const offer = this.swordOffers[index] ?? null;
			button.offer = offer;

			if (!offer) {
				button.background.setStrokeStyle(2, 0x2b3a55);
				button.sprite.setVisible(false);
				button.nameText.setText('품절');
				button.badgeText.setText('');
				button.statText.setText('');
				button.priceText.setText('');
				return;
			}

			const owned = this.swordOrbit?.getSwordById(offer.id);
			const price = this.swordPrice(offer, owned);
			const tint = offer.effect?.tint ?? '#e5e7eb';

			button.background.setStrokeStyle(2, Phaser.Display.Color.HexStringToColor(tint).color);
			button.sprite.setVisible(true).setFrame(offer.sheetOrder ?? 0);
			button.sprite.setTint(Phaser.Display.Color.HexStringToColor(tint).color);
			button.nameText.setText(owned ? `${offer.name}\nLv${owned.level} → ${owned.level + 1}` : offer.name).setColor(tint);

			const typeBadge = offer.damageType === 'magic' ? '🔮마법' : '⚔️물리';
			const elementBadge = offer.element ? ` ${ELEMENT_LABELS[offer.element]}` : '';
			button.badgeText.setText(`${typeBadge}${elementBadge}`);

			button.statText.setText(`피해 ${offer.damage} · 쿨 ${offer.cooldownMs}ms${offer.special ? `\n✨ ${offer.special.label}` : ''}`);
			button.priceText.setText(`🪙 ${price}`).setColor(gold >= price ? '#fbbf24' : '#5b6b84');
		});

		this.rerollButton.setText(`🔄 리롤 (🪙 ${this.rerollPrice()})`);
		this.refreshSlotPanel(gold);
		this.refreshInventory();
	}

	// 창고 스크롤 (픽셀 단위, 클램프)
	scrollInventory(delta) {
		const rect = this.invStripRect;
		const contentWidth = (this.swordOrbit?.reserve.length ?? 0) * 56 + 44;
		const maxScroll = Math.max(0, contentWidth - rect.w);
		const next = Phaser.Math.Clamp(this.invScroll + delta, 0, maxScroll);

		if (next !== this.invScroll) {
			this.invScroll = next;
			this.scene.soundSystem?.play('click', { volume: 0.2 });
			this.refreshInventory();
		}
	}

	// 창고 아이콘 재구성 (드래그 가능, 마스크 + 스크롤)
	refreshInventory() {
		for (const object of this.reserveIcons ?? []) {
			object.destroy();
		}
		this.reserveIcons = [];

		const so = this.swordOrbit;
		const rect = this.invStripRect;
		if (!so || !rect) {
			return;
		}

		// 스크롤 범위 재클램프 (검이 빠져나가 목록이 줄었을 때)
		const contentWidth = so.reserve.length * 56 + 44;
		const maxScroll = Math.max(0, contentWidth - rect.w);
		this.invScroll = Phaser.Math.Clamp(this.invScroll, 0, maxScroll);

		// 스크롤 버튼 활성 표시
		this.invLeftButton?.setColor(this.invScroll > 0 ? '#e5e7eb' : '#3f4b61');
		this.invRightButton?.setColor(this.invScroll < maxScroll ? '#e5e7eb' : '#3f4b61');

		if (so.reserve.length === 0) {
			const empty = this.scene.add.text(rect.x + rect.w / 2, rect.y + rect.h / 2,
				'비어있음 — 칸이 가득 차도 검을 사면 여기 보관됩니다', {
					fontFamily: 'Arial, sans-serif', fontSize: '12px', color: '#5b6b84',
				}).setOrigin(0.5).setScrollFactor(0).setDepth(2302);
			this.reserveIcons.push(empty);
			return;
		}

		so.reserve.forEach((entry, index) => {
			const x = rect.x + 34 + index * 56 - this.invScroll;
			const y = rect.y + rect.h / 2;

			// 마스크 밖으로 완전히 벗어난 아이콘은 생성 생략 (성능)
			if (x < rect.x - 40 || x > rect.x + rect.w + 40) {
				return;
			}

			const icon = this.scene.add.image(x, y, 'sword', entry.definition?.sheetOrder ?? 0)
				.setDisplaySize(36, 36).setScrollFactor(0).setDepth(2302)
				.setMask(this.invMask);

			if (entry.definition?.effect?.tint) {
				icon.setTint(Phaser.Display.Color.HexStringToColor(entry.definition.effect.tint).color);
			}

			icon.setInteractive({ useHandCursor: true });
			this.scene.input.setDraggable(icon);
			icon.setData('shopDragType', 'reserve');
			icon.setData('shopDragIndex', index);
			icon.on('pointerover', () => this.showTooltip(x, y - 26,
				`${entry.definition?.name} Lv${entry.level}`,
				`${this.describeSwordDefinition(entry.definition)}\n🖱 드래그해서 칸에 장착`));
			icon.on('pointerout', () => this.hideTooltip());

			const badge = this.scene.add.text(x + 14, y + 12, `L${entry.level}`, {
				fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '10px', color: '#4ade80',
			}).setOrigin(0.5).setScrollFactor(0).setDepth(2303).setMask(this.invMask);
			badge.setShadow(0, 1, '#000000', 2, false, true);

			this.reserveIcons.push(icon, badge);
		});

		// 스크롤 위치 표시 (n/m)
		if (maxScroll > 0) {
			const firstVisible = Math.floor(this.invScroll / 56) + 1;
			const label = this.scene.add.text(rect.x + rect.w - 8, rect.y + 8, `${firstVisible}~ / ${so.reserve.length}`, {
				fontFamily: 'Arial, sans-serif', fontSize: '10px', color: '#5b6b84',
			}).setOrigin(1, 0).setScrollFactor(0).setDepth(2303);
			this.reserveIcons.push(label);
		}
	}

	refreshSlotPanel(gold) {
		const so = this.swordOrbit;
		if (!so || !this.slotButtons) {
			return;
		}

		const maxEnhance = shopCatalog.slots?.enhanceMaxLevel ?? 10;

		this.slotButtons.forEach((button, i) => {
			const unlocked = i < so.unlockedSlots;
			const state = so.getSlotState(i);
			const sword = so.swords[i] ?? null;

			if (!unlocked) {
				const isNext = i === so.unlockedSlots && so.unlockedSlots < so.maxSwords;
				button.box.setStrokeStyle(2, 0x2b3a55).setFillStyle(0x0a0e18, 0.9);
				button.icon.setVisible(false);
				button.enhText.setText('');
				button.levelText.setText('');
				button.traitText.setText('🔒');
				if (isNext) {
					const cost = so.nextSlotUnlockCost();
					button.actionText.setText(`해방 🪙${cost}`).setColor(gold >= cost ? '#fbbf24' : '#5b6b84');
				} else {
					button.actionText.setText('잠김').setColor('#3f4b61');
				}
				return;
			}

			button.box.setFillStyle(0x141c2e, 0.97);
			button.box.setStrokeStyle(2, state.enhance >= maxEnhance ? 0xfbbf24 : 0x4b5563);

			// 드래그 후 원위치 복구 포함
			button.icon.setPosition(button.x, button.y - 6).setDepth(2302);

			if (sword) {
				button.icon.setVisible(true).setFrame(sword.definition?.sheetOrder ?? 0);
				if (sword.effect?.tint) {
					button.icon.setTint(Phaser.Display.Color.HexStringToColor(sword.effect.tint).color);
				} else {
					button.icon.clearTint();
				}
				button.levelText.setText(`L${sword.level}`);
			} else {
				button.icon.setVisible(false);
				button.levelText.setText('');
			}

			button.enhText.setText(state.enhance > 0 ? `+${state.enhance}` : '');

			const traitIcons = state.traits.map((id) => so.getTraitById(id)?.icon ?? '❔').join('');
			const emptySockets = state.enhance >= maxEnhance
				? '○'.repeat((shopCatalog.slots?.traitSockets ?? 3) - state.traits.length)
				: '';
			button.traitText.setText(traitIcons + emptySockets);

			// Selected slot: gold highlight
			if (this.selectedSlot === i) {
				button.box.setStrokeStyle(3, 0xfbbf24);
				button.box.setFillStyle(0x2a2410, 0.97);
			}

			if (state.enhance < maxEnhance) {
				button.actionText.setText(`+${state.enhance}/10`).setColor('#8fa3c0');
			} else if (so.canAddTrait(i)) {
				button.actionText.setText(`소켓 ${state.traits.length}/3`).setColor('#fbbf24');
			} else {
				button.actionText.setText('완성').setColor('#4ade80');
			}
		});

		// Action buttons act on the selected slot
		const coins = MetaProgression.getGuaranteeCoins();
		const selected = this.selectedSlot;
		const maxEnhanceLevel = shopCatalog.slots?.enhanceMaxLevel ?? 10;

		if (selected !== null && selected < so.unlockedSlots) {
			const state = so.getSlotState(selected);
			if (state.enhance < maxEnhanceLevel) {
				const cost = so.enhanceCost(selected);
				const rate = Math.round(so.enhanceSuccessRate(selected) * 100);
				this.enhanceButton.setText(`⬆ ${selected + 1}번 칸 강화 ${rate}% (🪙${cost})`).setColor(gold >= cost ? '#e5e7eb' : '#5b6b84');
			} else {
				this.enhanceButton.setText(`⬆ ${selected + 1}번 칸 강화 완료`).setColor('#4ade80');
			}

			if (so.canAddTrait(selected)) {
				this.traitButton.setText(`🎰 특성 뽑기 (🪙150)`).setColor(gold >= 150 ? '#fbbf24' : '#5b6b84');
			} else {
				const enhance = state.enhance;
				this.traitButton.setText(enhance >= maxEnhanceLevel ? '🎰 소켓 가득 참' : '🎰 특성 (10강 필요)').setColor('#5b6b84');
			}
		} else {
			this.enhanceButton.setText('⬆ 강화 — 칸을 선택하세요').setColor('#5b6b84');
			this.traitButton.setText('🎰 특성 — 칸을 선택하세요').setColor('#5b6b84');
		}

		this.guaranteeButton.setText(`💎 확정 강화 ${this.useGuarantee ? 'ON' : 'OFF'} (보유 ${coins})`);
		this.guaranteeButton.setColor(this.useGuarantee ? '#fbbf24' : '#93c5fd');

		this.selectHint?.setText(selected !== null
			? `${selected + 1}번 칸 선택됨 (강화/특성 버튼 대상) — 같은 칸 클릭: 취소`
			: '🖱 드래그: 창고↔칸 장착·해제, 칸↔칸 교환  ·  클릭: 칸 선택(강화/특성)  ·  호버: 상세');
	}

	destroyUi() {
		if (this.keyHandler) {
			this.scene.input.keyboard.off('keydown', this.keyHandler);
			this.keyHandler = null;
		}

		this.hideTooltip();

		if (this.onWheel) {
			this.scene.input.off('wheel', this.onWheel);
			this.onWheel = null;
		}
		this.invMask?.destroy();
		this.invMaskShape?.destroy();
		this.invMask = null;
		this.invMaskShape = null;
		this.invLeftButton = null;
		this.invRightButton = null;

		// Drag handlers off + threshold restore
		if (this.onDragStart) {
			this.scene.input.off('dragstart', this.onDragStart);
			this.scene.input.off('drag', this.onDrag);
			this.scene.input.off('dragend', this.onDragEnd);
			this.onDragStart = null;
			this.onDrag = null;
			this.onDragEnd = null;
			this.scene.input.dragDistanceThreshold = this.prevDragThreshold ?? 0;
		}

		for (const object of this.reserveIcons ?? []) {
			object.destroy();
		}
		this.reserveIcons = [];

		for (const object of this.uiObjects) {
			object.destroy();
		}
		this.uiObjects = [];
		this.statButtons = [];
		this.swordButtons = [];
		this.slotButtons = [];
		this.enhanceButton = null;
		this.traitButton = null;
		this.guaranteeButton = null;
		this.selectHint = null;
		this.selectedSlot = null;
	}
}
