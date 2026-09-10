import { defineConfig } from 'vite';

export default defineConfig({
	// 상대경로 배포: GitHub Pages의 /repo/ 하위 경로, itch.io zip 등
	// 어떤 경로에 올려도 번들을 찾을 수 있게 한다. 루트 도메인 배포에도 안전.
	base: './',

	build: {
		// public/assets/ (검 시트 등 게임 에셋)와 Vite 번들 출력이
		// 둘 다 dist/assets 로 가면 충돌한다. 번들은 dist/build/ 로 분리.
		assetsDir: 'build',

		// Phaser 단일 청크가 커서 기본 500KB 경고가 계속 뜬다. 의미 없는 경고라 상향.
		chunkSizeWarningLimit: 1600,

		// 소스맵은 배포본에서 제외 (용량·소스 노출)
		sourcemap: false,
	},
});
