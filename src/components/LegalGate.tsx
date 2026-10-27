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
  if (!user?.legalPending || !token) return null;
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
