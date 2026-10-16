import { useState } from 'react';
import { errorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel, danger, onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={confirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{message}</p>
    </Modal>
  );
}
