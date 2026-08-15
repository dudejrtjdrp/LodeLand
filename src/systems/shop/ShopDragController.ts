// Shop drag & drop: 창고 → 칸(장착/교환), 칸 → 칸(교환), 칸 → 창고(해제).
// Scene-global drag handlers keyed off setData('shopDragType'/'shopDragIndex');
// dragDistanceThreshold 8 keeps click-to-select working alongside dragging.
// All placement changes route through SwordOrbitSystem
// (equipFromReserve / swapSlots / unequipToReserve).

import type Phaser from 'phaser';
import type ShopSystem from './ShopSystem';
import type ShopUi from './ShopUi';

type DragHandler = (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.Image) => void;
type DragMoveHandler = (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.Image, dragX: number, dragY: number) => void;

export default class ShopDragController {
	shop: ShopSystem;
	ui: ShopUi;

	prevDragThreshold: number | null = null;
	onDragStart: DragHandler | null = null;
	onDrag: DragMoveHandler | null = null;
	onDragEnd: DragHandler | null = null;

	constructor(shop: ShopSystem, ui: ShopUi) {
		this.shop = shop;
		this.ui = ui;
	}

	// 드래그 앤 드랍 핸들러 (씬 전역) — buildUi 시점에 설치
	install() {
		const input = this.shop.scene.input;

		this.prevDragThreshold = input.dragDistanceThreshold;
		input.dragDistanceThreshold = 8;

		this.onDragStart = (pointer, gameObject) => {
			if (gameObject.getData('shopDragType')) {
				gameObject.setDepth(2500);
				gameObject.clearMask(); // 창고 밖으로 드래그해도 보이게
				this.ui.hideTooltip();
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
		input.on('dragstart', this.onDragStart);
		input.on('drag', this.onDrag);
		input.on('dragend', this.onDragEnd);
	}

	// Drag handlers off + threshold restore
	uninstall() {
		if (!this.onDragStart) {
			return;
		}

		const input = this.shop.scene.input;
		input.off('dragstart', this.onDragStart);
		input.off('drag', this.onDrag!);
		input.off('dragend', this.onDragEnd!);
		this.onDragStart = null;
		this.onDrag = null;
		this.onDragEnd = null;
		input.dragDistanceThreshold = this.prevDragThreshold ?? 0;
	}

	// ---------------------------------------------------------------
	// Hit-testing
	// ---------------------------------------------------------------

	findSlotAt(x: number, y: number): number {
		if (!this.ui.slotButtons) {
			return -1;
		}
		return this.ui.slotButtons.findIndex((button) =>
			Math.abs(x - button.x) <= 37 && Math.abs(y - button.y) <= 37,
		);
	}

	isOverInventory(x: number, y: number): boolean {
		const rect = this.ui.invStripRect;
		return Boolean(rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h);
	}

	handleDrop(gameObject: Phaser.GameObjects.Image, pointer: Phaser.Input.Pointer) {
		const so = this.shop.swordOrbit!;
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

		this.shop.scene.soundSystem?.play(acted ? 'evolve' : 'click', { volume: 0.4 });
		this.shop.refresh();
	}
}
