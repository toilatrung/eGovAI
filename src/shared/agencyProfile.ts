import type { AgencyRulesProfile } from './types'

const TONE_LABELS: Record<AgencyRulesProfile['writingTone'], string> = {
  formal_admin: 'Trang trọng, chuẩn hành chính công vụ Việt Nam',
  concise_executive: 'Ngắn gọn, súc tích, đi thẳng trọng tâm để lãnh đạo duyệt nhanh',
  detailed_legal: 'Chi tiết, phân tích đầy đủ căn cứ pháp lý và trích dẫn điều khoản'
}

export const AGENCY_BLOCK_BEGIN = '<!-- GOOGLEAI:AGENCY_RULES:BEGIN -->'
export const AGENCY_BLOCK_END = '<!-- GOOGLEAI:AGENCY_RULES:END -->'

export function formatAgencyProfileSummary(profile: AgencyRulesProfile): string {
  if (!profile.enabled) return ''

  const lines: string[] = ['## Hồ sơ đơn vị & Quy tắc công vụ (eGovAI)']

  const orgDetails: string[] = []
  if (profile.parentAgency.trim()) orgDetails.push(`- Cơ quan chủ quản: ${profile.parentAgency.trim()}`)
  if (profile.agencyName.trim()) orgDetails.push(`- Cơ quan / Đơn vị ban hành: ${profile.agencyName.trim()}`)
  if (profile.departmentName.trim()) orgDetails.push(`- Phòng / Bộ phận chuyên môn: ${profile.departmentName.trim()}`)
  if (profile.locationName.trim()) orgDetails.push(`- Địa danh ban hành: ${profile.locationName.trim()}`)
  if (profile.defaultSignerRole.trim() || profile.defaultSignerName.trim()) {
    const signer = [profile.defaultSignerRole.trim(), profile.defaultSignerName.trim()]
      .filter(Boolean)
      .join(' — ')
    orgDetails.push(`- Người ký mặc định: ${signer}`)
  }
  if (profile.staffName.trim() || profile.staffRole.trim()) {
    const staff = [profile.staffName.trim(), profile.staffRole.trim()].filter(Boolean).join(' — ')
    orgDetails.push(`- Cán bộ soạn thảo: ${staff}`)
  }

  if (orgDetails.length > 0) {
    lines.push('', '### 1. Thông tin cơ quan & cán bộ', ...orgDetails)
  }

  const standards: string[] = [`- Văn phong mặc định: ${TONE_LABELS[profile.writingTone]}.`]
  if (profile.enforceDecree30) {
    standards.push(
      '- Thể thức văn bản hành chính: Tuân thủ Nghị định 30/2020/NĐ-CP (khổ A4, Times New Roman 13–14pt, lề trên 20mm, dưới 20mm, trái 30mm, phải 15mm, đầy đủ Quốc hiệu – Tiêu ngữ, số ký hiệu, nơi nhận, chữ ký).'
    )
  }
  if (profile.supportPartyDocs) {
    standards.push(
      '- Văn bản của Đảng: Tuân thủ đúng thể thức, bố cục văn bản Đảng (Hướng dẫn 36-HD/VPTW) khi soạn báo cáo kiểm điểm, tờ trình Chi bộ/Đảng ủy.'
    )
  }
  if (profile.commonLegalRefs.trim()) {
    standards.push(`- Căn cứ pháp lý thường dùng tại đơn vị: ${profile.commonLegalRefs.trim()}.`)
  }
  lines.push('', '### 2. Thể thức & Văn phong', ...standards)

  const guardrails: string[] = []
  if (profile.verifyLegalStatus) {
    guardrails.push('- Luôn đối chiếu hiệu lực văn bản quy phạm pháp luật trước khi viện dẫn.')
  }
  if (profile.noFabricatedData) {
    guardrails.push(
      '- Tuyệt đối không tự bịa số liệu, mốc ngày, số văn bản hay họ tên khi hồ sơ đầu vào chưa cung cấp; phải nêu rõ mục còn thiếu để cán bộ bổ sung.'
    )
  }
  if (profile.askBeforeCritical) {
    guardrails.push(
      '- Luôn hỏi xác nhận trước khi gửi văn bản, xóa tệp hoặc ghi đè hồ sơ chính thức.'
    )
  }
  if (guardrails.length > 0) {
    lines.push('', '### 3. Nguyên tắc kiểm soát & An toàn', ...guardrails)
  }

  if (profile.customRules.trim()) {
    lines.push('', '### 4. Yêu cầu đặc thù của đơn vị', profile.customRules.trim())
  }

  return lines.join('\n')
}

export function mergeAgencyBlockIntoMarkdown(existing: string, profile: AgencyRulesProfile): string {
  const blockContent = profile.enabled
    ? `${AGENCY_BLOCK_BEGIN}\n${formatAgencyProfileSummary(profile)}\n${AGENCY_BLOCK_END}`
    : ''

  const startIdx = existing.indexOf(AGENCY_BLOCK_BEGIN)
  const endIdx = existing.indexOf(AGENCY_BLOCK_END)

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx).trimEnd()
    const after = existing.slice(endIdx + AGENCY_BLOCK_END.length).trimStart()
    return [before, blockContent, after].filter(Boolean).join('\n\n') + '\n'
  }

  const trimmed = existing.trim()
  if (!blockContent) return existing
  return trimmed ? `${trimmed}\n\n${blockContent}\n` : `${blockContent}\n`
}
