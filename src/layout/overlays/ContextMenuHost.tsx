/**
 * ContextMenuHost — renders the active context menu from contextMenuStore.
 *
 * The menu itself — portal, viewport clamp, outside-click / Escape close,
 * focus restore, the no-scroll opt-out for long scene lists — is the shared
 * <ContextMenu> primitive; this is only the store binding.
 */

import { ContextMenu } from '@components/ContextMenu';
import { useContextMenuStore } from '@stores/contextMenuStore';

export function ContextMenuHost(): JSX.Element | null {
  const open = useContextMenuStore((s) => s.open);
  const x = useContextMenuStore((s) => s.x);
  const y = useContextMenuStore((s) => s.y);
  const items = useContextMenuStore((s) => s.items);
  const close = useContextMenuStore((s) => s.close);

  return <ContextMenu open={open} x={x} y={y} items={items} onClose={close} />;
}
