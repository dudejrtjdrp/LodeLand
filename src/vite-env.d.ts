/// <reference types="vite/client" />

import type Phaser from 'phaser';
import type GameScene from './scenes/GameScene';
import type CodexScene from './scenes/CodexScene';
import type TitleScene from './scenes/TitleScene';
import type RunSave from './core/RunSave';
import type BgmSystem from './systems/BgmSystem';
import type AchievementSystem from './systems/AchievementSystem';
import type { KEYWORDS } from './ui/keywords';
import type * as codex from './core/codex';
import type * as stats from './core/stats';
import type * as telemetry from './core/telemetry';
import type * as keybinds from './core/keybinds';
import type * as settings from './core/settings';

declare global {
	interface Window {
		/** Dev-only debug hook (stripped from production builds). */
		__gameScene?: GameScene;
		/** Dev-only: UI 히트 영역 전수 검사용 게임 인스턴스 (ui-hit-test.mjs). */
		__game?: Phaser.Game;
		/** Dev-only: 세이브 왕복 회귀 테스트용 (element-set-test.mjs). */
		__RunSave?: typeof RunSave;
		/** Dev-only: 배경음 상태 검사용 (bgm-test.mjs). */
		__bgm?: BgmSystem;
		/** Dev-only: 온보딩 용어 사전 검사용 (onboarding-test.mjs). */
		__keywords?: typeof KEYWORDS;
		/** Dev-only: 도감 화면 검사용 (meta-test.mjs). */
		__codexScene?: CodexScene;
		/** Dev-only: 도감 획득 이력 모듈 (meta-test.mjs). */
		__codex?: typeof codex;
		/** Dev-only: 누적 통계 모듈 (meta-test.mjs). */
		__stats?: typeof stats;
		/** Dev-only: 로컬 런 기록 모듈 (meta-test.mjs). */
		__telemetry?: typeof telemetry;
		/** Dev-only: 도전과제 시스템 (meta-test.mjs). */
		__achievements?: typeof AchievementSystem;
		/** Dev-only: 타이틀 설정 창 레이아웃 QA (polish-test.mjs). */
		__titleScene?: TitleScene;
		/** Dev-only: 키 리맵 모듈 (polish-test.mjs). */
		__keybinds?: typeof keybinds;
		/** Dev-only: 접근성/음량 설정 모듈 (polish-test.mjs). */
		__settings?: typeof settings;
	}
}

export {};
