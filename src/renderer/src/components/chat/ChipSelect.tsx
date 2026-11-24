import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface ChipOption<V extends string> {
  value: V
  label: string
  /** Shorter text for the chip itself; defaults to the label without a trailing "(…)" */
  short?: string
  hint?: string
}

interface ChipSelectProps<V extends string> {
  value: V
  options: ChipOption<V>[]
  onChange: (value: V) => void
  icon: React.ComponentType<{ className?: string }>
  /** Shown as the menu heading and the chip's tooltip */
  label: string
  className?: string
}

/**
 * Composer chip that opens its options upward (the composer sits at the bottom of the
 * window, so a native <select> would open off-screen in OS colours).
 * Keyboard: Enter/Space/ArrowUp/ArrowDown open; arrows move; Enter picks; Esc closes.
 */
export function ChipSelect<V extends string>({
  value,
  options,
  onChange,
  icon: Icon,
  label,
  className
}: ChipSelectProps<V>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listId = useId()

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  )
  const current = options[selectedIndex]

  useEffect(() => {
    if (!open) return
    setActive(selectedIndex)
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, selectedIndex])

  const pick = (i: number): void => {
    const opt = options[i]
    if (opt) onChange(opt.value)
    setOpen(false)
    buttonRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + options.length) % options.length)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(active)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        title={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`press flex h-7 max-w-[180px] items-center gap-1.5 rounded-md border pl-2.5 pr-2 text-[12.5px] ${
          open
            ? 'border-line-strong bg-sunken text-ink'
            : 'border-line text-muted hover:bg-sunken hover:text-ink'
        }`}
      >
        <Icon className="h-[13px] w-[13px] shrink-0" />
        <span className="truncate">
          {current ? (current.short ?? current.label.replace(/\s*\([^)]*\)$/, '')) : label}
        </span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 opacity-60 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          className="egov-pop absolute bottom-full left-0 z-30 mb-2 max-h-[min(320px,60vh)] w-max min-w-[220px] max-w-[320px] overflow-y-auto rounded-xl border border-line-strong bg-surface p-1.5 text-ink"
        >
          <div className="px-2.5 pb-1 pt-1 text-[12px] font-medium text-faint">{label}</div>
          {options.map((opt, i) => {
            const selected = opt.value === value
            return (
              <div
                key={opt.value || '__auto'}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(i)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] ${
                  i === active ? 'bg-sunken' : ''
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${selected ? 'font-medium text-ink' : 'text-muted'}`}>
                    {opt.label}
                  </span>
                  {opt.hint && <span className="block truncate text-[12px] text-faint">{opt.hint}</span>}
                </span>
                <Check className={`h-3.5 w-3.5 shrink-0 text-brand ${selected ? '' : 'invisible'}`} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
