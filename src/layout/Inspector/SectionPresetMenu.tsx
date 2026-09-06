/**
 * SectionPresetMenu — Save / Apply / Delete presets for one inspector
 * section, as a small dropdown in the section's top-right.
 *
 * The section supplies two functions: `capture()` returns the values a
 * preset should hold, and `apply(values)` writes them back. The menu owns
 * nothing about what those values mean, which is what lets Transform, Text,
 * Appearance and Material share it without sharing a schema.
 */

import { useState } from 'react';
import { Dropdown, type DropdownItem } from '@components/Dropdown';
import { Icon } from '@components/Icon';
import { useSectionPresetStore, type PresetValues } from '@stores/sectionPresetStore';
import styles from './SectionPresetMenu.module.css';

export interface SectionPresetMenuProps {
  /** Preset namespace — `transform`, `text`, `appearance`, `material`. */
  sectionId: string;
  /** The values to save. */
  capture?: () => PresetValues;
  /** Apply a saved preset's values to the section's subject. */
  apply?: (values: PresetValues) => void;
  /** Accessible name for the trigger. */
  label?: string;
}

export function SectionPresetMenu({ sectionId, capture, apply, label }: SectionPresetMenuProps): JSX.Element {
  const presets = useSectionPresetStore((s) => s.presets[sectionId] ?? []);
  const save = useSectionPresetStore((s) => s.save);
  const remove = useSectionPresetStore((s) => s.remove);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const commitSave = (): void => {
    if (!capture) return;
    save(sectionId, name || `Preset ${presets.length + 1}`, capture());
    setName('');
    setNaming(false);
  };

  const items: DropdownItem[] = [
    { type: 'item', id: 'save', label: 'Save current as preset…', icon: 'plus', disabled: !capture, onSelect: () => setNaming(true) },
  ];
  if (presets.length > 0) {
    items.push({ type: 'separator' });
    items.push({ type: 'label', label: 'Apply' });
    for (const p of presets) {
      items.push({ type: 'item', id: `apply-${p.id}`, label: p.name, disabled: !apply, onSelect: () => apply?.(p.values) });
    }
    items.push({ type: 'separator' });
    items.push({
      type: 'item',
      id: 'delete',
      label: 'Delete preset',
      icon: 'trash',
      danger: true,
      submenu: presets.map((p) => ({
        type: 'item' as const,
        id: `delete-${p.id}`,
        label: p.name,
        danger: true,
        onSelect: () => remove(sectionId, p.id),
      })),
    });
  }

  return (
    <span className={styles.root}>
      {naming ? (
        <span className={styles.nameRow}>
          <input
            className={styles.nameInput}
            value={name}
            placeholder="Preset name"
            aria-label="Preset name"
            autoFocus
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitSave();
              if (e.key === 'Escape') setNaming(false);
            }}
          />
          <button type="button" className={styles.nameBtn} onClick={commitSave} aria-label="Save preset">
            <Icon name="check" size="sm" />
          </button>
          <button type="button" className={styles.nameBtn} onClick={() => setNaming(false)} aria-label="Cancel">
            <Icon name="close" size="sm" />
          </button>
        </span>
      ) : (
        <Dropdown
          placement="bottom-end"
          items={items}
          trigger={
            <button type="button" className={styles.trigger} aria-label={label ?? 'Section presets'} title="Presets">
              <Icon name="sliders-h" size="sm" />
              <span className={styles.triggerText}>Presets</span>
              <Icon name="chevron-down" size="sm" />
            </button>
          }
        />
      )}
    </span>
  );
}

export default SectionPresetMenu;
