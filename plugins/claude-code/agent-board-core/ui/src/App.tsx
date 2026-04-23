import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from './api';
import { SetupWizard } from './features/board/SetupWizard';
import { Board } from './features/board/Board';

export function App() {
  const { t } = useTranslation();
  const alive = useQuery({
    queryKey: ['alive'],
    queryFn: api.alive,
    refetchInterval: 5000,
  });
  const active = useQuery({
    queryKey: ['active-project'],
    queryFn: api.activeProject,
    enabled: alive.isSuccess,
  });

  const offline = alive.failureCount >= 3;

  return (
    <div className="app">
      {offline && <div className="offline-banner">{t('app.offline')}</div>}
      {active.isLoading && <div className="center muted">Loading…</div>}
      {active.data?.project ? <Board project={active.data.project} /> : <SetupWizard />}
    </div>
  );
}
