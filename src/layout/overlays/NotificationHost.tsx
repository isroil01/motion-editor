/**
 * NotificationHost — renders the toast stack from uiStore.notifications.
 * The data model + auto-dismiss already live in uiStore; the card itself is
 * the shared <Toast> primitive. This is only the stack. Mounted once near the
 * app root.
 */

import { Toast } from '@components/Toast';
import { useUIStore } from '@stores/uiStore';
import styles from './overlays.module.css';

export function NotificationHost(): JSX.Element | null {
  const notifications = useUIStore((s) => s.notifications);
  const dismiss = useUIStore((s) => s.dismissNotification);

  if (notifications.length === 0) return null;

  return (
    <div className={styles.toaster} role="region" aria-label="Notifications">
      {notifications.map((n) => (
        <Toast
          key={n.id}
          level={n.level}
          message={n.message}
          detail={n.detail}
          progress={n.progress}
          sticky={n.sticky}
          action={n.action}
          onDismiss={() => dismiss(n.id)}
        />
      ))}
    </div>
  );
}
