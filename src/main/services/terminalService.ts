import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import type { TerminalOutputEvent } from '../../shared/types'

export class TerminalService {
  private activeCmd: ChildProcessWithoutNullStreams | null = null

  runCommand(
    commandId: string,
    command: string,
    cwd: string,
    onOutput: (event: TerminalOutputEvent) => void
  ): void {
    this.killActive()

    const wrapped = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', wrapped],
      {
        cwd,
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8'
        }
      }
    )

    this.activeCmd = child

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      onOutput({ commandId, stream: 'stdout', data: chunk })
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      onOutput({ commandId, stream: 'stderr', data: chunk })
    })

    child.on('error', (err) => {
      if (this.activeCmd === child) this.activeCmd = null
      onOutput({
        commandId,
        stream: 'stderr',
        data: `Lỗi khởi chạy PowerShell: ${err.message}\n`
      })
      onOutput({ commandId, stream: 'meta', data: 'done', exitCode: 1 })
    })

    child.on('close', (code) => {
      if (this.activeCmd === child) this.activeCmd = null
      onOutput({ commandId, stream: 'meta', data: 'done', exitCode: code ?? 0 })
    })
  }

  killActive(): boolean {
    if (!this.activeCmd) return false
    try {
      this.activeCmd.kill('SIGTERM')
    } catch {
      try {
        this.activeCmd.kill()
      } catch {
        // ignore
      }
    }
    this.activeCmd = null
    return true
  }

  openExternalPowerShell(cwd: string): void {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', 'PowerShell', 'powershell.exe', '-NoExit'], {
        cwd,
        detached: true,
        stdio: 'ignore'
      }).unref()
    }
  }
}
