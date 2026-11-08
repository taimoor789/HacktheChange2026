/**
 * Battle sound: the background loop and one attack sound per hit.
 *
 * Files: /assets/audio/battle/battle-loop.{ogg,m4a} and /assets/audio/attacks/<id>_0N_<name>.wav
 * (battle_audio_pack). Every attack sound is 1.28 s like the attack GIF, with contact at 0.61 s,
 * so it starts together with the GIF. The four variants per character map to the hit size.
 */
import type { AttackSize } from '@beatcode/shared';
import { Music } from '../music';

const VARIANTS: Record<string, readonly [string, string, string, string]> = {
  bram: ['heavy_punch', 'rising_uppercut', 'shock_fist', 'rapid_barrage'],
  null: ['wind_palm', 'chakra_burst', 'shadow_snap', 'spiral_strike'],
  glitch: ['digital_zap', 'phase_slash', 'void_pulse', 'error_burst'],
  skye: ['snap_kick', 'double_kick', 'spinning_kick', 'aerial_strike'],
};

/** Bigger hit, bigger sound: light -> variant 1 ... ultimate -> variant 4. */
const VARIANT_BY_SIZE: Record<AttackSize, number> = { light: 0, medium: 1, heavy: 2, ultimate: 3 };

const MUSIC_VOLUME = 0.25; // pack README: keep the loop well under the attacks
const ATTACK_VOLUME = 0.9;
/** Mono effects are panned toward the attacker's side of the screen. */
const PAN = 0.35;

const attackUrl = (id: string, i: number) => `/assets/audio/attacks/${id}_0${i + 1}_${VARIANTS[id][i]}.wav`;

export const battleMusic = new Music('/assets/audio/battle/battle-loop.ogg', MUSIC_VOLUME, {
  loopSeconds: 30, // 16 bars at 128 BPM, exactly 1,440,000 samples at 48 kHz
  fallbackUrl: '/assets/audio/battle/battle-loop.m4a',
});

let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function audioCtx() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

function load(url: string) {
  let p = buffers.get(url);
  if (!p) {
    const c = audioCtx();
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => c.decodeAudioData(b))
      .catch(() => null);
    buffers.set(url, p);
  }
  return p;
}

/** Load a character's four attack sounds ahead of the first hit. */
export function preloadAttackSounds(characterId: string) {
  if (!VARIANTS[characterId]) return;
  VARIANTS[characterId].forEach((_, i) => void load(attackUrl(characterId, i)));
}

/** Play an attack sound now. `side` is where the attacker stands on this screen. */
export async function playAttackSound(characterId: string, size: AttackSize, side: 'left' | 'right') {
  if (!VARIANTS[characterId]) return;
  const buf = await load(attackUrl(characterId, VARIANT_BY_SIZE[size]));
  if (!buf) return;
  const c = audioCtx();
  const src = c.createBufferSource();
  src.buffer = buf;
  const gain = c.createGain();
  gain.gain.value = ATTACK_VOLUME;
  const pan = c.createStereoPanner();
  pan.pan.value = side === 'left' ? -PAN : PAN;
  src.connect(gain).connect(pan).connect(c.destination);
  src.start();
}
