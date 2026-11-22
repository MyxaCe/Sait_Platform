import type { MarketsData } from '@/lib/home';

export type NoticeKey =
  | 'marketsClosedEmpty'
  | 'marketsClosedUnavailable'
  | 'marketsCatalog'
  | 'marketsNoMatch'
  | 'marketsNoTabs';

export interface Notice {
  titleKey: `${NoticeKey}Title`;
  textKey: `${NoticeKey}Text`;
  reason?: string;
}

export function describeNotice(data: MarketsData, tabCount: number): Notice | null {
  switch (data.state) {
    case 'access-empty':
      return { titleKey: 'marketsClosedEmptyTitle', textKey: 'marketsClosedEmptyText' };
    case 'access-unavailable':
      return {
        titleKey: 'marketsClosedUnavailableTitle',
        textKey: 'marketsClosedUnavailableText',
        reason: data.reason,
      };
    case 'catalog-unavailable':
      return {
        titleKey: 'marketsCatalogTitle',
        textKey: 'marketsCatalogText',
        reason: data.reason,
      };
    case 'ok':
      if (data.instruments.length === 0) {
        return { titleKey: 'marketsNoMatchTitle', textKey: 'marketsNoMatchText' };
      }
      if (tabCount === 0) {
        return { titleKey: 'marketsNoTabsTitle', textKey: 'marketsNoTabsText' };
      }
      return null;
  }
}
