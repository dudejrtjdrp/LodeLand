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
				gameObject.setData('wasDragged', true); // pointerup 선택과 드래그를 구분
				gameObject.setDepth(2500);
				gameObject.clearMask(); // 창고 밖으로 드래그해도 보이게
				this.ui.hideTooltip();
			}
		};
		// UI 루트가 스케일된 상태라 Phaser 가 넘겨주는 dragX/dragY 대신
		// 포인터를 로컬 좌표로 직접 변환해 따라가게 한다.
		this.onDrag = (pointer, gameObject) => {
			if (gameObject.getData('shopDragType')) {
				gameObject.setPosition(this.ui.toLocalX(pointer.x), this.ui.toLocalY(pointer.y));
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

	/** 스크린 포인터 좌표를 받아 로컬 좌표로 변환한 뒤 히트테스트 */
	findSlotAt(screenX: number, screenY: number): number {
		if (!this.ui.slotButtons) {
			return -1;
		}
		const x = this.ui.toLocalX(screenX);
		const y = this.ui.toLocalY(screenY);
		return this.ui.slotButtons.findIndex((button) =>
			Math.abs(x - button.x) <= button.size / 2 && Math.abs(y - button.y) <= button.size / 2,
		);
	}

	isOverInventory(screenX: number, screenY: number): boolean {
		const rect = this.ui.invStripRect;
		const x = this.ui.toLocalX(screenX);
		const y = this.ui.toLocalY(screenY);
		return Boolean(rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h);
	}

	/** 판매 버튼(드롭 영역) 위인가 */
	isOverSell(screenX: number, screenY: number): boolean {
		const rect = this.ui.sellRect;
		const x = this.ui.toLocalX(screenX);
		const y = this.ui.toLocalY(screenY);
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
			} else if (this.isOverSell(pointer.x, pointer.y)) {
				// 판매 버튼에 놓으면 즉시 판매 (효과음/announce는 sellReserve가 담당)
				this.shop.sellReserve(index);
				return;
			} else {
				// 보관함 안의 다른 칸에 놓으면 위치 교환/이동 (정렬)
				const cell = this.ui.findReserveCellAt(pointer.x, pointer.y);
				if (cell >= 0 && cell !== index) {
					acted = this.shop.moveReserve(index, cell);
				}
			}
		} else if (type === 'slot') {
			if (slotIndex >= 0 && slotIndex !== index && slotIndex < so.unlockedSlots) {
				acted = so.swapSlots(index, slotIndex);
			} else if (this.isOverSell(pointer.x, pointer.y)) {
				this.shop.sellEquipped(index);
				return;
			} else if (this.isOverInventory(pointer.x, pointer.y)) {
				acted = so.unequipToReserve(index);
				// 해제된 검(맨 뒤에 들어감)을 실제로 놓은 칸으로 옮겨준다
				const cell = this.ui.findReserveCellAt(pointer.x, pointer.y);
				if (acted && cell >= 0 && cell < so.reserve.length - 1) {
					this.shop.moveReserve(so.reserve.length - 1, cell);
				}
			}
		}

		this.shop.scene.soundSystem?.play(acted ? 'evolve' : 'click', { volume: 0.4 });
		this.shop.refresh();
	}
}
