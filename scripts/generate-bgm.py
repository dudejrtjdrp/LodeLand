#!/usr/bin/env python3
"""LODELAND BGM/정보음 절차 생성기 (numpy 합성 → ogg/wav).

세계관: 버려진 정련 지대, 금속 맹금 검 — 어둡지만 모험적인 톤.
4트랙 모두 A 단조(자연/화성) 계열, 코드 진행 i–VI–III–VII 축.

  title   76 BPM  Am–F–C–G      잔잔·신비 (패드 + 아르페지오, 드럼 없음)
  battle 132 BPM  Am–F–C–G      드라이브 미드템포 (킥/스네어/하이햇 + 8분 베이스)
  boss   152 BPM  Am–F–Dm–E     긴박 (하모닉 마이너 V, 16분 하이햇, 팀파니 롤)
  village 92 BPM  Am–F–C–G      따뜻·한가 (Karplus-Strong 뜯는 현 + 셰이커)

전투 긴장도 레이어 (2026-09-01) — battle 위에 **겹쳐 재생**하는 강화 트랙 2장:
  battle-layer1  퍼커션 증강 (엇박 16분 하이햇 · 고스트 스네어 · 뒷박 킥 · 타이코 액센트)
  battle-layer2  리드 증강   (옥타브 위 리드 · 파워 스탭 · 대선율)

  · base 와 **완전히 같은 BPM·마디수·길이**로 렌더한다 (24마디 @132BPM = 43.6초).
    Track 클래스가 같은 n 으로 꼬리를 되접으므로 루프 경계도 정확히 일치한다.
  · 그래서 BgmSystem 이 base 와 레이어를 **같은 시점에 동시에 play()** 하면
    이후 영원히 싱크가 유지된다 (둘 다 loop, offset 0).
  · 레이어는 정규화 뒤 고정 게인(LAYER_GAIN)만 곱해 쓴다 — write_wav 의 피크
    정규화를 끄지 않으면 성긴 퍼커션 레이어가 base 만큼 커져 균형이 깨진다.

루프 이음매: 전체 길이 N 뒤에 TAIL 초를 더 렌더한 다음 딜레이/리버브를 걸고,
꼬리 구간을 버퍼 앞으로 되접어 더한다 → 페이드 없이 N 지점에서 완전 심리스.

산출물:
  public/bgm/{title,battle,boss,village}.ogg   기본 (ffmpeg 필요)
  public/bgm/{title,battle,boss,village}.m4a   폴백 AAC 64k 22050Hz 모노 (ffmpeg 필요)
  public/bgm/battle-layer{1,2}.{ogg,m4a}       전투 긴장도 레이어
  public/sfx/lowhp.wav        저체력 경고 (22050Hz 16bit mono — 기존 SFX 규격)
  public/sfx/telegraph.wav    보스 즉살기 전조음

사용: python3 scripts/generate-bgm.py            (전부)
      python3 scripts/generate-bgm.py battle battle-layer1 battle-layer2
"""

from __future__ import annotations

import math
import os
import shutil
import subprocess
import sys
import tempfile
import wave

import numpy as np

SR = 44100
SFX_SR = 22050
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BGM_DIR = os.path.join(ROOT, 'public', 'bgm')
SFX_DIR = os.path.join(ROOT, 'public', 'sfx')
TAIL = 2.4  # 초 — 이 길이만큼 더 렌더해서 앞으로 되접는다

# ── 음이름 → 주파수 ────────────────────────────────────────────────
_STEP = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def midi(name: str) -> int:
    letter, rest = name[0].upper(), name[1:]
    acc = 0
    while rest and rest[0] in '#b':
        acc += 1 if rest[0] == '#' else -1
        rest = rest[1:]
    return 12 * (int(rest) + 1) + _STEP[letter] + acc


def hz(name: str, cents: float = 0.0) -> float:
    return 440.0 * 2 ** ((midi(name) - 69) / 12.0 + cents / 1200.0)


# ── 기본 파형 ─────────────────────────────────────────────────────

def _phase(f0: float, n: int, vib_hz: float = 0.0, vib_cents: float = 0.0,
           glide_to: float | None = None) -> np.ndarray:
    t = np.arange(n) / SR
    freq = np.full(n, f0, dtype=np.float64)
    if glide_to is not None:
        freq = f0 * (glide_to / f0) ** np.clip(t / max(t[-1], 1e-6), 0, 1)
    if vib_cents:
        # 어택 뒤부터 서서히 들어오는 비브라토
        depth = 2 ** (vib_cents / 1200.0 * np.sin(2 * math.pi * vib_hz * t))
        ramp = np.clip(t / 0.35, 0, 1)
        freq = freq * (1 + (depth - 1) * ramp)
    return 2 * math.pi * np.cumsum(freq) / SR


def osc(kind: str, f0: float, n: int, duty: float = 0.5, **kw) -> np.ndarray:
    ph = _phase(f0, n, **kw)
    if kind == 'sine':
        return np.sin(ph)
    if kind == 'tri':
        x = np.mod(ph / (2 * math.pi), 1.0)
        return 4 * np.abs(x - 0.5) - 1
    if kind == 'saw':
        x = np.mod(ph / (2 * math.pi), 1.0)
        return 2 * x - 1
    if kind == 'pulse':
        x = np.mod(ph / (2 * math.pi), 1.0)
        return np.where(x < duty, 1.0, -1.0)
    raise ValueError(kind)


def adsr(n: int, a: float, d: float, s: float, r: float) -> np.ndarray:
    """길이 n 샘플에 대한 ADSR (a/d/r 은 초, s 는 서스테인 레벨 0~1)."""
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    ns = max(0, n - na - nd - nr)
    if na + nd + nr > n:  # 짧은 노트는 비율로 압축
        scale = n / max(1, (na + nd + nr))
        na, nd, nr = int(na * scale), int(nd * scale), int(nr * scale)
        ns = max(0, n - na - nd - nr)
    parts = [
        np.linspace(0, 1, na, endpoint=False) if na else np.empty(0),
        np.linspace(1, s, nd, endpoint=False) if nd else np.empty(0),
        np.full(ns, s),
        np.linspace(s, 0, nr) if nr else np.empty(0),
    ]
    env = np.concatenate(parts)
    if len(env) < n:
        env = np.concatenate([env, np.zeros(n - len(env))])
    return env[:n]


def _conv(x: np.ndarray, k: np.ndarray) -> np.ndarray:
    """x * k (앞부분만) — 길면 FFT, 짧으면 직접 컨볼루션."""
    if len(x) * len(k) > 1_000_000:
        size = 1 << (len(x) + len(k) - 1).bit_length()
        y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(k, size), size)
        return y[:len(x)]
    return np.convolve(x, k)[:len(x)]


def lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    """1극 저역통과 — 지수 감쇠 커널(잘라낸 IIR 임펄스 응답) 컨볼루션."""
    dt = 1.0 / SR
    rc = 1.0 / (2 * math.pi * max(20.0, cutoff))
    a = dt / (rc + dt)
    b = 1.0 - a
    klen = min(len(x), max(8, int(math.log(1e-4) / math.log(max(b, 1e-9))) + 1))
    kernel = a * b ** np.arange(klen)
    return _conv(x, kernel)


def highpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    return x - lowpass(x, cutoff)


def fb_delay(x: np.ndarray, ms: float, fb: float) -> np.ndarray:
    """피드백 딜레이 — 블록 단위(딜레이 길이)로 정확히 계산."""
    d = max(1, int(SR * ms / 1000.0))
    y = x.copy()
    for start in range(d, len(y), d):
        end = min(start + d, len(y))
        y[start:end] += fb * y[start - d:start - d + (end - start)]
    return y


def reverb(x: np.ndarray, amount: float = 0.35) -> np.ndarray:
    """콤 4개 + 짧은 확산 — 정련소 홀 느낌의 값싼 리버브."""
    wet = np.zeros_like(x)
    for ms, fb, g in ((37.1, 0.72, 1.0), (43.7, 0.70, 0.9), (53.3, 0.68, 0.8), (61.9, 0.65, 0.7)):
        wet += g * fb_delay(x, ms, fb)
    wet = lowpass(wet, 3200) / 3.4
    wet = fb_delay(wet, 11.3, 0.35) * 0.7
    return x + amount * wet


# ── 트랙 캔버스 ───────────────────────────────────────────────────

class Track:
    def __init__(self, seconds: float):
        self.n = int(seconds * SR)
        self.total = self.n + int(TAIL * SR)
        self.dry = np.zeros(self.total)
        self.echo = np.zeros(self.total)   # 딜레이 센드
        self.verb = np.zeros(self.total)   # 리버브 센드

    def add(self, t: float, buf: np.ndarray, gain: float = 1.0,
            echo: float = 0.0, verb: float = 0.0) -> None:
        i = int(t * SR)
        if i >= self.total:
            return
        seg = buf[:self.total - i]
        self.dry[i:i + len(seg)] += gain * seg
        if echo:
            self.echo[i:i + len(seg)] += gain * echo * seg
        if verb:
            self.verb[i:i + len(seg)] += gain * verb * seg

    def mix(self, echo_ms: float = 375.0, echo_fb: float = 0.42,
            verb_amount: float = 0.5) -> np.ndarray:
        out = self.dry.copy()
        if np.any(self.echo):
            out += 0.55 * fb_delay(self.echo, echo_ms, echo_fb)
        if np.any(self.verb):
            out += reverb(self.verb, verb_amount) - self.verb
        # 꼬리를 앞으로 되접는다 → 루프 이음매 정합
        tail = out[self.n:]
        out = out[:self.n].copy()
        out[:len(tail)] += tail
        peak = float(np.max(np.abs(out))) or 1.0
        out = np.tanh(out / peak * 1.15) * 0.86
        return out


# ── 악기 ─────────────────────────────────────────────────────────
# 같은 인자의 보이스는 곡 안에서 수십 번 반복된다 → 결과 버퍼를 캐시한다.
# (Track.add 는 버퍼를 읽기만 하므로 공유해도 안전)

def memo(fn):
    cache: dict = {}

    def wrapped(*args, **kwargs):
        key = (args, tuple(sorted(kwargs.items())))
        if key not in cache:
            cache[key] = fn(*args, **kwargs)
        return cache[key]

    return wrapped


@memo
def v_pad(note: str, dur: float, cutoff=1400.0, detune=7.0, kind='saw') -> np.ndarray:
    n = int(dur * SR)
    body = np.zeros(n)
    for c in (-detune, 0.0, detune, detune * 2.3):
        body += osc(kind, hz(note, c), n)
    body /= 4.0
    body = lowpass(body, cutoff)
    return body * adsr(n, min(0.35, dur * 0.18), 0.22, 0.78, min(0.85, dur * 0.28))


@memo
def v_bass(note: str, dur: float, cutoff=650.0, punch=0.55) -> np.ndarray:
    n = int(dur * SR)
    x = osc('pulse', hz(note), n, duty=0.38) * 0.55 + osc('tri', hz(note, -1200 + 1200), n) * 0.65
    sub = osc('sine', hz(note) / 2, n) * 0.5
    env = adsr(n, 0.004, 0.10, punch, min(0.12, dur * 0.5))
    return lowpass((x + sub) * env, cutoff)


@memo
def v_lead(note: str, dur: float, duty=0.36, cutoff=4200.0, vib=5.4) -> np.ndarray:
    n = int(dur * SR)
    x = osc('pulse', hz(note), n, duty=duty, vib_hz=vib, vib_cents=14)
    x += 0.35 * osc('pulse', hz(note, 5), n, duty=0.5)
    env = adsr(n, 0.012, 0.16, 0.55, min(0.28, dur * 0.55))
    return lowpass(x * env, cutoff) * 0.5


@memo
def v_bell(note: str, dur: float) -> np.ndarray:
    """유리질 종 — 사인 3배음 (신비로운 타이틀 장식)."""
    n = int(dur * SR)
    f = hz(note)
    x = (np.sin(_phase(f, n)) * 1.0
         + 0.45 * np.sin(_phase(f * 2.01, n))
         + 0.22 * np.sin(_phase(f * 3.98, n))
         + 0.12 * np.sin(_phase(f * 5.4, n)))
    return x * adsr(n, 0.004, dur * 0.9, 0.0, dur * 0.09) * 0.4


@memo
def v_pluck(note: str, dur: float, damp=0.494, bright=0.5) -> np.ndarray:
    """Karplus-Strong 뜯는 현 — 마을의 따뜻한 질감."""
    n = int(dur * SR)
    p = max(2, int(SR / hz(note)))
    rng = np.random.default_rng(midi(note) * 7919)
    buf = rng.uniform(-1, 1, p)
    buf = buf * (1 - bright) + np.convolve(buf, np.ones(3) / 3, mode='same') * bright
    out = np.zeros(n)
    idx = 0
    prev = 0.0
    for i in range(n):
        cur = buf[idx]
        out[i] = cur
        buf[idx] = (cur + prev) * damp
        prev = cur
        idx = (idx + 1) % p
    env = np.minimum(1.0, np.linspace(1.0, 0.0, n) * 1.6 + 0.02)
    return out * env * 0.55


@memo
def d_kick(dur=0.34, f0=132.0, f1=44.0) -> np.ndarray:
    n = int(dur * SR)
    body = np.sin(_phase(f0, n, glide_to=f1)) * adsr(n, 0.001, 0.10, 0.28, dur * 0.5)
    click = highpass(np.random.default_rng(3).uniform(-1, 1, n), 2400) * adsr(n, 0.0005, 0.012, 0.0, 0.004)
    return body * 0.95 + click * 0.25


@memo
def d_snare(dur=0.26) -> np.ndarray:
    n = int(dur * SR)
    rng = np.random.default_rng(11)
    noise = rng.uniform(-1, 1, n)
    body = highpass(lowpass(noise, 5200), 700) * adsr(n, 0.001, 0.09, 0.14, dur * 0.4)
    tone = np.sin(_phase(196.0, n, glide_to=150.0)) * adsr(n, 0.001, 0.05, 0.0, 0.02)
    return body * 0.8 + tone * 0.35


@memo
def d_hat(dur=0.06, open_=False) -> np.ndarray:
    n = int(dur * SR)
    rng = np.random.default_rng(17)
    x = highpass(rng.uniform(-1, 1, n), 7000)
    return x * adsr(n, 0.0005, dur * (0.8 if open_ else 0.35), 0.0, dur * 0.15) * 0.5


@memo
def d_shaker(dur=0.09) -> np.ndarray:
    n = int(dur * SR)
    rng = np.random.default_rng(23)
    x = highpass(rng.uniform(-1, 1, n), 4200)
    return x * adsr(n, 0.008, dur * 0.5, 0.0, dur * 0.3) * 0.32


@memo
def d_taiko(dur=0.5, f0=98.0) -> np.ndarray:
    n = int(dur * SR)
    x = np.sin(_phase(f0, n, glide_to=f0 * 0.7)) + 0.4 * np.sin(_phase(f0 * 1.6, n, glide_to=f0 * 1.1))
    noise = lowpass(np.random.default_rng(29).uniform(-1, 1, n), 900)
    return (x * adsr(n, 0.002, 0.16, 0.2, dur * 0.5) + noise * adsr(n, 0.001, 0.04, 0.0, 0.02) * 0.5) * 0.8


# ── 곡 구성 ──────────────────────────────────────────────────────
# 코드: (베이스음, [보이싱], 아르페지오 음계)
CH = {
    'Am': ('A1', ['A2', 'C3', 'E3', 'A3'], ['A3', 'C4', 'E4', 'A4']),
    'F':  ('F1', ['F2', 'A2', 'C3', 'F3'], ['F3', 'A3', 'C4', 'F4']),
    'C':  ('C2', ['C3', 'E3', 'G3', 'C4'], ['C4', 'E4', 'G4', 'C5']),
    'G':  ('G1', ['G2', 'B2', 'D3', 'G3'], ['G3', 'B3', 'D4', 'G4']),
    'Dm': ('D2', ['D3', 'F3', 'A3', 'D4'], ['D4', 'F4', 'A4', 'D5']),
    'E':  ('E1', ['E2', 'G#2', 'B2', 'E3'], ['E3', 'G#3', 'B3', 'E4']),
}


def make_title() -> np.ndarray:
    bpm, bars = 76.0, 16
    beat = 60.0 / bpm
    bar = beat * 4
    tr = Track(bars * bar)
    prog = ['Am', 'F', 'C', 'G']

    for b in range(bars):
        t0 = b * bar
        name = prog[b % 4]
        root, voicing, arp = CH[name]
        # 패드 — 한 마디를 꽉 채운 현
        for i, note in enumerate(voicing):
            tr.add(t0, v_pad(note, bar * 1.25, cutoff=900 + i * 220, detune=6), gain=0.20, verb=0.55)
        # 저음 지속 (화로의 낮은 울림)
        tr.add(t0, v_pad(root, bar * 1.25, cutoff=380, detune=3, kind='tri'), gain=0.30, verb=0.2)
        # 아르페지오 — 8분음표 상행/하행 (매 마디 방향 교대)
        seq = arp + arp[::-1][1:3]
        if b % 2 == 1:
            seq = seq[::-1]
        for i in range(8):
            note = seq[i % len(seq)]
            tr.add(t0 + i * beat * 0.5, v_bell(note, beat * 1.6),
                   gain=0.34 if i % 2 == 0 else 0.22, echo=0.5, verb=0.45)
        # 4마디마다 종 한 방 (먼 정련소의 신호)
        if b % 4 == 0:
            tr.add(t0, v_bell(['A4', 'C5', 'E5', 'D5'][(b // 4) % 4], bar * 1.4), gain=0.30, echo=0.6, verb=0.7)

    # 리드 멜로디 (후반 8마디에서 등장 — 곡이 자란다)
    mel = [
        ('E4', 2), ('D4', 1), ('C4', 1), ('A3', 4),
        ('C4', 2), ('E4', 1), ('F4', 1), ('E4', 4),
        ('G4', 2), ('E4', 1), ('D4', 1), ('C4', 4),
        ('D4', 2), ('E4', 2), ('A3', 4),
    ]
    t = 8 * bar
    for note, beats in mel:
        tr.add(t, v_lead(note, beats * beat * 0.92, duty=0.28, cutoff=2600, vib=4.6),
               gain=0.30, echo=0.45, verb=0.5)
        t += beats * beat
    return tr.mix(echo_ms=beat * 750, echo_fb=0.36, verb_amount=0.7)


# ── 전투 트랙 공통 상수 ──────────────────────────────────────────
# base 와 긴장도 레이어가 **반드시** 같은 값을 써야 한다 (길이·루프 경계 일치).
BATTLE_BPM = 132.0
BATTLE_BARS = 24
BATTLE_PROG = ['Am', 'F', 'C', 'G']
# 레이어 출력 게인 — 정규화된 레이어를 base 아래로 앉힌다 (write_wav norm=False 와 짝)
LAYER_GAIN = {'battle-layer1': 0.62, 'battle-layer2': 0.52}


def make_battle() -> np.ndarray:
    bpm, bars = BATTLE_BPM, BATTLE_BARS
    beat = 60.0 / bpm
    bar = beat * 4
    tr = Track(bars * bar)
    prog = ['Am', 'F', 'C', 'G']
    riff = [0, 0, 3, 0, 5, 0, 3, 2]  # 반음 오프셋 (베이스 리프)

    for b in range(bars):
        t0 = b * bar
        name = prog[b % 4]
        root, voicing, arp = CH[name]
        rootf = hz(root)
        # 8분 베이스 리프
        for i in range(8):
            semis = riff[i] if i % 2 == 0 else 0
            f = rootf * 2 ** (semis / 12.0)
            n = int(beat * 0.46 * SR)
            x = osc('pulse', f, n, duty=0.4) * 0.6 + osc('sine', f / 2, n) * 0.6
            tr.add(t0 + i * beat * 0.5, lowpass(x * adsr(n, 0.003, 0.07, 0.5, 0.05), 720), gain=0.42)
        # 패드 (코드 지속 — 얇게)
        for note in voicing[1:]:
            tr.add(t0, v_pad(note, bar * 1.25, cutoff=1500, detune=9), gain=0.12, verb=0.4)
        # 리드: 4분 아르페지오 + 마디 끝 상행
        if b >= 4:
            pattern = [arp[0], arp[2], arp[1], arp[3], arp[2], arp[1], arp[3], arp[2]]
            for i, note in enumerate(pattern):
                if i % 2 == 1 and b % 2 == 0:
                    continue
                tr.add(t0 + i * beat * 0.5, v_lead(note, beat * 0.62, duty=0.32, cutoff=5200),
                       gain=0.30, echo=0.35, verb=0.25)
        # 드럼: 킥 1·3(+ 8분 업), 스네어 2·4, 하이햇 8분
        for i in (0, 2):
            tr.add(t0 + i * beat, d_kick(), gain=0.85)
        tr.add(t0 + 2.75 * beat, d_kick(dur=0.26), gain=0.5)
        for i in (1, 3):
            tr.add(t0 + i * beat, d_snare(), gain=0.55, verb=0.25)
        for i in range(8):
            tr.add(t0 + i * beat * 0.5, d_hat(open_=(i == 7)), gain=0.30 if i % 2 == 0 else 0.18)
        # 4마디 끝 필 (스네어 16분 3연타)
        if b % 4 == 3:
            for i in range(3):
                tr.add(t0 + 3 * beat + i * beat * 0.25, d_snare(dur=0.18), gain=0.45 + i * 0.1)
    return tr.mix(echo_ms=beat * 500, echo_fb=0.3, verb_amount=0.35)


def make_battle_layer1() -> np.ndarray:
    """전투 강화 레이어 1 — 퍼커션 증강.

    base 의 8분 하이햇 **사이**(엇박 16분)를 메우고, 고스트 스네어와 뒷박 킥으로
    체감 템포를 끌어올린다. 화성은 건드리지 않는다 — 겹쳐도 절대 부딪히지 않게.
    """
    bpm, bars = BATTLE_BPM, BATTLE_BARS
    beat = 60.0 / bpm
    bar = beat * 4
    tr = Track(bars * bar)

    for b in range(bars):
        t0 = b * bar
        # 엇박 16분 하이햇 — base 는 8분(0, 0.5, 1.0 …)이므로 0.25 격자만 채운다
        for i in range(16):
            if i % 2 == 0:
                continue
            tr.add(t0 + i * beat * 0.25, d_hat(dur=0.04), gain=0.26 if i % 4 == 1 else 0.18)
        # 라이드 액센트 (매 박 앞머리, 열린 하이햇)
        for i in range(4):
            tr.add(t0 + i * beat, d_hat(dur=0.13, open_=True), gain=0.20 if i % 2 == 0 else 0.13)
        # 고스트 스네어 — 2·4박 직전 16분
        for i in (0.75, 2.75, 3.5):
            tr.add(t0 + i * beat, d_snare(dur=0.14), gain=0.22, verb=0.18)
        # 뒷박 킥 (base 의 1·3박 킥 사이를 메운다)
        for i in (1.5, 3.5):
            tr.add(t0 + i * beat, d_kick(dur=0.22, f0=124.0), gain=0.42)
        # 2마디마다 타이코 액센트 — 밀도가 올라간 걸 몸으로 알린다
        if b % 2 == 0:
            tr.add(t0, d_taiko(dur=0.42, f0=104.0), gain=0.44, verb=0.28)
        # 4마디 끝: 16분 스네어 롤 (base 필 위에 겹친다)
        if b % 4 == 3:
            for i in range(6):
                tr.add(t0 + 3.5 * beat + i * beat * 0.125, d_snare(dur=0.13),
                       gain=0.20 + i * 0.045)
    return tr.mix(echo_ms=beat * 500, echo_fb=0.24, verb_amount=0.3)


def make_battle_layer2() -> np.ndarray:
    """전투 강화 레이어 2 — 리드 증강.

    base 리드의 옥타브 위를 겹쳐 선율을 앞으로 끌어내고, 코드 파워 스탭과
    후반부 대선율을 얹는다. base 와 같은 진행(Am–F–C–G)이라 항상 협화한다.
    """
    bpm, bars = BATTLE_BPM, BATTLE_BARS
    beat = 60.0 / bpm
    bar = beat * 4
    tr = Track(bars * bar)

    def up_octave(note: str) -> str:
        return f'{note[:-1]}{int(note[-1]) + 1}'

    for b in range(bars):
        t0 = b * bar
        name = BATTLE_PROG[b % 4]
        _root, voicing, arp = CH[name]
        # 옥타브 위 리드 — base 는 b>=4 부터 등장하고 짝수 마디에 음을 솎는다.
        # 레이어는 **솎지 않고** 전부 채워 밀도를 올린다.
        pattern = [arp[0], arp[2], arp[1], arp[3], arp[2], arp[1], arp[3], arp[2]]
        for i, note in enumerate(pattern):
            tr.add(t0 + i * beat * 0.5,
                   v_lead(up_octave(note), beat * 0.5, duty=0.26, cutoff=6400, vib=5.0),
                   gain=0.24 if i % 2 == 0 else 0.16, echo=0.32, verb=0.28)
        # 파워 스탭 — 1·3박에 짧게 끊는 코드 (톱니 패드의 짧은 어택)
        for i in (0, 2):
            for note in voicing[1:3]:
                tr.add(t0 + i * beat, v_pad(note, beat * 0.42, cutoff=2600, detune=11),
                       gain=0.20, verb=0.22)
        # 후반 12마디: 긴 대선율 (2마디 주기) — 곡이 위로 열린다
        if b >= 12:
            line = {0: [('A4', 2), ('C5', 2)], 1: [('E5', 3), ('D5', 1)],
                    2: [('C5', 2), ('G4', 2)], 3: [('A4', 4)]}[b % 4]
            t = t0
            for note, beats in line:
                tr.add(t, v_lead(note, beats * beat * 0.86, duty=0.44, cutoff=3400, vib=4.4),
                       gain=0.22, echo=0.4, verb=0.42)
                t += beats * beat
    return tr.mix(echo_ms=beat * 500, echo_fb=0.3, verb_amount=0.4)


def make_boss() -> np.ndarray:
    bpm, bars = 152.0, 32
    beat = 60.0 / bpm
    bar = beat * 4
    tr = Track(bars * bar)
    prog = ['Am', 'F', 'Dm', 'E']  # 화성 단조 V(E) — 긴박한 해결
    for b in range(bars):
        t0 = b * bar
        name = prog[b % 4]
        root, voicing, arp = CH[name]
        rootf = hz(root)
        # 16분 페달 베이스 (질주)
        for i in range(16):
            f = rootf * (2.0 if i in (7, 15) else 1.0)
            n = int(beat * 0.22 * SR)
            x = osc('saw', f, n) * 0.5 + osc('sine', f / 2, n) * 0.7
            tr.add(t0 + i * beat * 0.25, lowpass(x * adsr(n, 0.002, 0.05, 0.3, 0.03), 820), gain=0.34)
        # 어두운 오르간 패드
        for note in voicing:
            tr.add(t0, v_pad(note, bar * 1.25, cutoff=1100, detune=12, kind='saw'), gain=0.13, verb=0.5)
        # 위협 모티프 (2마디 주기의 짧은 상행 + 하행)
        motif = [arp[0], arp[1], arp[2], arp[3], arp[2], arp[1]]
        for i, note in enumerate(motif):
            tr.add(t0 + i * beat * 0.5, v_lead(note, beat * 0.42, duty=0.22, cutoff=6200, vib=6.5),
                   gain=0.26, echo=0.3, verb=0.3)
        # 타이코 + 킥/스네어 (더블타임 느낌)
        tr.add(t0, d_taiko(), gain=0.6, verb=0.3)
        for i in (0, 1, 2, 3):
            tr.add(t0 + i * beat, d_kick(dur=0.28), gain=0.7)
            tr.add(t0 + i * beat + beat * 0.5, d_kick(dur=0.2), gain=0.32)
        for i in (1, 3):
            tr.add(t0 + i * beat, d_snare(), gain=0.6, verb=0.3)
        for i in range(16):
            tr.add(t0 + i * beat * 0.25, d_hat(dur=0.045), gain=0.22 if i % 4 == 0 else 0.12)
        # 8마디마다 타이코 롤 (다음 국면 예고)
        if b % 8 == 7:
            for i in range(8):
                tr.add(t0 + 3 * beat + i * beat * 0.125, d_taiko(dur=0.22, f0=110 + i * 4),
                       gain=0.25 + i * 0.045)
    return tr.mix(echo_ms=beat * 375, echo_fb=0.28, verb_amount=0.4)


def make_village() -> np.ndarray:
    bpm, bars = 92.0, 16
    beat = 60.0 / bpm
    bar = beat * 4
    tr = Track(bars * bar)
    prog = ['Am', 'F', 'C', 'G']
    for b in range(bars):
        t0 = b * bar
        name = prog[b % 4]
        root, voicing, arp = CH[name]
        # 따뜻한 패드 (부드러운 저역)
        for note in voicing[:3]:
            tr.add(t0, v_pad(note, bar * 1.25, cutoff=760, detune=5, kind='tri'), gain=0.20, verb=0.5)
        tr.add(t0, v_pad(root, bar * 1.25, cutoff=300, detune=2, kind='tri'), gain=0.26, verb=0.2)
        # 뜯는 현 아르페지오 (모닥불 옆 류트)
        pattern = [arp[0], arp[2], arp[1], arp[3], arp[2], arp[1]]
        for i, note in enumerate(pattern):
            tr.add(t0 + i * beat * 0.66, v_pluck(note, beat * 1.3), gain=0.42, echo=0.3, verb=0.4)
        # 낮은 뜯는 베이스 (1·3박)
        for i in (0, 2):
            tr.add(t0 + i * beat, v_bass(root, beat * 0.9, cutoff=420, punch=0.35), gain=0.34)
        # 셰이커 (8분, 강약)
        for i in range(8):
            tr.add(t0 + i * beat * 0.5, d_shaker(), gain=0.24 if i % 2 == 0 else 0.12)
        # 4마디마다 종 (에다의 화로)
        if b % 4 == 2:
            tr.add(t0 + beat * 2, v_bell(['A4', 'C5'][(b // 4) % 2], bar), gain=0.22, echo=0.4, verb=0.6)
        # 후반부 휘파람 멜로디
        if b >= 8:
            mel = {0: [('E4', 2), ('C4', 2)], 1: [('D4', 2), ('A3', 2)],
                   2: [('C4', 2), ('E4', 2)], 3: [('D4', 4)]}[b % 4]
            t = t0
            for note, beats in mel:
                tr.add(t, v_lead(note, beats * beat * 0.8, duty=0.5, cutoff=2000, vib=4.0),
                       gain=0.22, echo=0.4, verb=0.5)
                t += beats * beat
    return tr.mix(echo_ms=beat * 750, echo_fb=0.32, verb_amount=0.6)


# ── 정보 전달음 (SFX) ────────────────────────────────────────────

def make_lowhp() -> np.ndarray:
    """저체력 경고 — 낮게 깔리는 2연 경보 + 심장 박동 2회."""
    dur = 1.30
    n = int(dur * SR)
    out = np.zeros(n)
    # 경보음: 620Hz → 470Hz 로 떨어지는 2연타 (톱니 섞인 경적)
    for k, t0 in enumerate((0.0, 0.30)):
        ln = int(0.24 * SR)
        f = 640 - k * 90
        x = (osc('pulse', f, ln, duty=0.45, glide_to=f * 0.78) * 0.6
             + osc('sine', f * 2, ln) * 0.25)
        x = lowpass(x, 2600) * adsr(ln, 0.006, 0.06, 0.6, 0.08)
        i = int(t0 * SR)
        out[i:i + ln] += x * 0.55
    # 심장 박동 (두-둥 × 2)
    for t0 in (0.62, 0.80, 1.00, 1.18):
        ln = int(0.16 * SR)
        thump = np.sin(_phase(74, ln, glide_to=48)) * adsr(ln, 0.002, 0.07, 0.15, 0.05)
        i = int(t0 * SR)
        end = min(n, i + ln)
        out[i:end] += thump[:end - i] * (0.75 if t0 in (0.62, 1.00) else 0.5)
    return reverb(out, 0.18)


def make_telegraph() -> np.ndarray:
    """보스 즉살기 전조음 — 충전되는 금속 상승음 + 조준 확정 클릭."""
    dur = 1.15
    n = int(dur * SR)
    charge_n = int(0.86 * SR)
    t = np.arange(charge_n) / SR
    ramp = (t / t[-1]) ** 1.6
    # 상승 톱니 3중 (200Hz → 1500Hz), 금속 링 모듈레이션
    x = np.zeros(charge_n)
    for det, g in ((0.0, 1.0), (7.0, 0.6), (-11.0, 0.5)):
        f0, f1 = 200 * 2 ** (det / 1200), 1500 * 2 ** (det / 1200)
        x += g * osc('saw', f0, charge_n, glide_to=f1)
    x /= 2.1
    x *= 1 + 0.35 * np.sin(2 * math.pi * (14 + 46 * ramp) * t)   # 떨림이 빨라진다
    # 시변 컷오프는 두 대역을 램프로 섞어 근사한다 (닫힌 → 열린 필터)
    dark = lowpass(x, 900)
    bright = lowpass(x, 6100)
    x = highpass(dark * (1 - ramp) + bright * ramp, 180)
    x *= np.clip(ramp * 1.25, 0, 1) * 0.55
    out = np.zeros(n)
    out[:charge_n] += x
    # 조준 확정: 짧은 금속 클릭 + 낮은 임팩트
    ci = charge_n
    cl = n - ci
    click = highpass(np.random.default_rng(5).uniform(-1, 1, cl), 3800) * adsr(cl, 0.0008, 0.03, 0.0, 0.02)
    ring = (np.sin(_phase(1860, cl)) * 0.5 + np.sin(_phase(2790, cl)) * 0.3) * adsr(cl, 0.001, 0.14, 0.0, 0.06)
    low = np.sin(_phase(120, cl, glide_to=64)) * adsr(cl, 0.002, 0.10, 0.0, 0.05)
    out[ci:] += click * 0.5 + ring * 0.35 + low * 0.5
    return reverb(out, 0.22)


# ── 출력 ─────────────────────────────────────────────────────────

def write_wav(path: str, data: np.ndarray, rate: int, norm: bool = True) -> None:
    """norm=False 면 피크 정규화를 하지 않는다 — 긴장도 레이어처럼 **base 대비
    상대 음량이 의미를 갖는** 파일에 쓴다 (정규화하면 성긴 레이어가 base 만큼 커진다)."""
    peak = (float(np.max(np.abs(data))) or 1.0) if norm else 1.0
    pcm = np.clip(data / peak * (0.92 if norm else 1.0), -1, 1)
    pcm16 = (pcm * 32767).astype('<i2')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm16.tobytes())


def resample(x: np.ndarray, src: int, dst: int) -> np.ndarray:
    if src == dst:
        return x
    n = int(len(x) * dst / src)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)


def encode_ogg(wav_path: str, ogg_path: str, quality: str = '3') -> bool:
    if not shutil.which('ffmpeg'):
        return False
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-i', wav_path,
           '-c:a', 'libvorbis', '-q:a', quality, '-ar', str(SR), ogg_path]
    return subprocess.run(cmd, check=False).returncode == 0


def encode_m4a(wav_path: str, m4a_path: str, bitrate: str = '64k') -> bool:
    if not shutil.which('ffmpeg'):
        return False
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-i', wav_path,
           '-c:a', 'aac', '-b:a', bitrate, '-ar', str(SFX_SR), '-ac', '1',
           '-movflags', '+faststart', m4a_path]
    return subprocess.run(cmd, check=False).returncode == 0


def main() -> int:
    os.makedirs(BGM_DIR, exist_ok=True)
    tracks = {
        'title': make_title,
        'battle': make_battle,
        'battle-layer1': make_battle_layer1,
        'battle-layer2': make_battle_layer2,
        'boss': make_boss,
        'village': make_village,
    }
    only = sys.argv[1:] or list(tracks)
    lengths: dict[str, int] = {}
    for name in only:
        if name not in tracks:
            continue
        print(f'  ♪ {name} 합성 중...', flush=True)
        data = tracks[name]()
        gain = LAYER_GAIN.get(name)
        if gain is not None:
            data = data * gain
        lengths[name] = len(data)
        # 중간 wav 는 임시 디렉터리에 (public/ 에 찌꺼기를 남기지 않는다)
        tmp_wav = os.path.join(tempfile.gettempdir(), f'lodeland-bgm-{name}.wav')
        write_wav(tmp_wav, data, SR, norm=gain is None)
        ogg = os.path.join(BGM_DIR, f'{name}.ogg')
        if encode_ogg(tmp_wav, ogg):
            size = os.path.getsize(ogg)
            print(f'    → {name}.ogg  {len(data)/SR:5.1f}s  {size/1024:6.1f} KB')
        else:
            print(f'    ! ffmpeg 없음 — {name}.ogg 생략 (wav 만 남는다)')

        # 폴백 m4a(AAC 64k · 22050Hz 모노)를 **항상** 함께 쓴다 (2026-09-07, wav 에서 교체).
        #   · ogg 를 못 읽는 브라우저(Safari)는 Phaser 가 포맷 협상으로 이쪽을 고른다
        #   · ogg 가 404/손상이면 main.ts 의 FILE_LOAD_ERROR 폴백이 이 파일을 다시 건다
        # 왜 wav 를 버렸나: wav 6개 = 11MB 로 배포본 20MB 의 절반이었고, 링크 유입자의
        # 첫 로딩을 그만큼 늦췄다. m4a 는 트랙당 ~400KB. 대가는 AAC 인코더 패딩 탓에
        # 폴백 경로에서만 루프 이음매에 아주 짧은 틈이 생길 수 있다는 것 — 주 경로(ogg)는 무관.
        tmp_fb = os.path.join(tempfile.gettempdir(), f'lodeland-bgm-{name}-22k.wav')
        write_wav(tmp_fb, resample(data, SR, SFX_SR), SFX_SR, norm=gain is None)
        fallback = os.path.join(BGM_DIR, f'{name}.m4a')
        if encode_m4a(tmp_fb, fallback):
            fallback_kb = os.path.getsize(fallback) / 1024
            print(f'    → {name}.m4a (폴백)  {fallback_kb:7.1f} KB')
        else:
            print(f'    ! ffmpeg 없음 — {name}.m4a 생략 (폴백 없음)')

    # 레이어링의 생명은 길이 일치다 — base 와 1샘플이라도 다르면 루프마다 어긋난다
    base_len = lengths.get('battle')
    for layer in ('battle-layer1', 'battle-layer2'):
        if base_len is not None and layer in lengths:
            same = lengths[layer] == base_len
            print(f'    · 루프 정합 {layer}: {lengths[layer]} vs battle {base_len} '
                  f'{"OK" if same else "⚠ 불일치"}')
            assert same, f'{layer} 길이가 battle 과 다르다 — 레이어 싱크가 깨진다'

    for name, fn in (('lowhp', make_lowhp), ('telegraph', make_telegraph)):
        data = resample(fn(), SR, SFX_SR)
        path = os.path.join(SFX_DIR, f'{name}.wav')
        write_wav(path, data, SFX_SR)
        print(f'  ♪ {name}.wav  {len(data)/SFX_SR:.2f}s  {os.path.getsize(path)/1024:.1f} KB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
