import { create } from 'zustand';

interface NavigationGuardState {
  blocked: boolean;
  setBlocked: (blocked: boolean) => void;
}

export const useNavigationGuardStore = create<NavigationGuardState>((set) => ({
  blocked: false,
  setBlocked: (blocked) => set({ blocked }),
}));
