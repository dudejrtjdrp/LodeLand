---
name: phaser-fx-runtime
description: Phaser 3 게임에 스프라이트시트 이펙트를 배선할 때 사용. 시트 로드·애니메이션 등록·풀링된 FX 헬퍼·블렌드/뎁스/틴트·성능 게이트(스로틀, reduceMotion)·텍스처 유닛 예산까지. "Phaser에 이펙트 붙여줘", "애니메이션 등록", "이펙트가 안 보여" 같은 상황에 발동.
---

# Phaser 3 FX 스프라이트 런타임 배선

## 1. 시트 vs 아틀라스

- **스프라이트시트** = 균일 격자. `load.spritesheet(key, path, { frameWidth, frameHeight })`. FX처럼 프레임 크기가 같은 것에 적합하고, 무엇보다 파이썬으로 만들기 쉽다.
- **아틀라스** = 임의 크기/위치 + JSON. 공간 효율이 좋다. 크기가 제각각인 UI·적·장식에 쓴다.
- FX 시트는 프레임이 커서(256~512px) 기존 아틀라스에 넣으면 2048 한계를 바로 넘긴다. **FX는 별도 시트로 유지한다.**

## 2. 로드와 애니메이션 등록 (BootScene)

프레임 수를 코드에 손으로 박지 말고 매니페스트로 돈다.

```ts
// preload
for (const [key, spec] of Object.entries(FX_SHEETS)) {
    this.load.spritesheet(key, `fx/${key}.png`, {
        frameWidth: spec.frameSize,
        frameHeight: spec.frameSize,
    });
}

// create
for (const [key, spec] of Object.entries(FX_SHEETS)) {
    if (!this.textures.exists(key) || this.anims.exists(`${key}-play`)) continue;
    this.anims.create({
        key: `${key}-play`,
        frames: this.anims.generateFrameNumbers(key, { start: 0, end: spec.frames - 1 }),
        frameRate: spec.fps,
        repeat: spec.loop ? -1 : 0,
    });
}
```

- `this.textures.exists` + `this.anims.exists` 가드는 필수다. 씬 재시작 시 중복 생성으로 경고가 뜬다.
- 픽셀아트 시트는 반드시 `texture.setFilter(Phaser.Textures.FilterMode.NEAREST)`. 부드러운 UI 이미지에는 걸지 않는다.

## 3. 풀링된 FX 스프라이트 헬퍼

FX마다 `add.sprite` 를 새로 만들면 GC가 튄다. 고정 크기 풀 + 커서로 재사용한다.

```ts
const FX_SPRITE_POOL_MAX = 24;

fxSprite(key: string, x: number, y: number, opts: {
    size?: number; rotation?: number; tint?: number;
    depth?: number; alpha?: number; additive?: boolean; flipY?: boolean;
} = {}): Phaser.GameObjects.Sprite | null {
    if (reduceMotion() || this.fxThrottle() >= 3) return null;   // 성능/접근성 게이트
    const anim = `${key}-play`;
    if (!this.scene.anims.exists(anim)) return null;             // 에셋 없으면 조용히 폴백

    const s = this.spritePool[this.spriteCursor];
    this.spriteCursor = (this.spriteCursor + 1) % FX_SPRITE_POOL_MAX;

    s.setTexture(key).setPosition(x, y).setVisible(true).setActive(true);
    s.setDepth(opts.depth ?? FX_DEPTH);
    s.setRotation(opts.rotation ?? 0);
    s.setAlpha(opts.alpha ?? 1);
    s.setBlendMode(opts.additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    if (opts.tint !== undefined) s.setTint(opts.tint); else s.clearTint();
    if (opts.size) s.setDisplaySize(opts.size, opts.size);
    s.setFlipY(!!opts.flipY);
    s.play(anim);                                                // 재생 중이어도 처음부터 다시
    return s;
}
```

정리는 이벤트로 한 번만 등록한다 (매 호출마다 `once` 를 붙이면 리스너가 샌다):

```ts
// 풀 생성 시 1회
s.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.setVisible(false).setActive(false));
```

루프 시트는 `ANIMATION_COMPLETE` 가 안 오므로 **소유자가 직접 끈다**. 지속 스킬은 스프라이트 핸들을 보관하고 종료 시각에 `stop()` + `setVisible(false)`.

## 4. 반드시 지킬 규칙

- **뎁스 상수를 한 곳에서 관리한다.** 이펙트가 적 밑으로 깔리거나 UI를 덮는 사고의 99%는 매직넘버 뎁스다.
- **틴트는 곱연산**이다. 베이스가 어두운 시트에 `setTint(0x3355ff)` 하면 거의 검게 죽는다. 밝은 회색조 베이스를 쓴다.
- **`setDisplaySize` 는 실제 반경의 약 2배**로 준다. 시트에는 여백이 있어 딱 맞추면 작아 보인다. 판정 반경과 시각 반경을 혼동하지 말 것.
- **`setScale` 은 픽셀 스냅을 깬다.** 정수배(1x/2x/3x)에서 가장 깨끗하다. 부득이하면 시트를 그 크기로 다시 뽑는 게 낫다.
- **애니메이션이 안 보이면** 순서대로 확인: 텍스처 로드 여부 → anim 존재 여부 → depth → alpha → displaySize → 카메라 뷰 안인지 → `scrollFactor`.
- **`play()` 재호출은 즉시 리셋**된다. 같은 스킬을 연타할 때 원하는 동작이면 그대로, 겹쳐 보이길 원하면 풀에서 다른 슬롯이 나오도록 커서를 돌린다.

## 5. 성능 예산

- 텍스처 유닛이 진짜 병목이다. 한 프레임에서 참조하는 **서로 다른 텍스처 수**가 GPU 유닛(보통 8~16)을 넘으면 배치가 쪼개지고 드로우콜이 폭증한다. FX 시트 수를 늘릴수록 이 비용이 붙으니, 회색조 1장 + 틴트로 원소를 커버하는 전략이 실효가 크다.
- 오프스크린 이펙트는 만들지 않는다. 스폰 전에 카메라 뷰 판정을 넣는다.
- `game.loop.actualFps` 기반 스로틀 단계(1/2/3)를 두고, 3단계에서는 장식성 이펙트를 통째로 건너뛴다.
- `reduceMotion` 설정에서는 애니메이션을 끄되 **정지 프레임 1장은 남긴다** (아무것도 안 나오면 스킬이 발동했는지 알 수 없다).
- 지속 이펙트를 루프 스프라이트로 바꾸면 대개 CPU가 **줄어든다** — 매 프레임 Graphics 재작도가 사라지기 때문.

## 6. 회전·방향

```ts
const angle = Math.atan2(ty - y, tx - x);
this.fxSprite('fx-swordwave', x, y, { rotation: angle, depth: FX_DEPTH });
// 시트는 +X 를 향해 그려져 있어야 한다. 원점은 setOrigin(0, 0.5).
```

## 7. 에셋이 없을 때의 폴백

시트가 아직 없어도 게임이 멀쩡히 돌아야 한다. `fxSprite` 가 `null` 을 반환하면 기존 절차적 연출로 떨어지게 배선한다.

```ts
if (!this.fxSprite('fx-nova-ice', x, y, { size: r * 2.2, additive: true })) {
    this.fxRing(x, y, { r0: 10, r1: r, color: 0xbae6fd });   // 기존 코드 유지
}
```

이 폴백 구조 덕분에 이펙트를 한 번에 하나씩 교체할 수 있고, 롤백도 에셋 파일만 빼면 된다.
