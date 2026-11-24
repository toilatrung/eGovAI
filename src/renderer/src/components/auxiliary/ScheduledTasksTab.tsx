import { useState } from 'react'
import { Clock, Plus, Play, Trash2, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import type { ScheduledTask } from '../../../../shared/types'
import { useAppStore } from '../../stores/useAppStore'

interface ScheduledTasksTabProps {
  isLight: boolean
}

export function ScheduledTasksTab({ isLight }: ScheduledTasksTabProps): React.JSX.Element {
  const { projects, activeProjectId, scheduledTasks, setScheduledTasks } = useAppStore()
  const activeProject = projects.find((p) => p.id === activeProjectId)

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [intervalMinutes, setIntervalMinutes] = useState(60)
  const [expandedOutputId, setExpandedOutputId] = useState<string | null>(null)

  const projectTasks = scheduledTasks.filter((t) => t.projectId === activeProjectId)

  const handleCreate = async (): Promise<void> => {
    if (!activeProject || !name.trim() || !prompt.trim()) return
    const now = Date.now()
    const task: ScheduledTask = {
      id: `task-${now.toString(36)}`,
      name: name.trim(),
      projectId: activeProject.id,
      projectPath: activeProject.path,
      prompt: prompt.trim(),
      intervalMinutes: Math.max(5, intervalMinutes),
      enabled: true,
      createdAt: now,
      nextRunAt: now + Math.max(5, intervalMinutes) * 60_000
    }
    const updated = await window.googleAI.upsertScheduledTask(task)
    setScheduledTasks(updated)
    setName('')
    setPrompt('')
    setShowForm(false)
  }

  const handleToggle = async (task: ScheduledTask): Promise<void> => {
    const updated = await window.googleAI.upsertScheduledTask({
      ...task,
      enabled: !task.enabled,
      nextRunAt: !task.enabled ? Date.now() + task.intervalMinutes * 60_000 : task.nextRunAt
    })
    setScheduledTasks(updated)
  }

  const handleDelete = async (taskId: string): Promise<void> => {
    const updated = await window.googleAI.deleteScheduledTask(taskId)
    setScheduledTasks(updated)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={`flex items-center justify-between border-b px-3 py-2 ${
          isLight ? 'border-line bg-canvas' : 'border-line bg-surface'
        }`}
      >
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Clock className="h-3.5 w-3.5 text-blue-400" />
          <span>Tác vụ chạy định kỳ ({projectTasks.length})</span>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          disabled={!activeProject}
          className="press flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-500 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Thêm lịch</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        {showForm && (
          <div
            className={`space-y-2.5 rounded-xl border p-3 text-xs ${
              isLight ? 'border-line bg-surface' : 'border-line-strong bg-surface'
            }`}
          >
            <div>
              <label className="block text-[11px] text-faint">Tên tác vụ</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: Kiểm tra hạn đầu việc hằng ngày"
                className={`mt-1 w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none ${
                  isLight
                    ? 'border-line-strong bg-canvas text-ink'
                    : 'border-line-strong bg-canvas text-ink'
                }`}
              />
            </div>

            <div>
              <label className="block text-[11px] text-faint">
                Yêu cầu giao cho eGovAI thực hiện
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="VD: Dùng Skill 01 kiểm tra các đầu việc sắp đến hạn trong Thư mục làm việc AI và tóm tắt..."
                className={`mt-1 w-full resize-none rounded-lg border px-2.5 py-1.5 text-xs outline-none ${
                  isLight
                    ? 'border-line-strong bg-canvas text-ink'
                    : 'border-line-strong bg-canvas text-ink'
                }`}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-faint">Chu kỳ lặp:</span>
                <select
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                  className={`rounded-lg border px-2 py-1 text-xs outline-none ${
                    isLight
                      ? 'border-line-strong bg-canvas text-ink'
                      : 'border-line-strong bg-canvas text-ink'
                  }`}
                >
                  <option value={15}>Mỗi 15 phút</option>
                  <option value={60}>Mỗi 1 giờ</option>
                  <option value={240}>Mỗi 4 giờ</option>
                  <option value={1440}>Mỗi ngày (24 giờ)</option>
                  <option value={10080}>Mỗi tuần</option>
                </select>
              </div>

              <div className="flex gap-1.5">
                <button
                  onClick={() => setShowForm(false)}
                  className="press rounded-lg px-2.5 py-1 text-xs text-faint hover:bg-sunken"
                >
                  Hủy
                </button>
                <button
                  onClick={() => void handleCreate()}
                  disabled={!name.trim() || !prompt.trim()}
                  className="press rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                >
                  Lưu lịch
                </button>
              </div>
            </div>
          </div>
        )}

        {projectTasks.length === 0 ? (
          <div className="py-10 text-center text-xs text-faint">
            Chưa có tác vụ định kỳ nào. Bạn có thể đặt lịch để eGovAI tự động rà soát tiến độ hoặc tổng hợp báo cáo theo chu kỳ.
          </div>
        ) : (
          projectTasks.map((task) => {
            const showOut = expandedOutputId === task.id
            return (
              <div
                key={task.id}
                className={`rounded-xl border p-3 text-xs ${
                  isLight ? 'border-line bg-surface' : 'border-line bg-surface'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-semibold">
                      {task.lastStatus === 'running' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                      ) : task.lastStatus === 'success' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      ) : task.lastStatus === 'error' ? (
                        <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-faint" />
                      )}
                      <span className="truncate">{task.name}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-faint">{task.prompt}</p>
                  </div>

                  <input
                    type="checkbox"
                    checked={task.enabled}
                    onChange={() => void handleToggle(task)}
                    title="Bật / Tắt tự động chạy"
                    className="mt-0.5 h-4 w-4 accent-blue-600"
                  />
                </div>

                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-[10px] text-faint">
                  <span>
                    Chu kỳ: {task.intervalMinutes >= 1440 ? `${task.intervalMinutes / 1440} ngày` : `${task.intervalMinutes} phút`}
                    {task.lastRunAt
                      ? ` · Chạy gần nhất: ${new Date(task.lastRunAt).toLocaleTimeString('vi-VN')}`
                      : ''}
                  </span>

                  <div className="flex items-center gap-1.5">
                    {task.lastOutput && (
                      <button
                        onClick={() => setExpandedOutputId(showOut ? null : task.id)}
                        className="press rounded px-1.5 py-0.5 text-blue-400 hover:bg-blue-500/15"
                      >
                        {showOut ? 'Ẩn kết quả' : 'Xem kết quả'}
                      </button>
                    )}
                    <button
                      onClick={() => void window.googleAI.runScheduledTaskNow(task.id)}
                      disabled={task.lastStatus === 'running'}
                      className="press flex items-center gap-1 rounded bg-blue-600/20 px-2 py-0.5 font-medium text-blue-400 hover:bg-blue-600/30 disabled:opacity-40"
                    >
                      <Play className="h-2.5 w-2.5 fill-current" />
                      <span>Chạy ngay</span>
                    </button>
                    <button
                      onClick={() => void handleDelete(task.id)}
                      className="press rounded p-1 text-faint hover:bg-red-500/15 hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {showOut && task.lastOutput && (
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/25 p-2.5 font-sans text-[11px] leading-relaxed">
                    {task.lastOutput}
                  </pre>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
