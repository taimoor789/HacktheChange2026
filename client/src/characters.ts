/**
 * Playable characters.
 *
 * Characters with `art: true` use the drawn sprites in
 * /assets/characters/<id>/:
 *   idle-left.gif  idle-right.gif   animated idle, facing left / right
 *   still-left.png still-right.png  single frame (portraits)
 *   attack-right.gif                one attack, 720x576 (the idle frame plus 120px each side);
 *                                   mirrored in CSS for the left-facing player (see match/attacks.ts)
 * All art shares one 480x576 frame (see ART_FRAME). Characters without art
 * use a generated pixel placeholder from the grid below.
 */
export interface Character {
  id: string;
  name: string;
  /** Has drawn art in /assets/characters/<id>/. */
  art?: boolean;
  /** Has attack-right.gif in /assets/characters/<id>/. */
  attack?: boolean;
  palette: { hair: string; skin: string; shirt: string; pants: string; boots: string };
  /** Optional replacement for the top (hair) rows of the placeholder grid. */
  hair?: string[];
}

/**
 * The shared canvas every drawn sprite sits in, measured from the files:
 * the body runs from y=66 to the feet at y=520 of a 480x576 frame.
 */
export const ART_FRAME = { w: 480, h: 576, top: 66, feet: 520 };
/*
 * The body isn't centred in that frame: it sits at x≈225 in left-facing files
 * and x≈253 in right-facing ones (measured on all four characters). The CSS
 * shifts each image by --shift so the body itself is centred
 * (see .sprite--face-left / .sprite--face-right).
 */

export const CHARACTERS: Character[] = [
  {
    id: 'glitch',
    name: 'GLITCH',
    art: true,
    attack: true,
    palette: { hair: '#d877e6', skin: '#f1c9a5', shirt: '#2fd39a', pants: '#3b2a4a', boots: '#111' },
    hair: ['...HHHHHH...', '..HHHHHHHH..', '..HHSSSSHH..'],
  },
  {
    id: 'null',
    name: 'NULL',
    art: true,
    attack: true,
    palette: { hair: '#e8e2d8', skin: '#b07850', shirt: '#79c4e8', pants: '#1f2a36', boots: '#111' },
    hair: ['............', '....HHHH....', '...HSSSSH...'],
  },
  {
    id: 'bram',
    name: 'BRAM',
    art: true,
    attack: true,
    palette: { hair: '#5a3a24', skin: '#c58a5e', shirt: '#7a3e2a', pants: '#3e3846', boots: '#6a3a22' },
  },
  {
    id: 'skye',
    name: 'SKYE',
    art: true,
    attack: true,
    palette: { hair: '#e0a94e', skin: '#f3d2b3', shirt: '#b48ad6', pants: '#8f6fb0', boots: '#2a2030' },
  },

];

/* 12 x 15 placeholder body. H hair, S skin, E eye, M mouth, T shirt, P pants, B boots */
const BODY = [
  '....HHHH....',
  '...HHHHHH...',
  '...HSSSSH...',
  '...SESSES...',
  '...SSSSSS...',
  '....SMMS....',
  '...TTTTTT...',
  '..TTTTTTTT..',
  '.STTTTTTTTS.',
  '.S.TTTTTT.S.',
  '...TTTTTT...',
  '...PPPPPP...',
  '...PP..PP...',
  '...PP..PP...',
  '..BBB..BBB..',
];

export type Facing = 'left' | 'right';

/**
 * Markup for a character.
 * @param facing which way they look (drawn art only; placeholders face front)
 * @param pose   'idle' = animated GIF, 'still' = single frame
 */
export function characterSprite(c: Character, facing: Facing = 'right', pose: 'idle' | 'still' = 'idle') {
  if (c.art) {
    const src = `/assets/characters/${c.id}/${pose}-${facing}.${pose === 'idle' ? 'gif' : 'png'}`;
    return `<img class="sprite sprite--art sprite--face-${facing}" src="${src}" alt="${c.name}" draggable="false" />`;
  }
  const rows = [...(c.hair ?? BODY.slice(0, 3)), ...BODY.slice(3)];
  const colors: Record<string, string> = {
    H: c.palette.hair,
    S: c.palette.skin,
    E: '#111',
    M: '#8a4b3a',
    T: c.palette.shirt,
    P: c.palette.pants,
    B: c.palette.boots,
  };
  let rects = '';
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (colors[ch]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${colors[ch]}"/>`;
    }),
  );
  return `<svg class="sprite sprite--pixel" viewBox="0 0 12 15" shape-rendering="crispEdges" role="img" aria-label="${c.name}">${rects}</svg>`;
}

/** Preload a character's images so they're ready before a page is shown. */
export function preloadCharacter(c: Character, facings: Facing[] = ['left', 'right']) {
  if (!c.art) return Promise.resolve();
  const srcs = facings.flatMap((f) => [
    `/assets/characters/${c.id}/idle-${f}.gif`,
    `/assets/characters/${c.id}/still-${f}.png`,
  ]);
  return Promise.all(
    srcs.map(
      (src) =>
        new Promise<void>((r) => {
          const img = new Image();
          img.onload = img.onerror = () => r();
          img.src = src;
        }),
    ),
  ).then(() => undefined);
}

export function findCharacter(id: string) {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}
