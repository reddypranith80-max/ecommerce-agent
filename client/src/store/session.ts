import type { PublicUser } from '@shop/shared';
import { create } from 'zustand';

type Status = 'loading' | 'authenticated' | 'guest';

interface SessionState {
  user: PublicUser | null;
  /** Kept in memory only: never written to localStorage, so injected scripts cannot read it from storage. */
  accessToken: string | null;
  status: Status;
  setSession: (user: PublicUser, accessToken: string) => void;
  clear: () => void;
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  accessToken: null,
  status: 'loading',
  setSession: (user, accessToken) => set({ user, accessToken, status: 'authenticated' }),
  clear: () => set({ user: null, accessToken: null, status: 'guest' }),
}));

export const isAdmin = (user: PublicUser | null) => Boolean(user && user.permissions.length > 0);
