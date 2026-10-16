import { ArrowDown, ArrowUp, EllipsisVertical, Globe, Star } from 'lucide-react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { DriveItem, SortField, SortState } from '../../api/types';
import { formatBytes } from '../../lib/format';
import { FileIcon, FolderIcon } from './FileIcon';
import { Thumbnail } from './Thumbnail';

/** Shared event handlers every card/row receives from ItemBrowser. */
export interface ItemHandlers {
  onSelect: (entry: DriveItem) => void;
  onOpen: (entry: DriveItem) => void;
  onMenu: (entry: DriveItem, x: number, y: number) => void;
  onKeyDown: (entry: DriveItem, e: KeyboardEvent<HTMLElement>) => void;
}

interface ItemProps extends ItemHandlers {
  entry: DriveItem;
  selected: boolean;
}

// On touch screens a single tap opens; with a mouse, click selects and double-click opens.
const isTouch = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;

function interactionProps({ entry, onSelect, onOpen, onMenu, onKeyDown }: ItemProps) {
  return {
    tabIndex: 0,
    'aria-label': `${entry.type === 'folder' ? 'Folder' : 'File'}: ${entry.item.name}`,
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      if (isTouch()) onOpen(entry);
      else onSelect(entry);
    },
    onDoubleClick: () => onOpen(entry),
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      onSelect(entry);
      onMenu(entry, e.clientX, e.clientY);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => onKeyDown(entry, e),
  };
}

function MoreButton({ entry, onMenu, onSelect }: Pick<ItemProps, 'entry' | 'onMenu' | 'onSelect'>) {
  return (
    <button
      type="button"
      aria-label={`More actions for ${entry.item.name}`}
      aria-haspopup="menu"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(entry);
        const rect = e.currentTarget.getBoundingClientRect();
        onMenu(entry, rect.left, rect.bottom + 4);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200"
    >
      <EllipsisVertical className="size-4" />
    </button>
  );
}

function StarBadge({ entry }: { entry: DriveItem }) {
  if (entry.type !== 'file') return null;
  return (
    <>
      {entry.item.shared && (
        <Globe className="size-3.5 shrink-0 text-green-600" aria-label="Shared with anyone who has the link" />
      )}
      {entry.item.starred && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="Starred" />}
    </>
  );
}

// ---------- grid view ----------

export function ItemCard(props: ItemProps) {
  const { entry, selected } = props;
  const base = `cursor-default rounded-xl border transition-colors select-none ${
    selected ? 'border-brand-100 bg-brand-100' : 'border-slate-200 bg-white hover:bg-slate-50'
  }`;

  if (entry.type === 'folder') {
    return (
      <div {...interactionProps(props)} aria-selected={selected} className={`${base} flex items-center gap-3 py-2 pr-1 pl-4`}>
        <FolderIcon />
        <span className="flex-1 truncate text-sm font-medium">{entry.item.name}</span>
        <MoreButton {...props} />
      </div>
    );
  }

  return (
    <div {...interactionProps(props)} aria-selected={selected} className={`${base} flex flex-col gap-2 p-2`}>
      <div className="flex items-center gap-2 pl-2">
        <FileIcon mimeType={entry.item.mimeType} />
        <span className="flex-1 truncate text-sm font-medium" title={entry.item.name}>
          {entry.item.name}
        </span>
        <StarBadge entry={entry} />
        <MoreButton {...props} />
      </div>
      <Thumbnail file={entry.item} />
    </div>
  );
}

// ---------- list view ----------

export interface ListColumns {
  ownerLabel: (entry: DriveItem) => string;
  dateLabel: string;
  dateValue: (entry: DriveItem) => string;
}

export function ItemRow(props: ItemProps & { columns: ListColumns }) {
  const { entry, selected, columns } = props;
  return (
    <div
      {...interactionProps(props)}
      aria-selected={selected}
      role="row"
      className={`grid cursor-default grid-cols-[1fr_auto] items-center gap-4 border-b border-slate-100 py-1 pr-2 pl-4 text-sm select-none sm:grid-cols-[minmax(0,1fr)_8rem_8rem_6rem_auto] ${
        selected ? 'bg-brand-100' : 'hover:bg-slate-50'
      }`}
    >
      <div role="cell" className="flex min-w-0 items-center gap-3">
        {entry.type === 'folder' ? <FolderIcon /> : <FileIcon mimeType={entry.item.mimeType} />}
        <span className="truncate font-medium" title={entry.item.name}>
          {entry.item.name}
        </span>
        <StarBadge entry={entry} />
      </div>
      <div role="cell" className="hidden truncate text-slate-600 sm:block">
        {columns.ownerLabel(entry)}
      </div>
      <div role="cell" className="hidden text-slate-600 sm:block">
        {columns.dateValue(entry)}
      </div>
      <div role="cell" className="hidden text-slate-600 sm:block">
        {entry.type === 'file' ? formatBytes(entry.item.size) : '—'}
      </div>
      <div role="cell">
        <MoreButton {...props} />
      </div>
    </div>
  );
}

export function ListHeader({
  columns,
  sort,
  onSortChange,
}: {
  columns: ListColumns;
  sort?: SortState;
  onSortChange?: (s: SortState) => void;
}) {
  const header = (label: string, field?: SortField) => {
    if (!sort || !onSortChange || !field) return <span>{label}</span>;
    const active = sort.sort === field;
    const Arrow = sort.order === 'asc' ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() =>
          onSortChange({ sort: field, order: active && sort.order === 'asc' ? 'desc' : active ? 'asc' : field === 'name' ? 'asc' : 'desc' })
        }
        className={`inline-flex items-center gap-1 rounded hover:text-slate-900 ${active ? 'text-slate-900' : ''}`}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {active && <Arrow className="size-3.5" aria-hidden />}
      </button>
    );
  };

  return (
    <div
      role="row"
      className="grid grid-cols-[1fr_auto] gap-4 border-b border-slate-200 py-2 pr-2 pl-4 text-xs font-medium text-slate-500 sm:grid-cols-[minmax(0,1fr)_8rem_8rem_6rem_auto]"
    >
      <div role="columnheader">{header('Name', 'name')}</div>
      <div role="columnheader" className="hidden sm:block">
        Owner
      </div>
      <div role="columnheader" className="hidden sm:block">
        {header(columns.dateLabel, columns.dateLabel === 'Uploaded' ? 'date' : undefined)}
      </div>
      <div role="columnheader" className="hidden sm:block">
        {header('Size', 'size')}
      </div>
      <div className="w-8" />
    </div>
  );
}
