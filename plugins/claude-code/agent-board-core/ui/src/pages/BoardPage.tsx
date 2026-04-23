import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Board } from '../features/board/Board';
import { SetupWizard } from '../features/board/SetupWizard';

export function BoardPage() {
  const active = useQuery({ queryKey: ['active-project'], queryFn: api.activeProject });

  if (active.isLoading) {
    return <div className="center"><div className="spinner" /></div>;
  }
  return active.data?.project
    ? <Board project={active.data.project} />
    : <SetupWizard />;
}
