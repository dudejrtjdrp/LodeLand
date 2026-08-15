/// <reference types="vite/client" />

import type GameScene from './scenes/GameScene';

declare global {
	interface Window {
		/** Dev-only debug hook (stripped from production builds). */
		__gameScene?: GameScene;
	}
}

export {};
