// OWNER B: client store holding match state (Zustand).
// Responsible for: single source of truth the screens read; updated from server events.
// TODO(OWNER B): subscribe to socket events and update state; add review + profile slices.
import { create } from 'zustand';
import type { MatchEndPayload, MatchState, PublicQuestion } from '@beatcode/shared';

interface GameStore {
  match: MatchState | null;
  question: PublicQuestion | null;
  deadline: number | null;
  review: MatchEndPayload | null;
  setMatch: (m: MatchState | null) => void;
  setQuestion: (q: PublicQuestion | null, deadline: number | null) => void;
  setReview: (r: MatchEndPayload | null) => void;
  reset: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  match: null,
  question: null,
  deadline: null,
  review: null,
  setMatch: (match) => set({ match }),
  setQuestion: (question, deadline) => set({ question, deadline }),
  setReview: (review) => set({ review }),
  reset: () => set({ match: null, question: null, deadline: null, review: null }),
}));
