// eGovAI mark: 14-ray Đông Sơn drum sun on a đỏ son seal, ringed by 14 network nodes.
// Geometry matches design/egovai-mark.svg.

const SUN_POINTS =
  '32.00,17.00 33.16,26.93 38.51,18.49 35.24,27.93 43.73,22.65 36.69,29.74 46.62,28.66 37.20,32.00 46.62,35.34 36.69,34.26 43.73,41.35 35.24,36.07 38.51,45.51 33.16,37.07 32.00,47.00 30.84,37.07 25.49,45.51 28.76,36.07 20.27,41.35 27.31,34.26 17.38,35.34 26.80,32.00 17.38,28.66 27.31,29.74 20.27,22.65 28.76,27.93 25.49,18.49 30.84,26.93'

const NODES: Array<[number, number]> = [
  [37.9, 6.16],
  [48.52, 11.28],
  [55.88, 20.5],
  [58.5, 32],
  [55.88, 43.5],
  [48.52, 52.72],
  [37.9, 57.84],
  [26.1, 57.84],
  [15.48, 52.72],
  [8.12, 43.5],
  [5.5, 32],
  [8.12, 20.5],
  [15.48, 11.28],
  [26.1, 6.16]
]

const RED = '#B3121B'
const GOLD = '#F2C230'

interface MarkProps {
  size?: number
  /** 'color' = red seal, gold sun. 'reverse' = gold seal for red grounds. */
  variant?: 'color' | 'reverse'
  className?: string
}

export function EgovMark({ size = 24, variant = 'color', className }: MarkProps): React.JSX.Element {
  const ground = variant === 'color' ? RED : GOLD
  const figure = variant === 'color' ? GOLD : RED
  // Below ~28px the node ring turns to noise, so small sizes keep only the seal and sun.
  const detailed = size >= 28

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="eGovAI"
      className={`shrink-0 ${className ?? ''}`}
    >
      <circle cx="32" cy="32" r="31" fill={ground} />
      {detailed && <circle cx="32" cy="32" r="29.4" fill="none" stroke={figure} strokeWidth="1" />}
      <circle cx="32" cy="32" r="22.6" fill="none" stroke={figure} strokeWidth={detailed ? 1.2 : 1.8} />
      {detailed &&
        NODES.map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.3" fill={figure} />)}
      <polygon points={SUN_POINTS} fill={figure} />
      <circle cx="32" cy="32" r="3.4" fill={ground} />
      <circle cx="32" cy="32" r="1.6" fill={figure} />
    </svg>
  )
}

/** Wordmark: "eGov" in đỏ son, "AI" in vàng đậm. */
export function EgovWordmark({ className }: { className?: string }): React.JSX.Element {
  return (
    <span className={`font-brand font-bold tracking-[-0.01em] ${className ?? ''}`}>
      <span className="text-brand">eGov</span>
      <span className="text-gold-ink">AI</span>
    </span>
  )
}
