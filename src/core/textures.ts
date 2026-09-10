// 통합 텍스처 아틀라스 키.
//
// 적 25장·장식 18장을 각각 한 장으로 묶었다. 적은 전부 depth 1이라 화면에서 종류가
// 섞이는데, 텍스처가 흩어져 있으면 스프라이트마다 WebGL 배치가 flush되어 draw call이
// 폭증한다. 한 장이면 1~2회로 끝난다 (뱀파이어 서바이벌류의 1번 최적화).
//
// 카탈로그의 `textureKey` 는 이제 아틀라스 안의 **프레임 접두사**로 쓰인다:
// 원본 `ts-red-warrior` 시트의 3번 프레임 → 아틀라스 프레임 이름 `ts-red-warrior/3`.
//
// 아틀라스 재생성: `node scripts/build-atlas.mjs`
// (원본 png 를 추가·교체했으면 반드시 다시 돌려야 한다.)
//
// main.ts 가 아니라 별도 모듈에 두는 이유: main → GameScene → EnemyManager 순환 import 방지.

export const ENEMY_ATLAS = 'enemies-atlas';
export const DECO_ATLAS = 'deco-atlas';
