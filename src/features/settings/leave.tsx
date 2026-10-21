import { useNavigate } from 'react-router';
import { LogOut } from 'lucide-react';
import { Button } from '../../components/Button';
import { confirmAction } from '../../components/ConfirmDialog';
import { useWorkspace } from '../../data/workspace';
import { leaveWorkspace } from '../../data/workspaces';
import type { LandingState } from '../../app/Landing';

/** "Leave workspace" for admins and members (the owner must transfer ownership first). */
export function LeaveWorkspaceButton() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  if (ws.role === 'owner') return null;

  const leave = () =>
    void confirmAction({
      title: `Leave ${ws.name}?`,
      body: 'You lose access to its boards and docs right away, and your API tokens in it are revoked. To come back, someone has to invite you again.',
      confirmLabel: 'Leave workspace',
      danger: true,
      onConfirm: () =>
        leaveWorkspace(ws.id).then(() => {
          const state: LandingState = { notice: `You left ${ws.name}.` };
          navigate('/workspaces', { replace: true, state });
        }),
    });

  return (
    <Button icon={<LogOut size="0.8125rem" />} onClick={leave}>
      Leave workspace
    </Button>
  );
}
