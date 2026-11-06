import { usePathname } from 'expo-router';
import { api } from '@/api';
import { LegalSign } from '@/components/LegalSign';
import { useT } from '@/i18n';
import { useApp } from '@/state/AppState';

/**
 * Clientul conectat care n-a semnat versiunea de acum a termenilor și a politicii (cont vechi, client adăugat din panou
 * sau documente actualizate) vede întâi documentele de derulat, bifat și semnat. Nu se poate închide: altfel iese din cont.
 */
export function LegalGate() {
  const { user, token, refreshMe, signOut } = useApp();
  const { lang, t } = useT();
  const path = usePathname();
  // Nu peste fereastra de intrare în cont: pe iPhone, o fereastră deschisă peste ea rămâne agățată când intrarea se închide
  // (ecranul se blochează și semnarea nu ajunge la server). Apare imediat după, pe ecranul la care revii.
  const onLogin = path === '/login' || path === '/staff/login';
  if (!user?.legalPending || !token || onLogin) return null;
  return (
    <LegalSign
      visible
      intro={t('sign.introUpdate')}
      closeLabel={t('sign.signOut')}
      onClose={() => void signOut()}
      onSign={async (s) => {
        await api.signLegal(token, { ...s, lang });
        await refreshMe();
      }}
    />
  );
}
