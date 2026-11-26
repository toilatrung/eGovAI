import type { ReasoningEffort } from './types'

/**
 * Ba "Chế độ AI" thay cho danh sách dài mô hình + mức suy luận (góp ý U1):
 * cán bộ chỉ cần chọn Nhanh / Cân bằng / Chuyên sâu.
 */
export type AiPresetId = 'fast' | 'balanced' | 'deep'

export interface AiPresetDef {
  id: AiPresetId
  label: string
  hint: string
  effort: ReasoningEffort
  /** Mẫu mã mô hình theo thứ tự ưu tiên (khớp chuỗi con, không phân biệt hoa thường). */
  modelPreferences: string[]
}

export const AI_PRESETS: AiPresetDef[] = [
  {
    id: 'fast',
    label: 'Nhanh',
    hint: 'Hỏi đáp, sửa câu chữ, tóm tắt ngắn',
    effort: 'low',
    modelPreferences: ['flash-medium', 'flash-high', 'flash', 'hydrogen-low']
  },
  {
    id: 'balanced',
    label: 'Cân bằng',
    hint: 'Soạn công văn, tờ trình, báo cáo (khuyên dùng)',
    effort: 'medium',
    modelPreferences: ['hydrogen-medium', 'hydrogen-high', 'hydrogen']
  },
  {
    id: 'deep',
    label: 'Chuyên sâu',
    hint: 'Văn bản dài, nhiều căn cứ pháp lý, phân tích số liệu',
    effort: 'high',
    modelPreferences: ['hydrogen-high', 'hydrogen-xhigh', 'hydrogen-medium', 'hydrogen']
  }
]

export const DEFAULT_AI_PRESET: AiPresetId = 'balanced'

export interface ResolvedAiPreset {
  /** '' = để lõi agy tự chọn mô hình mặc định. */
  modelId: string
  effort: ReasoningEffort
}

export function resolveAiPreset(
  presetId: AiPresetId,
  models: ReadonlyArray<{ id: string }>
): ResolvedAiPreset {
  const preset = AI_PRESETS.find((p) => p.id === presetId) ?? AI_PRESETS[1]
  for (const pattern of preset.modelPreferences) {
    const hit = models.find((m) => m.id.toLowerCase().includes(pattern))
    if (hit) return { modelId: hit.id, effort: preset.effort }
  }
  return { modelId: '', effort: preset.effort }
}

/** Tìm chế độ khớp với cặp mô hình/mức suy luận hiện tại; null nếu là lựa chọn tùy chỉnh. */
export function detectAiPreset(
  modelId: string,
  effort: ReasoningEffort,
  models: ReadonlyArray<{ id: string }>
): AiPresetId | null {
  for (const preset of AI_PRESETS) {
    const resolved = resolveAiPreset(preset.id, models)
    if (resolved.modelId === modelId && resolved.effort === effort) return preset.id
  }
  return null
}

// ---------------------------------------------------------------------------
// Danh sách mô hình rút gọn: mỗi dòng mô hình chỉ giữ bản mới nhất, gộp các mức
// suy luận (-low/-medium/-high/-xhigh) thành một lựa chọn. Mức suy luận lấy theo Chế độ AI.
// ---------------------------------------------------------------------------

const EFFORT_ORDER: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh']
const EFFORT_SUFFIX_RE = /-(low|medium|high|xhigh)$/i
const EFFORT_LABEL_RE = /\s*\((low|medium|high|xhigh)\)\s*$/i

export interface ModelFamily {
  /** Mã mô hình bỏ hậu tố mức suy luận, VD "gemini-4-hydrogen". */
  base: string
  /** Tên hiển thị không kèm mức suy luận, VD "Gemini 4 Hydrogen". */
  label: string
  /** Các biến thể theo mức suy luận (hoặc chỉ một mã nếu mô hình không chia mức). */
  variants: Array<{ id: string; effort?: ReasoningEffort }>
}

function splitModelId(id: string): { base: string; effort?: ReasoningEffort } {
  const m = id.match(EFFORT_SUFFIX_RE)
  if (!m) return { base: id }
  return { base: id.slice(0, m.index), effort: m[1].toLowerCase() as ReasoningEffort }
}

/** Nhà cung cấp + dòng mô hình (VD "gemini/hydrogen", "claude/opus") và số phiên bản. */
function lineAndVersion(base: string): { line: string; version: number[] } {
  const tokens = base.toLowerCase().split('-').filter(Boolean)
  const vendor = tokens[0] ?? base
  const version: number[] = []
  const tier: string[] = []
  for (const tok of tokens.slice(1)) {
    if (/^\d+(\.\d+)*$/.test(tok)) version.push(...tok.split('.').map(Number))
    else if (tok !== 'thinking' && tok !== 'preview' && tok !== 'latest') tier.push(tok)
  }
  return { line: `${vendor}/${tier.join('-')}`, version }
}

function compareVersion(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * Rút gọn danh sách mô hình của lõi: gộp các mức suy luận thành một dòng và bỏ các phiên bản
 * cũ của cùng một dòng mô hình (VD có Gemini 4 Hydrogen thì ẩn Gemini 3 Hydrogen).
 */
export function curateModels(models: ReadonlyArray<{ id: string; name: string }>): ModelFamily[] {
  const families = new Map<string, ModelFamily>()
  for (const m of models) {
    const { base, effort } = splitModelId(m.id)
    let fam = families.get(base)
    if (!fam) {
      fam = { base, label: m.name.replace(EFFORT_LABEL_RE, '').trim() || base, variants: [] }
      families.set(base, fam)
    }
    fam.variants.push({ id: m.id, effort })
  }

  const newestPerLine = new Map<string, { fam: ModelFamily; version: number[] }>()
  for (const fam of families.values()) {
    const { line, version } = lineAndVersion(fam.base)
    const current = newestPerLine.get(line)
    if (!current || compareVersion(version, current.version) > 0) {
      newestPerLine.set(line, { fam, version })
    }
  }
  const keep = new Set([...newestPerLine.values()].map((v) => v.fam.base))
  // Giữ thứ tự lõi trả về (thường là thứ tự khuyên dùng).
  return [...families.values()].filter((f) => keep.has(f.base))
}

/** Chọn biến thể của một dòng mô hình khớp (hoặc gần nhất) với mức suy luận mong muốn. */
export function pickModelVariant(family: ModelFamily, effort: ReasoningEffort): string {
  const exact = family.variants.find((v) => v.effort === effort)
  if (exact) return exact.id
  const withEffort = family.variants.filter((v) => v.effort)
  if (withEffort.length === 0) return family.variants[0].id
  const target = EFFORT_ORDER.indexOf(effort)
  return withEffort.reduce((best, v) =>
    Math.abs(EFFORT_ORDER.indexOf(v.effort!) - target) < Math.abs(EFFORT_ORDER.indexOf(best.effort!) - target)
      ? v
      : best
  ).id
}

/**
 * Mô hình + mức suy luận cuối cùng: `familyBase` rỗng = để Chế độ AI tự chọn mô hình;
 * ngược lại dùng dòng mô hình người dùng chọn với mức suy luận của Chế độ AI.
 */
export function resolveModelChoice(
  presetId: AiPresetId,
  familyBase: string,
  models: ReadonlyArray<{ id: string; name: string }>
): ResolvedAiPreset {
  const preset = resolveAiPreset(presetId, models)
  if (!familyBase) return preset
  const family = curateModels(models).find((f) => f.base === familyBase)
  if (!family) return preset
  return { modelId: pickModelVariant(family, preset.effort), effort: preset.effort }
}
