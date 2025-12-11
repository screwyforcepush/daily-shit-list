import { useState, useEffect, useCallback } from 'react'
import './App.css'

const API_BASE = 'https://tremendous-labrador-731.convex.site'
const API_KEY = 'dsl-ui-client'
const USER_ID = 'alex'

type TaskStatus = 'active' | 'done' | 'blocked' | 'parked'

interface Task {
  id: string
  stream: string
  title: string
  status: TaskStatus
  blockedReason?: string | null
  priority?: number | null
  createdAt: string
  updatedAt: string
}

interface PlannerView {
  streams: Record<string, Task[]>
  stats: {
    totalActive: number
    totalDoneToday: number
    blockedCount: number
  }
}

interface CommandResult {
  op: string
  ok: boolean
  task_id?: string
  error?: string
}

function App() {
  const [view, setView] = useState<PlannerView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newTaskStream, setNewTaskStream] = useState('')
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [blockReason, setBlockReason] = useState<Record<string, string>>({})
  const [showAddForm, setShowAddForm] = useState(false)

  const fetchState = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/dsl/state?user_id=${USER_ID}`)
      const data = await response.json()
      setView(data.view)
      setError(null)
    } catch (err) {
      setError('Failed to fetch planner state')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchState()
  }, [fetchState])

  const sendCommand = async (commands: object[]): Promise<CommandResult[]> => {
    try {
      const response = await fetch(`${API_BASE}/dsl/command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-DSL-API-Key': API_KEY,
        },
        body: JSON.stringify({
          version: 'v1',
          user_id: USER_ID,
          commands,
        }),
      })
      const data = await response.json()
      if (data.view) {
        setView(data.view)
      }
      return data.results || []
    } catch (err) {
      setError('Failed to send command')
      return []
    }
  }

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTaskStream.trim() || !newTaskTitle.trim()) return

    await sendCommand([
      { op: 'add', stream: newTaskStream.trim(), title: newTaskTitle.trim() },
    ])
    setNewTaskStream('')
    setNewTaskTitle('')
    setShowAddForm(false)
  }

  const handleStatusChange = async (taskId: string, newStatus: TaskStatus, reason?: string) => {
    const command: Record<string, string> = { op: newStatus, task_id: taskId }
    if (newStatus === 'blocked' && reason) {
      command.reason = reason
    }
    await sendCommand([command])
    setBlockReason((prev) => ({ ...prev, [taskId]: '' }))
  }

  const handleSweep = async () => {
    await sendCommand([{ op: 'sweep' }])
  }

  const getStatusColor = (status: TaskStatus): string => {
    switch (status) {
      case 'active': return '#22c55e'
      case 'done': return '#6b7280'
      case 'blocked': return '#ef4444'
      case 'parked': return '#f59e0b'
      default: return '#6b7280'
    }
  }

  const getStatusEmoji = (status: TaskStatus): string => {
    switch (status) {
      case 'active': return '▶'
      case 'done': return '✓'
      case 'blocked': return '⛔'
      case 'parked': return '⏸'
      default: return '•'
    }
  }

  if (loading) {
    return <div className="container">Loading...</div>
  }

  if (error) {
    return (
      <div className="container">
        <div className="error">{error}</div>
        <button onClick={fetchState}>Retry</button>
      </div>
    )
  }

  const allStreams = view ? Object.keys(view.streams).sort() : []

  return (
    <div className="container">
      <header className="header">
        <h1>Daily Shit List</h1>
        <div className="stats">
          <span className="stat active">{view?.stats.totalActive || 0} active</span>
          <span className="stat done">{view?.stats.totalDoneToday || 0} done today</span>
          <span className="stat blocked">{view?.stats.blockedCount || 0} blocked</span>
        </div>
        <div className="header-actions">
          <button className="btn-add" onClick={() => setShowAddForm(!showAddForm)}>
            + Add Task
          </button>
          <button className="btn-sweep" onClick={handleSweep}>
            🧹 Sweep
          </button>
          <button className="btn-refresh" onClick={fetchState}>
            ↻ Refresh
          </button>
        </div>
      </header>

      {showAddForm && (
        <form className="add-form" onSubmit={handleAddTask}>
          <input
            type="text"
            placeholder="Stream (e.g., crankshaft, personal)"
            value={newTaskStream}
            onChange={(e) => setNewTaskStream(e.target.value)}
            list="streams"
          />
          <datalist id="streams">
            {allStreams.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <input
            type="text"
            placeholder="Task title"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
          />
          <button type="submit">Add</button>
          <button type="button" onClick={() => setShowAddForm(false)}>Cancel</button>
        </form>
      )}

      <main className="streams">
        {allStreams.map((streamName) => {
          const tasks = view?.streams[streamName] || []
          return (
            <section key={streamName} className="stream">
              <h2 className="stream-name">{streamName}</h2>
              <ul className="task-list">
                {tasks.map((task) => (
                  <li key={task.id} className={`task task-${task.status}`}>
                    <div className="task-header">
                      <span
                        className="task-status"
                        style={{ color: getStatusColor(task.status) }}
                      >
                        {getStatusEmoji(task.status)}
                      </span>
                      <span className="task-title">{task.title}</span>
                      {task.priority !== null && task.priority !== undefined && (
                        <span className="task-priority">P{task.priority}</span>
                      )}
                    </div>
                    {task.blockedReason && (
                      <div className="task-blocked-reason">
                        ⚠ {task.blockedReason}
                      </div>
                    )}
                    <div className="task-actions">
                      {task.status !== 'active' && (
                        <button
                          className="btn-action btn-active"
                          onClick={() => handleStatusChange(task.id, 'active')}
                        >
                          ▶ Active
                        </button>
                      )}
                      {task.status !== 'done' && (
                        <button
                          className="btn-action btn-done"
                          onClick={() => handleStatusChange(task.id, 'done')}
                        >
                          ✓ Done
                        </button>
                      )}
                      {task.status !== 'blocked' && (
                        <div className="block-action">
                          <input
                            type="text"
                            placeholder="Reason..."
                            value={blockReason[task.id] || ''}
                            onChange={(e) =>
                              setBlockReason((prev) => ({
                                ...prev,
                                [task.id]: e.target.value,
                              }))
                            }
                          />
                          <button
                            className="btn-action btn-blocked"
                            onClick={() =>
                              handleStatusChange(task.id, 'blocked', blockReason[task.id])
                            }
                          >
                            ⛔ Block
                          </button>
                        </div>
                      )}
                      {task.status !== 'parked' && (
                        <button
                          className="btn-action btn-parked"
                          onClick={() => handleStatusChange(task.id, 'parked')}
                        >
                          ⏸ Park
                        </button>
                      )}
                    </div>
                  </li>
                ))}
                {tasks.length === 0 && (
                  <li className="task-empty">No tasks in this stream</li>
                )}
              </ul>
            </section>
          )
        })}
        {allStreams.length === 0 && (
          <div className="empty-state">
            <p>No tasks yet. Add your first task!</p>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
