import { useEffect, useState } from 'react';
import { staffApi } from '@/api/staff';
import type { Service } from '@/data/types';
import { useT } from '@/i18n';
import { useApp } from '@/state/AppState';
import { useStaff } from '@/state/Staff';

/** Serviciile pentru ecranele echipei: și cele „doar membri” (catalogul clientului nu le are, dacă clientul nu e membru). */
export function useStaffServices(): Service[] {
  const { services } = useApp();
  const { staffToken } = useStaff();
  const { lang } = useT();
  const [all, setAll] = useState<Service[] | null>(null);
  useEffect(() => {
    if (!staffToken) return;
    staffApi.services(staffToken).then(setAll, () => setAll(null));
  }, [staffToken, lang]);
  return all ?? services;
}
