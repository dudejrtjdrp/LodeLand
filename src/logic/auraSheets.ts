// 자동 생성 — scripts/generate-aura-sheets.py 가 만든 파일. 직접 수정 금지.
// 원소 세트 오라 스프라이트시트 규격.
export interface AuraSheetSpec {
	frameSize: number;
	frames: number;
	cols: number;
}

export const AURA_SHEETS: Record<string, AuraSheetSpec> = {
	fire: { frameSize: 272, frames: 47, cols: 8 },
	electric: { frameSize: 256, frames: 28, cols: 8 },
	ice: { frameSize: 256, frames: 40, cols: 8 },
	poison: { frameSize: 256, frames: 43, cols: 8 },
	gold: { frameSize: 256, frames: 40, cols: 8 },
	blood: { frameSize: 256, frames: 40, cols: 8 },
	wind: { frameSize: 256, frames: 40, cols: 8 },
	void: { frameSize: 256, frames: 64, cols: 8 },
};
