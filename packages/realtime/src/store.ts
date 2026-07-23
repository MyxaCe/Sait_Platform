import { create } from 'zustand';
import { createInitialQuotes } from './data';
import type { ConnStatus, Quote } from './types';

interface QuotesState {
  status: ConnStatus;
  quotes: Record<string, Quote>;
  setStatus: (status: ConnStatus) => void;
  applyBatch: (batch: Quote[]) => void;
}

export const useQuotesStore = create<QuotesState>()((set) => ({
  status: 'connecting',
  quotes: createInitialQuotes(),
  setStatus: (status) => set({ status }),
  applyBatch: (batch) =>
    set((state) => {
      const quotes = { ...state.quotes };
      for (const q of batch) quotes[q.symbol] = q;
      return { quotes };
    }),
}));
