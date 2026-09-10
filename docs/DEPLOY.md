# 배포

LODELAND은 서버가 필요 없는 100% 정적 클라이언트다. `dist/`를 정적 호스팅에 올리면 끝난다.
(세이브·설정·도감·업적은 전부 브라우저 `localStorage`에 저장된다.)

## 한 번만: Cloudflare 로그인

```bash
npx wrangler login
```

브라우저가 열리고 계정 인증을 하면 끝. 프로젝트는 첫 배포 때 자동 생성된다.

첫 배포 시 "Enter the production branch name" 프롬프트가 뜨면 **`main`**을 입력한다
(기본값은 현재 체크아웃된 브랜치라 그대로 두면 안 된다).
`npm run deploy`는 `--branch=main`을 고정하므로, 어느 브랜치에서 실행하든
프리뷰가 아니라 프로덕션(`lodeland.pages.dev`)으로 올라간다.

## 배포

```bash
npm run deploy
```

`vite build` 후 `dist/`를 Cloudflare Pages에 올린다.
결과 URL: `https://lodeland.pages.dev`

CLI 없이 하려면 `npm run build` 후 [dash.cloudflare.com](https://dash.cloudflare.com) →
Workers & Pages → Create → Pages → Upload assets에 `dist` 폴더를 드래그하면 된다.

## 배포 전 검증

```bash
npm run build
npx vite preview --port 5199 &
npm run smoke:dist http://localhost:5199
```

실제 브라우저로 dist를 열어 에셋 404·콘솔 에러·캔버스 생성을 확인한다.

## 설정 메모

- **`vite.config.ts`의 `base: './'`** — 어떤 하위 경로에 올려도 동작한다.
  GitHub Pages(`/repo/`), itch.io zip 업로드 모두 대응. 루트 도메인도 문제없음.
- **`build.assetsDir: 'build'`** — `public/assets/`(검 시트 등 게임 에셋)와
  Vite 번들 출력이 둘 다 `dist/assets`로 가면 충돌한다. 번들만 `dist/build/`로 분리했다.
- **`public/_headers`** — Cloudflare Pages / Netlify 캐시 규칙. 빌드 시 `dist/` 루트로 복사된다.
  해시 붙은 `/build/*`만 영구 캐시, `index.html`은 no-cache.

## 알아둘 것

- 전체 용량 약 10MB (2026-09-07: BGM 폴백을 wav 11MB → m4a 2.3MB 로 교체해 절반으로 줄임).
  BGM은 ogg 2.4MB + m4a 2.3MB — 브라우저는 둘 중 하나만 받는다. 더 줄이려면 BGM lazy load.
- `index.html`에 HTML 로딩 화면이 있다 — Phaser 부팅 전(번들 2MB 다운로드·에셋 로드)에도
  검은 화면 대신 로고와 진행 바가 보인다. BootScene 이 진행률을 채우고 타이틀 직전에 지운다.
- 번들은 2.2MB(gzip 560KB)이고 대부분 Phaser다. 단일 청크라 코드 스플리팅 여지가 있지만
  어차피 시작 시 전부 필요하므로 우선순위는 낮다.
- Google Fonts(Jua, Gowun Dodum)는 CDN에서 받는다. 실패해도 시스템 고딕으로 폴백되고
  레이아웃은 유지된다.

## 다른 호스팅

| | 무료 대역폭 | 비고 |
|---|---|---|
| Cloudflare Pages | 무제한 | 현재 설정 대상 |
| Netlify | 100GB/월 | `_headers` 그대로 동작, drop.netlify.com에 드래그 |
| Vercel | 100GB/월 | `_headers` 대신 `vercel.json` 필요 |
| GitHub Pages | 100GB/월 | `base: './'` 덕에 그대로 동작, `_headers`는 무시됨 |
| itch.io | 1GB | `dist` zip 업로드, "This file will be played in the browser" 체크 |
