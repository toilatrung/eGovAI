import { describe, expect, it } from 'vitest'
import { checkOpenPathAllowed } from '../src/main/services/security/openPathGuard'
import { buildAgyStdinMessage } from '../src/main/services/agent/agyAdapter'

describe('checkOpenPathAllowed', () => {
  it('allows office documents and images (case-insensitive)', () => {
    for (const p of [
      'C:\\Hồ sơ\\Báo cáo.docx',
      'C:\\a\\b.DOC',
      'D:/x/bang.xlsx',
      'D:/x/bang.xls',
      'D:/x/data.csv',
      'C:\\x\\van-ban.PDF',
      'C:\\x\\note.md',
      'C:\\x\\note.txt',
      'C:\\x\\slide.pptx',
      'C:\\x\\a.png',
      'C:\\x\\a.jpg',
      'C:\\x\\a.jpeg',
      'C:\\x\\a.gif',
      'C:\\x\\a.webp',
      '\\\\server\\share\\cong-van.pdf'
    ]) {
      expect(checkOpenPathAllowed(p, false), p).toEqual({ allowed: true })
    }
  })

  it('allows directories whatever their name', () => {
    expect(checkOpenPathAllowed('C:\\Projects\\eGov', true)).toEqual({ allowed: true })
    expect(checkOpenPathAllowed('C:\\weird\\folder.exe', true)).toEqual({ allowed: true })
  })

  it('refuses executables and scripts with a Vietnamese error', () => {
    for (const p of [
      'C:\\x\\run.bat',
      'C:\\x\\run.cmd',
      'C:\\x\\setup.exe',
      'C:\\x\\shortcut.lnk',
      'C:\\x\\script.ps1',
      'C:\\x\\script.vbs',
      'C:\\x\\setup.msi',
      'C:\\x\\script.js',
      'C:\\x\\app.hta',
      'C:\\x\\link.url',
      'C:\\x\\report.pdf.exe',
      'C:\\x\\noext'
    ]) {
      const res = checkOpenPathAllowed(p, false)
      expect(res.allowed, p).toBe(false)
      if (!res.allowed) expect(res.error).toMatch(/an toàn/)
    }
  })

  it('refuses trailing-dot/space tricks, streams, URLs and missing paths', () => {
    expect(checkOpenPathAllowed('C:\\x\\run.bat.', false).allowed).toBe(false)
    expect(checkOpenPathAllowed('C:\\x\\run.bat . ', false).allowed).toBe(false)
    expect(checkOpenPathAllowed('C:\\x\\a.exe:b.txt', false).allowed).toBe(false)
    expect(checkOpenPathAllowed('C:\\x\\a.txt:evil.exe', false).allowed).toBe(false)
    expect(checkOpenPathAllowed('file:///C:/x/a.pdf', false).allowed).toBe(false)
    expect(checkOpenPathAllowed('ms-settings:privacy', false).allowed).toBe(false)
    expect(checkOpenPathAllowed('C:\\x\\a.pdf', undefined).allowed).toBe(false)
    expect(checkOpenPathAllowed('', false).allowed).toBe(false)
    expect(checkOpenPathAllowed(42, false).allowed).toBe(false)
  })
})

describe('buildAgyStdinMessage', () => {
  it('builds one NDJSON user line with the prompt intact', () => {
    const prompt = 'Dòng 1\nDòng 2 "trích dẫn" \\ và ký tự đặc biệt'
    const line = buildAgyStdinMessage(prompt)
    expect(line.endsWith('\n')).toBe(true)
    expect(line.slice(0, -1).includes('\n')).toBe(false)
    expect(JSON.parse(line)).toEqual({ event: 'user', message: { content: prompt } })
  })
})
