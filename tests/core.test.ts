import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { NdjsonLineBuffer, parseAgyNdjsonLine } from '../src/main/services/agent/ndjsonParser'
import {
  extractOAuthUrl,
  parseAgyModelsOutput,
  parseAgyQuotaJson
} from '../src/main/services/agent/agyBinary'
import { buildAgyCliArgs, buildComposedPrompt } from '../src/main/services/agent/agyAdapter'
import {
  categorizeUbndSkill,
  discoverAllSkills,
  parseIndexRouter,
  parseSkillFrontmatter
} from '../src/main/services/workspace/skillDiscovery'
import {
  detectDocKind,
  exportMarkdownToDocx,
  normalizeSheetRows,
  openDocumentFile,
  saveExcelDocumentFile
} from '../src/main/services/document/documentService'
import {
  extractLocalFilesFromMarkdown,
  resolveLocalFileHref,
  safeUrlTransform
} from '../src/renderer/src/utils/fileLinks'
import { computeTokenStats, formatCompactTokens } from '../src/renderer/src/utils/tokenStats'
import {
  parseAgentDesktopStatus,
  parseAgentDesktopWindows
} from '../src/main/services/desktop/computerUseService'
import {
  formatAgencyProfileSummary,
  mergeAgencyBlockIntoMarkdown
} from '../src/shared/agencyProfile'
import { DEFAULT_AGENCY_PROFILE } from '../src/shared/types'
import {
  DesktopMcpServer,
  normalizeAgentDesktopKey
} from '../src/main/services/desktop/desktopMcpServer'
import { InteractionManager } from '../src/main/services/desktop/interactionManager'
import {
  detectSystemBrowser,
  normalizeWebSelector
} from '../src/main/services/browser/playwrightService'

describe('ndjsonParser', () => {
  it('parses real agy init, text_delta, tool, and result events', () => {
    const initLine = JSON.stringify({
      event: 'init',
      conversation_id: 'conv-abc-123',
      init: {
        cwd: 'C:\\Users\\William Trinh\\Downloads\\ubndthieutoan-skills',
        tools: ['run_command', 'view_file'],
        permission_mode: 'request-review'
      }
    })
    const initEvent = parseAgyNdjsonLine(initLine, 'local-1', 'msg-1')
    expect(initEvent).toMatchObject({
      type: 'init',
      agyConversationId: 'conv-abc-123',
      permissionMode: 'request-review'
    })

    const deltaLine = JSON.stringify({
      event: 'step_update',
      step_update: {
        conversation_id: 'conv-abc-123',
        step_index: 1,
        state: 'ACTIVE',
        step_type: 'agent_response',
        text_delta: 'Xin chào từ GoogleAI!'
      }
    })
    expect(parseAgyNdjsonLine(deltaLine, 'local-1', 'msg-1')).toEqual({
      type: 'text_delta',
      conversationId: 'local-1',
      messageId: 'msg-1',
      delta: 'Xin chào từ GoogleAI!',
      stepIndex: 1
    })

    const toolLine = JSON.stringify({
      event: 'step_update',
      step_update: {
        conversation_id: 'conv-abc-123',
        step_index: 2,
        state: 'DONE',
        step_type: 'tool',
        tool_name: 'run_command',
        duration_seconds: 1.5,
        tool_info: {
          name: 'run_command',
          parameters: { CommandLine: 'dir' },
          output: 'INDEX.md'
        }
      }
    })
    const toolEvent = parseAgyNdjsonLine(toolLine, 'local-1', 'msg-1')
    expect(toolEvent).toMatchObject({
      type: 'tool_update',
      toolCall: {
        stepIndex: 2,
        toolName: 'run_command',
        state: 'DONE',
        durationSeconds: 1.5
      }
    })

    const resultLine = JSON.stringify({
      event: 'result',
      result: {
        conversation_id: 'conv-abc-123',
        status: 'SUCCESS',
        response: 'Xin chào từ GoogleAI!',
        duration_seconds: 3.1,
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          thinking_tokens: 10,
          cache_read_tokens: 0,
          total_tokens: 120
        }
      }
    })
    const resultEvent = parseAgyNdjsonLine(resultLine, 'local-1', 'msg-1')
    expect(resultEvent).toMatchObject({
      type: 'result',
      status: 'SUCCESS',
      usage: { totalTokens: 120 }
    })
  })

  it('ignores non-JSON warning lines from agy stdout', () => {
    expect(
      parseAgyNdjsonLine(
        'warning: --mode auto is not available for this account; continuing in the default mode.',
        'local-1',
        'msg-1'
      )
    ).toBeNull()
  })

  it('buffers partial NDJSON chunks cleanly across UTF-8 Vietnamese boundaries', () => {
    const buf = new NdjsonLineBuffer()
    const l1 = buf.push('{"event":"step_update","step_update":{"step_type":"agent_response",')
    expect(l1).toEqual([])
    const l2 = buf.push('"text_delta":"Tiếng Việt chuẩn"}}\n{"event":"result"')
    expect(l2).toHaveLength(1)
    expect(parseAgyNdjsonLine(l2[0], 'c1', 'm1')).toMatchObject({
      type: 'text_delta',
      delta: 'Tiếng Việt chuẩn'
    })
    const flushed = buf.flush()
    expect(flushed).toEqual(['{"event":"result"'])
  })
})

describe('agyBinary model parser', () => {
  it('parses tab-delimited agy models output', () => {
    const sample = `Fetching available models...
gemini-4-neon-high\tGemini 4 Neon (High)
gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)
`
    expect(parseAgyModelsOutput(sample)).toEqual([
      { id: 'gemini-4-neon-high', name: 'Gemini 4 Neon (High)' },
      { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' }
    ])
  })

  it('extracts Google OAuth2 URL even across ANSI codes and wrapped lines', () => {
    const raw =
      '\x1b[36mOpen this URL:\x1b[0m https://accounts.google.com/o/oauth2/v2/auth?\nclient_id=123&scope=openid'
    expect(extractOAuthUrl(raw)).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=123&scope=openid'
    )
  })

  it('parses official agy -p "/quota" --output-format json payload', () => {
    const sample = JSON.stringify({
      status: 'SUCCESS',
      command: {
        name: 'usage',
        data: {
          groups: [
            {
              name: 'Gemini Models',
              description: 'Models within this group: Gemini 4 Neon',
              buckets: [
                {
                  id: 'gemini-weekly',
                  name: 'Weekly Limit Remaining',
                  window: 'weekly',
                  remaining_fraction: 0.882,
                  reset_time: '2026-11-30T16:40:04Z'
                }
              ]
            }
          ]
        }
      }
    })
    const parsed = parseAgyQuotaJson(sample, 123456)
    expect(parsed).not.toBeNull()
    expect(parsed?.groups).toHaveLength(1)
    expect(parsed?.groups[0].buckets[0]).toMatchObject({
      id: 'gemini-weekly',
      window: 'weekly',
      remainingFraction: 0.882
    })
  })
})

describe('skillDiscovery for ubndthieutoan-skills', () => {
  it('parses YAML frontmatter with folded description', () => {
    const md = `---
name: vhxh-gemini-antigravity
description: >-
  Cài đặt, kiểm tra và hướng dẫn sử dụng bộ skill
  Văn hóa – Xã hội xã Thiệu Toán.
---
# Nội dung`
    expect(parseSkillFrontmatter(md)).toEqual({
      name: 'vhxh-gemini-antigravity',
      description: 'Cài đặt, kiểm tra và hướng dẫn sử dụng bộ skill Văn hóa – Xã hội xã Thiệu Toán.'
    })
  })

  it('parses INDEX.md router table and categorizes UBND skills', () => {
    const indexMd = `<!-- ROUTER:BEGIN -->
| Số | Skill | Thư mục |
|---|---|---|
| 00 | [Đúc kết phiên làm việc](skill_00_meta_tao_skill/SKILL.md) | \`skill_00_meta_tao_skill/\` |
| 06 | [Kế hoạch và báo cáo giáo dục](skill_ke_hoach_bao_cao_giao_duc/SKILL.md) | \`skill_ke_hoach_bao_cao_giao_duc/\` |
| 14 | [Cải cách hành chính](skill_cai_cach_hanh_chinh/SKILL.md) | \`skill_cai_cach_hanh_chinh/\` |
<!-- ROUTER:END -->`

    const items = parseIndexRouter(indexMd, 'C:\\nonexistent')
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ code: '00', category: 'Điều phối & Hệ thống' })
    expect(items[1]).toMatchObject({ code: '06', category: 'Giáo dục & Sáng kiến' })
    expect(items[2]).toMatchObject({ code: '14', category: 'Nội vụ, Cải cách & Tôn giáo' })
    expect(categorizeUbndSkill('02', 'Rà soát hồ sơ trình ký')).toBe('Hồ sơ & Tiến độ')
  })

  it('separates Global imported skills from Project-only skills in discoverAllSkills', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'egovai-skills-scope-'))
    try {
      const globalPack = join(tmp, 'bo-chung')
      const projectDir = join(tmp, 'du-an-rieng')
      mkdirSync(join(globalPack, 'skill-chung'), { recursive: true })
      mkdirSync(join(projectDir, '.agents', 'skills', 'skill-du-an'), { recursive: true })

      writeFileSync(
        join(globalPack, 'skill-chung', 'SKILL.md'),
        '---\nname: skill-chung\ndescription: Dung cho moi phien\n---\n# Global',
        'utf8'
      )
      writeFileSync(
        join(projectDir, '.agents', 'skills', 'skill-du-an', 'SKILL.md'),
        '---\nname: skill-du-an\ndescription: Chi rieng du an nay\n---\n# Project',
        'utf8'
      )

      const combined = discoverAllSkills(projectDir, [
        { id: 'g1', name: 'bo-chung', path: globalPack, addedAt: 1, skillCount: 1 }
      ])
      const proj = combined.filter((s) => s.scope === 'project')
      const glob = combined.filter((s) => s.scope === 'global' && s.packName === 'bo-chung')

      expect(proj.map((s) => s.name)).toContain('skill-du-an')
      expect(proj.map((s) => s.name)).not.toContain('skill-chung')
      expect(glob.map((s) => s.name)).toContain('skill-chung')
      expect(glob[0].sopFullPath).toContain('skill-chung')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('buildComposedPrompt', () => {
  it('injects Vietnamese instruction, active skill SOP, and attachments', () => {
    const out = buildComposedPrompt({
      conversationId: 'c1',
      messageId: 'm1',
      projectPath: 'C:\\proj',
      prompt: 'Soạn kế hoạch năm học',
      preferVietnameseReplies: true,
      activeSkill: {
        id: 'skill_ke_hoach_bao_cao_giao_duc',
        code: '06',
        name: 'skill_ke_hoach_bao_cao_giao_duc',
        title: 'Kế hoạch và báo cáo giáo dục',
        description: 'Mô tả',
        category: 'Giáo dục & Sáng kiến',
        folder: 'skill_ke_hoach_bao_cao_giao_duc',
        sopPath: 'skill_ke_hoach_bao_cao_giao_duc/SKILL.md',
        scope: 'global',
        source: 'global'
      },
      attachments: [{ type: 'file', path: 'C:\\ho-so\\so-lieu.xlsx', name: 'so-lieu.xlsx' }]
    })

    expect(out).toContain('Tiếng Việt')
    expect(out).toContain('Mã 06')
    expect(out).toContain('skill_ke_hoach_bao_cao_giao_duc/SKILL.md')
    expect(out).toContain('C:\\ho-so\\so-lieu.xlsx')
    expect(out).toContain('Soạn kế hoạch năm học')
  })

  it('passes --dangerously-skip-permissions only when computerUseEnabled is on and mode is not plan', () => {
    const base = {
      conversationId: 'c1',
      messageId: 'm1',
      projectPath: 'C:\\proj',
      prompt: 'Mở Chrome tra cứu'
    }
    expect(buildAgyCliArgs({ ...base, computerUseEnabled: true })).toContain(
      '--dangerously-skip-permissions'
    )
    expect(buildAgyCliArgs({ ...base, computerUseEnabled: false })).not.toContain(
      '--dangerously-skip-permissions'
    )
    expect(buildAgyCliArgs({ ...base, computerUseEnabled: true, mode: 'plan' })).not.toContain(
      '--dangerously-skip-permissions'
    )
  })
})

describe('documentService (Word .docx & Excel .xlsx)', () => {
  it('detects document kinds and normalizes sheet rows', () => {
    expect(detectDocKind('bao-cao.docx')).toBe('docx')
    expect(detectDocKind('so-lieu.xlsx')).toBe('excel')
    expect(detectDocKind('danh-sach.csv')).toBe('excel')
    expect(detectDocKind('plan.md')).toBe('markdown')
    expect(detectDocKind('review.json')).toBe('json')

    const normalized = normalizeSheetRows([['STT', 'Tên trường'], ['1', 'TH Thiệu Toán']])
    expect(normalized).toHaveLength(2)
    expect(normalized[0]).toHaveLength(6)
    expect(normalized[1][1]).toBe('TH Thiệu Toán')
  })

  it('saves and reopens Excel .xlsx and Word .docx with Vietnamese UTF-8 intact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'googleai-doc-test-'))
    try {
      const xlsxPath = join(dir, 'tong-hop.xlsx')
      saveExcelDocumentFile(xlsxPath, [
        {
          name: 'Giáo dục',
          rows: [
            ['STT', 'Đơn vị', 'Học sinh'],
            ['1', 'Trường THCS Thiệu Toán', '450']
          ]
        }
      ])
      const openedXlsx = await openDocumentFile(xlsxPath)
      expect(openedXlsx.kind).toBe('excel')
      expect(openedXlsx.sheets?.[0].name).toBe('Giáo dục')
      expect(openedXlsx.sheets?.[0].rows[1][1]).toBe('Trường THCS Thiệu Toán')

      const docxPath = join(dir, 'bao-cao.docx')
      await exportMarkdownToDocx(
        docxPath,
        '# BÁO CÁO GIÁO DỤC\n\nỦY BAN NHÂN DÂN XÃ THIỆU TOÁN\n\n- Chỉ tiêu đạt **100%**.\n'
      )
      const openedDocx = await openDocumentFile(docxPath)
      expect(openedDocx.kind).toBe('docx')
      expect(openedDocx.docxPlainText).toContain('BÁO CÁO GIÁO DỤC')
      expect(openedDocx.docxPlainText).toContain('THIỆU TOÁN')
      expect(openedDocx.htmlPreview).toContain('100%')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('fileLinks (clickable file:/// URLs in react-markdown)', () => {
  it('preserves file:/// URLs in safeUrlTransform and resolves Windows paths', () => {
    const fileUrl =
      'file:///C:/Users/William%20Trinh/Downloads/test/Ban_Kiem_Diem_Dang_Vien_2026.docx#L1-L5'
    expect(safeUrlTransform(fileUrl)).toBe(fileUrl)
    expect(safeUrlTransform('javascript:alert(1)')).toBe('')
    expect(resolveLocalFileHref(fileUrl)).toBe(
      'C:\\Users\\William Trinh\\Downloads\\test\\Ban_Kiem_Diem_Dang_Vien_2026.docx'
    )

    const extracted = extractLocalFilesFromMarkdown(
      `Đường dẫn tệp: [Ban_Kiem_Diem_Dang_Vien_2026.docx](${fileUrl})`
    )
    expect(extracted).toEqual([
      {
        label: 'Ban_Kiem_Diem_Dang_Vien_2026.docx',
        path: 'C:\\Users\\William Trinh\\Downloads\\test\\Ban_Kiem_Diem_Dang_Vien_2026.docx'
      }
    ])
  })
})

describe('tokenStats (Account Token Usage aggregation)', () => {
  it('aggregates all-time, today, active conversation, and per-model token stats', () => {
    const now = new Date('2026-11-24T10:00:00Z').getTime()
    const yesterday = new Date('2026-11-22T10:00:00Z').getTime()

    const summary = computeTokenStats(
      [
        {
          id: 'c1',
          projectId: 'p1',
          title: 'Hội thoại 1',
          createdAt: now,
          updatedAt: now,
          modelId: 'gemini-4-neon-high',
          messages: [
            {
              id: 'm1',
              role: 'assistant',
              content: 'ok',
              createdAt: now,
              usage: {
                inputTokens: 1000,
                outputTokens: 200,
                thinkingTokens: 150,
                cacheReadTokens: 1000,
                totalTokens: 1200
              }
            }
          ]
        },
        {
          id: 'c2',
          projectId: 'p1',
          title: 'Hội thoại cũ',
          createdAt: yesterday,
          updatedAt: yesterday,
          modelId: 'gemini-3.8-flash-medium',
          messages: [
            {
              id: 'm2',
              role: 'assistant',
              content: 'ok',
              createdAt: yesterday,
              usage: {
                inputTokens: 500,
                outputTokens: 100,
                thinkingTokens: 0,
                cacheReadTokens: 0,
                totalTokens: 600
              }
            }
          ]
        }
      ],
      'c1',
      [{ id: 'gemini-4-neon-high', name: 'Gemini 4 Neon (High)' }],
      now
    )

    expect(summary.allTime.totalTokens).toBe(1800)
    expect(summary.today.totalTokens).toBe(1200)
    expect(summary.activeConversation.totalTokens).toBe(1200)
    expect(summary.cacheHitPercent).toBe(40)
    expect(summary.byModel[0]).toMatchObject({
      modelName: 'Gemini 4 Neon (High)',
      totalTokens: 1200
    })
    expect(formatCompactTokens(53855)).toBe('53,9K')
  })
})

describe('computerUseService (vercel-labs/agent-desktop)', () => {
  it('parses agent-desktop status and list-windows JSON', () => {
    const statusJson = JSON.stringify({
      version: '2.6',
      ok: true,
      command: 'status',
      data: {
        permissions: { accessibility: { state: 'granted' } },
        platform: 'windows',
        supported_surfaces: ['window', 'taskbar'],
        version: '1.3.1'
      }
    })
    const status = parseAgentDesktopStatus(statusJson, 'C:\\bin\\agent-desktop.exe', 'C:\\bin')
    expect(status).toMatchObject({
      installed: true,
      version: '1.3.1',
      platform: 'windows',
      accessibilityGranted: true
    })

    const windowsJson = JSON.stringify({
      ok: true,
      data: {
        windows: [{ id: 'w1', app: 'WINWORD.EXE', title: 'Bao_cao.docx - Word' }]
      }
    })
    expect(parseAgentDesktopWindows(windowsJson)).toEqual([
      { id: 'w1', app: 'WINWORD.EXE', title: 'Bao_cao.docx - Word' }
    ])
  })
})

describe('agencyProfile (Public Administration Rules Form)', () => {
  it('formats agency profile and merges idempotently into GEMINI.md', () => {
    const profile = {
      ...DEFAULT_AGENCY_PROFILE,
      parentAgency: 'UBND TỈNH THANH HÓA',
      agencyName: 'UBND XÃ THIỆU TOÁN',
      departmentName: 'Phòng Văn hóa – Xã hội',
      staffName: 'Nguyễn Văn A'
    }
    const summary = formatAgencyProfileSummary(profile)
    expect(summary).toContain('UBND XÃ THIỆU TOÁN')
    expect(summary).toContain('Nghị định 30/2020/NĐ-CP')

    const initial = '# Quy tắc riêng có sẵn\nGiữ nguyên dòng này.'
    const merged1 = mergeAgencyBlockIntoMarkdown(initial, profile)
    expect(merged1).toContain('Giữ nguyên dòng này.')
    expect(merged1).toContain('UBND XÃ THIỆU TOÁN')

    const updatedProfile = { ...profile, agencyName: 'UBND XÃ MỚI' }
    const merged2 = mergeAgencyBlockIntoMarkdown(merged1, updatedProfile)
    expect(merged2).toContain('Giữ nguyên dòng này.')
    expect(merged2).toContain('UBND XÃ MỚI')
    expect(merged2).not.toContain('UBND XÃ THIỆU TOÁN')
  })
})

describe('DesktopMcpServer (Interactive Windows MCP bridge)', () => {
  it('enforces Bearer auth, serves MCP initialize & tools/list, and respects computerUseEnabled', async () => {
    let enabled = false
    const server = new DesktopMcpServer(() => enabled)
    const { url, token } = await server.start(0)
    try {
      const unauth = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
      })
      expect(unauth.status).toBe(401)

      const initRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
      })
      expect(initRes.status).toBe(200)
      const initJson = (await initRes.json()) as { result: { serverInfo: { name: string } } }
      expect(initJson.result.serverInfo.name).toBe('egovai-desktop')

      const listRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      })
      const listJson = (await listRes.json()) as { result: { tools: Array<{ name: string }> } }
      const toolNames = listJson.result.tools.map((t) => t.name)
      expect(toolNames).toContain('desktop_open_url')
      expect(toolNames).toContain('desktop_list_windows')
      expect(toolNames).toContain('desktop_find')
      expect(toolNames).toContain('desktop_request_scope')
      expect(toolNames).toContain('desktop_batch')
      expect(toolNames).toContain('desktop_screenshot')
      expect(toolNames).toContain('desktop_zoom')
      expect(toolNames).toContain('desktop_click_at')
      expect(toolNames).toContain('web_open')
      expect(toolNames).toContain('web_snapshot')
      expect(toolNames).toContain('web_read_text')
      expect(toolNames).toContain('web_click')
      expect(toolNames).toContain('web_fill')
      expect(toolNames).toContain('web_close')
      expect(normalizeAgentDesktopKey('Enter')).toBe('return')
      expect(normalizeAgentDesktopKey('Ctrl+Shift+S')).toBe('ctrl+shift+s')

      // Disabled guard
      const callRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'desktop_list_windows', arguments: {} }
        })
      })
      const callJson = (await callRes.json()) as { result: { isError: boolean } }
      expect(callJson.result.isError).toBe(true)
      enabled = true
      expect(enabled).toBe(true)
    } finally {
      server.stop()
    }
  })

  it('handles desktop_ask_user popup flow with selected options and user context note', async () => {
    const interactions = new InteractionManager((req) => {
      expect(req.kind).toBe('question')
      expect(req.title).toBe('Chọn mẫu văn bản')
      setTimeout(() => {
        interactions.respond({
          id: req.id,
          approved: true,
          selectedOptions: ['Nghị định 30'],
          contextNote: 'Ghi thêm tên Chủ tịch xã'
        })
      }, 10)
    })

    const server = new DesktopMcpServer(() => true, interactions)
    const { url, token } = await server.start(0)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 9,
          method: 'tools/call',
          params: {
            name: 'desktop_ask_user',
            arguments: {
              kind: 'question',
              title: 'Chọn mẫu văn bản',
              message: 'Anh/chị chọn mẫu nào?',
              options: ['Nghị định 30', 'Văn bản Đảng']
            }
          }
        })
      })
      const json = (await res.json()) as {
        result: { content: Array<{ text: string }>; isError: boolean }
      }
      expect(json.result.isError).toBe(false)
      expect(json.result.content[0].text).toContain('Nghị định 30')
      expect(json.result.content[0].text).toContain('Ghi thêm tên Chủ tịch xã')
    } finally {
      server.stop()
    }
  })
})

describe('playwrightService (System Chrome/Edge browser automation)', () => {
  it('normalizes @wN / wN element refs to data-egov-ref CSS selectors and preserves raw selectors', () => {
    expect(normalizeWebSelector('@w3')).toBe('[data-egov-ref="w3"]')
    expect(normalizeWebSelector('w12')).toBe('[data-egov-ref="w12"]')
    expect(normalizeWebSelector('  @W7  ')).toBe('[data-egov-ref="w7"]')
    expect(normalizeWebSelector('#search-input')).toBe('#search-input')
    expect(normalizeWebSelector('input[name="q"]')).toBe('input[name="q"]')
  })

  it('returns a valid system browser detection descriptor', () => {
    const info = detectSystemBrowser()
    expect(typeof info.available).toBe('boolean')
    if (info.available) {
      expect(['Google Chrome', 'Microsoft Edge']).toContain(info.name)
      expect(['chrome', 'msedge']).toContain(info.channel)
      expect(typeof info.executablePath).toBe('string')
    } else {
      expect(info.name).toBeNull()
      expect(info.channel).toBeNull()
      expect(info.executablePath).toBeNull()
    }
  })
})

