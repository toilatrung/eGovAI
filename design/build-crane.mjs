// Sinh logo chim hạc eGovAI (phong cách hoa văn trống đồng Đông Sơn) ra các tệp SVG.
// Chạy: node design/build-crane.mjs
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const r = (n) => Math.round(n * 100) / 100

/** Hình chim hạc trong khung 0..240 × 0..130, tô bằng `ink`, lỗ mắt bằng `hole`. */
function crane(ink, hole, maskId = 'egovTailCut') {
  const parts = []
  const line = (x1, y1, x2, y2, w) =>
    parts.push(`<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${ink}" stroke-width="${w}"/>`)

  // Mỏ: dải dài, thon dần về mũi
  parts.push(`<path d="M150 47 L234 49 L234 51.5 L152 60 Z" fill="${ink}"/>`)

  // Đầu: khối bo tròn, mắt tròn đồng tâm
  parts.push(`<rect x="124" y="40" width="34" height="22" rx="11" fill="${ink}"/>`)
  parts.push(`<circle cx="145" cy="51" r="6.4" fill="${hole}"/>`)
  parts.push(`<circle cx="145" cy="51" r="3.1" fill="${ink}"/>`)

  // Mào: lược 4 nét xiên trên đỉnh đầu
  for (let i = 0; i < 3; i++) line(127 + i * 7, 38, 121 + i * 7, 22, 3.6)

  // Cổ + thân: dải đôi uốn từ đầu xuống thân rồi chạy ngang ra sau
  parts.push(
    `<path d="M154 62 C154 84 138 90 116 90 L58 90" fill="none" stroke="${ink}" stroke-width="5"/>`,
    `<path d="M143 62 C143 76 132 81 116 81 L58 81" fill="none" stroke="${ink}" stroke-width="5"/>`
  )

  // Cánh: thanh dựng đứng cắt ngang thân, lược gạch bên trái, đầu vát
  const wing = (yTop, yBot, slantUp) => {
    parts.push(`<rect x="98" y="${yTop}" width="9" height="${yBot - yTop}" fill="${ink}"/>`)
    for (let y = yTop + 2.5; y <= yBot - 2; y += 6) line(84, y, 98, y, 3.4)
    // đầu cánh vát (lông cánh chĩa ra)
    const yEnd = slantUp ? yTop : yBot
    const dir = slantUp ? -1 : 1
    for (let i = 0; i < 5; i++) line(85 + i * 5, yEnd + dir * 1, 81 + i * 5, yEnd + dir * 11, 3.4)
  }
  wing(22, 76, true)
  wing(95, 120, false)

  // Đuôi: dải đặc chếch lên phía sau, cắt sọc âm bản
  const ang = (-162 * Math.PI) / 180
  const tx = Math.cos(ang)
  const ty = Math.sin(ang)
  const nx = -ty
  const ny = tx
  const ox = 64
  const oy = 85.5
  const len = 62
  const w0 = 6.5
  const w1 = 11
  const P = (d, h) => `${r(ox + tx * d + nx * h)},${r(oy + ty * d + ny * h)}`
  const band = [P(0, -w0), P(len, -w1), P(len, w1), P(0, w0)].join(' ')
  const cuts = []
  for (let d = 9; d < len - 2; d += 6.4) {
    const h = w0 + ((w1 - w0) * d) / len + 1
    cuts.push(`<line x1="${P(d, -h).split(',')[0]}" y1="${P(d, -h).split(',')[1]}" x2="${P(d, h * 0.55).split(',')[0]}" y2="${P(d, h * 0.55).split(',')[1]}" stroke="black" stroke-width="2.4"/>`)
  }
  parts.push(
    `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="-20" y="-20" width="280" height="180"><rect x="-20" y="-20" width="280" height="180" fill="white"/>${cuts.join('')}</mask>`,
    `<polygon points="${band}" fill="${ink}" mask="url(#${maskId})"/>`
  )

  // Chân: hai nét gấp khúc kéo về phía sau
  parts.push(
    `<polyline points="76,92 64,106 34,102" fill="none" stroke="${ink}" stroke-width="4" stroke-linejoin="miter"/>`,
    `<polyline points="84,92 72,114 40,114" fill="none" stroke="${ink}" stroke-width="4" stroke-linejoin="miter"/>`
  )
  return parts.join('\n    ')
}

const RED = '#B3121B'
const GOLD = '#F2C230'
const INK = '#111111'

// 1) Hình chim đứng riêng: vàng kim (dùng trên nền tối) và mực đen (in ấn, văn bản)
writeFileSync(
  join(here, 'egovai-crane.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 10 240 120" role="img" aria-label="eGovAI – chim hạc">
  <g stroke-linecap="butt">
    ${crane(GOLD, '#0B0B0F')}
  </g>
</svg>
`
)
writeFileSync(
  join(here, 'egovai-crane-ink.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 10 240 120" role="img" aria-label="eGovAI – chim hạc">
  <g stroke-linecap="butt">
    ${crane(INK, '#FFFFFF')}
  </g>
</svg>
`
)

// 2) Dấu tròn (app icon / favicon): nền đỏ son, viền vàng, chim vàng bay ngang
writeFileSync(
  join(here, 'egovai-crane-mark.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="eGovAI">
  <circle cx="32" cy="32" r="31" fill="${RED}"/>
  <circle cx="32" cy="32" r="28.4" fill="none" stroke="${GOLD}" stroke-width="1.3"/>
  <g transform="translate(4.6 15.6) scale(0.236)" stroke-linecap="butt">
    ${crane(GOLD, RED)}
  </g>
</svg>
`
)

/**
 * Bản giản lược cho cỡ nhỏ (≤ 32px: khung chat, favicon, thanh tác vụ): bỏ lược gạch,
 * giữ đường nét nhận diện — mỏ dài, đầu + mắt, cổ uốn, cánh dựng, đuôi chếch.
 */
function craneSimple(ink, hole) {
  return [
    `<path d="M146 40 L238 50 L146 64 Z" fill="${ink}"/>`,
    `<rect x="116" y="32" width="46" height="34" rx="17" fill="${ink}"/>`,
    `<circle cx="144" cy="49" r="8" fill="${hole}"/>`,
    `<path d="M146 62 C146 88 130 94 106 94 L56 94" fill="none" stroke="${ink}" stroke-width="20"/>`,
    `<rect x="84" y="22" width="26" height="100" fill="${ink}"/>`,
    `<polygon points="66,82 2,54 0,86 66,106" fill="${ink}"/>`
  ].join('\n    ')
}

writeFileSync(
  join(here, 'egovai-crane-mark-small.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="eGovAI">
  <circle cx="32" cy="32" r="32" fill="${RED}"/>
  <g transform="translate(2.6 14) scale(0.25)">
    ${craneSimple(GOLD, RED)}
  </g>
</svg>
`
)
console.log('Đã ghi egovai-crane.svg, egovai-crane-ink.svg, egovai-crane-mark.svg, egovai-crane-mark-small.svg')
