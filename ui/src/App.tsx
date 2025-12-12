import { useState } from 'react'
import { ConvexProvider, ConvexReactClient, useQuery } from 'convex/react'
import { api } from '@convex/api'
import './App.css'

const convex = new ConvexReactClient('https://tremendous-labrador-731.convex.cloud')

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

function Dashboard() {
  const data = useQuery(api.planner.list, {}) as ListResponse | undefined
  const [showCompleted, setShowCompleted] = useState(false)
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({})
  const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({})

  const toggleTaskExpand = (taskId: string) => {
    setExpandedTasks(prev => ({
      ...prev,
      [taskId]: !prev[taskId]
    }))
  }

  const toggleProjectCollapse = (project: string) => {
    setCollapsedProjects(prev => ({
      ...prev,
      [project]: !prev[project]
    }))
  }

  const getProgressColor = (percentage: number): string => {
    if (percentage < 25) return 'bg-rose-500'
    if (percentage < 75) return 'bg-amber-500'
    return 'bg-emerald-500'
  }

  const statusDot: Record<Status, string> = {
    in_flight: 'bg-blue-400',
    blocked: 'bg-rose-500',
    planned: 'bg-neutral-500',
    done: 'bg-emerald-500',
  }

  if (!data) return <div className="p-8 text-neutral-400">Loading...</div>

  const projects = Object.keys(data.tasks).sort()

  // Collect all done tasks from all projects for global completed section
  const allDoneTasks: Task[] = Object.values(data.tasks).flatMap(tasks =>
    tasks.filter(t => t.status === 'done')
  )

  // Group done tasks by project for display
  const doneTasksByProject = allDoneTasks.reduce((acc, task) => {
    if (!acc[task.project]) acc[task.project] = []
    acc[task.project].push(task)
    return acc
  }, {} as Record<string, Task[]>)

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4">
      <header className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">Daily Sh*t List</h1>
          <div className="flex items-center gap-2 text-xs text-neutral-600">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            live
          </div>
        </div>

        <div className="flex gap-4 text-sm">
          <span className="text-blue-400 font-medium">{data.stats.in_flight} in flight</span>
          <span className="text-rose-400">{data.stats.blocked} blocked</span>
          <span className="text-neutral-400">{data.stats.planned} planned</span>
          <span className="text-emerald-400">{data.stats.done} done</span>
        </div>
      </header>

      <div className="space-y-4">
        {projects.map(project => {
          const tasks = data.tasks[project] || []
          const active = tasks.filter(t => t.status !== 'done')
          const doneTasks = tasks.filter(t => t.status === 'done')
          const totalTasks = tasks.length
          const progressPercent = totalTasks > 0 ? Math.round((doneTasks.length / totalTasks) * 100) : 0
          const isCollapsed = collapsedProjects[project] ?? false

          // Skip rendering projects that only have done tasks
          if (active.length === 0 && tasks.length > 0) return null

          return (
            <section key={project} className="bg-neutral-900/50 rounded-xl p-4 border border-neutral-800">
              <button
                onClick={() => toggleProjectCollapse(project)}
                className="w-full text-left flex items-center justify-between cursor-pointer hover:opacity-80 transition-opacity"
              >
                <h2 className="text-sm uppercase tracking-wider text-neutral-400">
                  {project}
                  {isCollapsed && (
                    <span className="ml-2 text-neutral-500">
                      ({active.length} task{active.length !== 1 ? 's' : ''})
                    </span>
                  )}
                </h2>
                <span className="text-neutral-500 text-xs">
                  {isCollapsed ? '+' : '-'}
                </span>
              </button>

              {/* Progress Bar */}
              <div className="mt-2 mb-3">
                <div className="flex items-center gap-2 text-xs text-neutral-500 mb-1">
                  <span>{progressPercent}%</span>
                  <span className="text-neutral-600">({doneTasks.length}/{totalTasks})</span>
                </div>
                <div className="h-1 bg-neutral-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${getProgressColor(progressPercent)} transition-all duration-300`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              {!isCollapsed && (
              <ul className="space-y-1">
                {active.map(task => {
                  const isExpanded = expandedTasks[task._id] ?? false
                  const hasNotes = task.notes.length > 0
                  const latestNote = hasNotes ? task.notes[task.notes.length - 1].text : ''
                  const isLongNote = latestNote.length > 100 || latestNote.includes('\n')

                  return (
                    <li
                      key={task._id}
                      className={`rounded-lg px-3 py-2 ${
                        task.status === 'in_flight'
                          ? 'bg-blue-950/50 border border-blue-800/50'
                          : task.status === 'blocked'
                          ? 'bg-rose-950/30 border border-rose-900/30'
                          : 'bg-neutral-900/50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${statusDot[task.status]}`} />
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm ${task.status === 'in_flight' ? 'text-blue-100 font-medium' : ''}`}>
                            {task.title}
                          </div>
                          {task.blockedReason && (
                            <div className="text-xs text-rose-400 mt-0.5">! {task.blockedReason}</div>
                          )}
                          {hasNotes && (
                            <div className="mt-1">
                              {isExpanded ? (
                                <div className="space-y-1">
                                  {task.notes.map((note, i) => (
                                    <div key={i} className="text-xs text-neutral-400 whitespace-pre-wrap border-l-2 border-neutral-700 pl-2">
                                      {note.text}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-xs text-neutral-500 truncate">
                                  {latestNote.split('\n')[0]}
                                </div>
                              )}
                              {(isLongNote || task.notes.length > 1) && (
                                <button
                                  onClick={() => toggleTaskExpand(task._id)}
                                  className="text-xs text-neutral-600 hover:text-neutral-400 mt-1"
                                >
                                  {isExpanded ? '- collapse' : `+ ${task.notes.length} note${task.notes.length > 1 ? 's' : ''}`}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
              )}

              {!isCollapsed && active.length === 0 && (
                <div className="text-neutral-600 text-sm">No active tasks</div>
              )}
            </section>
          )
        })}

        {projects.length === 0 && allDoneTasks.length === 0 && (
          <div className="text-center text-neutral-600 py-12">
            No tasks yet.
          </div>
        )}
      </div>

      {/* Global Completed Section */}
      {allDoneTasks.length > 0 && (
        <section className="mt-6 bg-neutral-900/30 rounded-xl p-4 border border-neutral-800/50">
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className="w-full flex items-center justify-between text-left"
          >
            <h2 className="text-sm uppercase tracking-wider text-emerald-600">
              Completed ({allDoneTasks.length})
            </h2>
            <span className="text-neutral-600 text-xs">
              {showCompleted ? '-' : '+'}
            </span>
          </button>

          {showCompleted && (
            <div className="mt-3 space-y-2">
              {Object.entries(doneTasksByProject).sort(([a], [b]) => a.localeCompare(b)).map(([project, tasks]) => (
                <div key={project} className="space-y-0.5">
                  <div className="text-xs text-neutral-600 uppercase tracking-wider">{project}</div>
                  {tasks.map(task => (
                    <div key={task._id} className="flex items-center gap-2 text-sm text-neutral-600 py-0.5 pl-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 opacity-50" />
                      <span className="line-through">{task.title}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function App() {
  return (
    <ConvexProvider client={convex}>
      <Dashboard />
    </ConvexProvider>
  )
}

export default App
