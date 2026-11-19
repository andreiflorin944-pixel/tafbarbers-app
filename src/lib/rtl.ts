import { I18nManager } from 'react-native';

type DirIcon = 'chevron-back' | 'chevron-forward' | 'arrow-back' | 'arrow-forward';
const MIRROR: Record<DirIcon, DirIcon> = {
  'chevron-back': 'chevron-forward',
  'chevron-forward': 'chevron-back',
  'arrow-back': 'arrow-forward',
  'arrow-forward': 'arrow-back',
};

/** Săgețile „înainte / înapoi” arată invers în arabă (de la dreapta la stânga). */
export const dirIcon = (name: DirIcon): DirIcon => (I18nManager.isRTL ? MIRROR[name] : name);
