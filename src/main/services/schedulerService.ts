import { Notification } from 'electron'
import type { ScheduledTask } from '../../shared/types'
import { AgyCliAdapter } from '../agent/agyAdapter'
import type { StorageService } from './storageService'

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null
  private adapter = new AgyCliAdapter({ keepAlive: false })
  private runningTaskIds = new Set<string>()
  private onTasksUpdated: (tasks: ScheduledTask[]) => void

  constructor(
    private storage: StorageService,
    onTasksUpdated: (tasks: ScheduledTask[]) => void
  ) {
    this.onTasksUpdated = onTasksUpdated
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.tick()
    }, 30_000)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.adapter.abortAll()
  }

  private async tick(): Promise<void> {
    const now = Date.now()
    const tasks = this.storage.getState().scheduledTasks
    for (const task of tasks) {
      if (!task.enabled || this.runningTaskIds.has(task.id)) continue
      const dueAt = task.nextRunAt ?? (task.lastRunAt ?? task.createdAt) + task.intervalMinutes * 60_000
      if (now >= dueAt) {
        void this.runTaskNow(task.id)
      }
    }
  }

  async runTaskNow(taskId: string): Promise<void> {
    const task = this.storage.getState().scheduledTasks.find((t) => t.id === taskId)
    if (!task || this.runningTaskIds.has(taskId)) return

    this.runningTaskIds.add(taskId)
    const started: ScheduledTask = {
      ...task,
      lastRunAt: Date.now(),
      lastStatus: 'running',
      nextRunAt: Date.now() + task.intervalMinutes * 60_000
    }
    this.storage.upsertScheduledTask(started)
    this.onTasksUpdated(this.storage.getState().scheduledTasks)

    const settings = this.storage.getState().settings
    let collected = ''

    await new Promise<void>((resolve) => {
      void this.adapter.sendPrompt(
        {
          conversationId: `sched-${task.id}`,
          messageId: `sched-msg-${Date.now()}`,
          projectPath: task.projectPath,
          prompt: task.prompt,
          modelId: settings.defaultModelId || undefined,
          effort: settings.effort,
          // Scheduled runs are unattended: always read-only plan mode (never accept-edits)
          // and never with computer use, whatever the user's interactive settings are.
          mode: 'plan',
          computerUseEnabled: false,
          useSandbox: settings.useSandbox,
          preferVietnameseReplies: settings.preferVietnameseReplies
        },
        settings.agyPathOverride,
        (event) => {
          if (!this.storage.getState().scheduledTasks.some((t) => t.id === taskId)) {
            if (event.type === 'result' || event.type === 'error' || event.type === 'aborted') resolve()
            return
          }
          if (event.type === 'text_delta') {
            collected += event.delta
          } else if (event.type === 'result') {
            const output = collected.trim() || event.response || 'Đã hoàn thành.'
            const doneTask: ScheduledTask = {
              ...started,
              lastStatus: 'success',
              lastOutput: output.slice(0, 6000),
              nextRunAt: Date.now() + task.intervalMinutes * 60_000
            }
            this.storage.upsertScheduledTask(doneTask)
            this.onTasksUpdated(this.storage.getState().scheduledTasks)
            if (Notification.isSupported()) {
              new Notification({
                title: `eGovAI — Hoàn thành tác vụ: ${task.name}`,
                body: output.slice(0, 140)
              }).show()
            }
            resolve()
          } else if (event.type === 'error' || event.type === 'aborted') {
            const errTask: ScheduledTask = {
              ...started,
              lastStatus: 'error',
              lastOutput: event.type === 'error' ? event.error : 'Tác vụ đã bị dừng.',
              nextRunAt: Date.now() + task.intervalMinutes * 60_000
            }
            this.storage.upsertScheduledTask(errTask)
            this.onTasksUpdated(this.storage.getState().scheduledTasks)
            resolve()
          }
        }
      )
    })

    this.runningTaskIds.delete(taskId)
  }
}
