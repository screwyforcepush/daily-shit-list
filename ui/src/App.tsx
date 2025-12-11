import { useState, useEffect, useCallback } from 'react'
import './App.css'

const API = 'https://tremendous-labrador-731.convex.site/api'

type Status = 'planned' | 'in_flight' | 'blocked' | 'done'

interface Task {
  _id: string
  title: string
  project: string
  status: Status
  blockedReason?: string
  notes: { t: string; text: string }[]
  createdAt: string
  updatedAt: string
  completedAt?: string
}

interface ListResponse {
  tasks: Record<string, Task[]>
  stats: {
    total: number
    planned: number
    in_flight: number
    blocked: number
    done: number
  }
}

function App() {
  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [newProject, setNewProject] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [blockReason, setBlockReason] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    const res = await fetch(API)
    setData(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const post = async (body: object) => {
    await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    refresh()
  }

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newProject.trim() || !newTitle.trim()) return
    await post({ op: 'add', project: newProject.trim(), title: newTitle.trim() })
    setNewProject('')
    setNewTitle('')
    setShowAdd(false)
  }

  const setStatus = async (id: string, status: Status, reason?: string) => {
    await post({ op: 'status', id, status, reason })
    setBlockReason(prev => ({ ...prev, [id]: '' }))
  }

  const deleteTask = async (id: string) => {
    await post({ op: 'delete', id })
  }

  const statusDot: Record<Status, string> = {
    in_flight: 'bg-blue-400',
    blocked: 'bg-rose-500',
    planned: 'bg-neutral-500',
    done: 'bg-emerald-500',
  }

  const statusLabel: Record<Status, string> = {
    in_flight: 'In Flight',
    blocked: 'Blocked',
    planned: 'Planned',
    done: 'Done',
  }

  if (loading) return <div className="p-8 text-neutral-400">Loading...</div>

  const projects = data ? Object.keys(data.tasks).sort() : []
  const allProjects = [...new Set([...projects])]

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4">
      <header className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">Daily Sh*t List</h1>
          <div className="flex gap-2">
            <button onClick={() => setShowAdd(!showAdd)} className="px-3 py-1 bg-blue-600 rounded text-sm">
              + Add
            </button>
            <button onClick={() => post({ op: 'purge' })} className="px-3 py-1 bg-neutral-700 rounded text-sm">
              Purge Done
            </button>
          </div>
        </div>

        {data && (
          <div className="flex gap-3 text-sm">
            <span className="text-blue-400">{data.stats.in_flight} in flight</span>
            <span className="text-rose-400">{data.stats.blocked} blocked</span>
            <span className="text-neutral-400">{data.stats.planned} planned</span>
            <span className="text-emerald-400">{data.stats.done} done</span>
          </div>
        )}
      </header>

      {showAdd && (
        <form onSubmit={addTask} className="mb-6 p-3 bg-neutral-900 rounded-lg flex gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Project"
            value={newProject}
            onChange={e => setNewProject(e.target.value)}
            list="projects"
            className="flex-1 min-w-[120px] px-3 py-2 bg-neutral-800 rounded border border-neutral-700 text-sm"
          />
          <datalist id="projects">
            {allProjects.map(p => <option key={p} value={p} />)}
          </datalist>
          <input
            type="text"
            placeholder="Task title"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            className="flex-[2] min-w-[200px] px-3 py-2 bg-neutral-800 rounded border border-neutral-700 text-sm"
          />
          <button type="submit" className="px-4 py-2 bg-emerald-600 rounded text-sm">Add</button>
        </form>
      )}

      <div className="space-y-6">
        {projects.map(project => {
          const tasks = data?.tasks[project] || []
          const active = tasks.filter(t => t.status !== 'done')
          const done = tasks.filter(t => t.status === 'done')

          return (
            <section key={project} className="bg-neutral-900/50 rounded-xl p-4 border border-neutral-800">
              <h2 className="text-sm uppercase tracking-wider text-neutral-400 mb-3">{project}</h2>

              <ul className="space-y-2">
                {active.map(task => (
                  <li key={task._id} className="bg-neutral-900 rounded-lg p-3">
                    <div className="flex items-start gap-3">
                      <span className={`mt-1.5 h-2 w-2 rounded-full ${statusDot[task.status]}`} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{task.title}</div>
                        {task.blockedReason && (
                          <div className="text-xs text-rose-400 mt-1">⚠ {task.blockedReason}</div>
                        )}
                        {task.notes.length > 0 && (
                          <div className="text-xs text-neutral-500 mt-1 truncate">
                            note: {task.notes[task.notes.length - 1].text}
                          </div>
                        )}

                        <div className="flex gap-2 mt-2 flex-wrap">
                          {task.status !== 'in_flight' && (
                            <button onClick={() => setStatus(task._id, 'in_flight')}
                              className="px-2 py-1 text-xs bg-blue-600/20 text-blue-400 rounded">
                              Start
                            </button>
                          )}
                          {task.status !== 'done' && (
                            <button onClick={() => setStatus(task._id, 'done')}
                              className="px-2 py-1 text-xs bg-emerald-600/20 text-emerald-400 rounded">
                              Done
                            </button>
                          )}
                          {task.status !== 'blocked' && (
                            <div className="flex gap-1">
                              <input
                                type="text"
                                placeholder="reason"
                                value={blockReason[task._id] || ''}
                                onChange={e => setBlockReason(prev => ({ ...prev, [task._id]: e.target.value }))}
                                className="w-24 px-2 py-1 text-xs bg-neutral-800 rounded border border-neutral-700"
                              />
                              <button onClick={() => setStatus(task._id, 'blocked', blockReason[task._id])}
                                className="px-2 py-1 text-xs bg-rose-600/20 text-rose-400 rounded">
                                Block
                              </button>
                            </div>
                          )}
                          {task.status === 'blocked' && (
                            <button onClick={() => setStatus(task._id, 'planned')}
                              className="px-2 py-1 text-xs bg-neutral-600/20 text-neutral-400 rounded">
                              Unblock
                            </button>
                          )}
                          <button onClick={() => deleteTask(task._id)}
                            className="px-2 py-1 text-xs bg-neutral-700/50 text-neutral-500 rounded">
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}

                {done.length > 0 && (
                  <li className="mt-3 pt-3 border-t border-neutral-800">
                    <div className="text-xs text-neutral-500 mb-2">Completed ({done.length})</div>
                    {done.map(task => (
                      <div key={task._id} className="flex items-center gap-2 text-sm text-neutral-500 py-1">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        <span className="line-through flex-1">{task.title}</span>
                        <button onClick={() => deleteTask(task._id)} className="text-xs text-neutral-600 hover:text-neutral-400">×</button>
                      </div>
                    ))}
                  </li>
                )}
              </ul>

              {tasks.length === 0 && (
                <div className="text-neutral-600 text-sm">No tasks</div>
              )}
            </section>
          )
        })}

        {projects.length === 0 && (
          <div className="text-center text-neutral-600 py-12">
            No tasks yet. Add your first task!
          </div>
        )}
      </div>
    </div>
  )
}

export default App
