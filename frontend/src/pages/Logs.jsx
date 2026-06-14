import React, { useState, useEffect } from 'react'
import { useAuth } from '../App'
import { Terminal, RefreshCw, Trash } from 'lucide-react'

import { API_BASE } from '../config'

export default function Logs() {
  const { user } = useAuth()
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchLogs = async () => {
    try {
      const response = await fetch(`${API_BASE}/logs`, {
        headers: { 'Authorization': `Bearer ${user.token}` }
      })
      const data = await response.json()
      if (response.ok) {
        setLogs(data)
      }
    } catch (err) {
      setError('Connection error fetching system logs.')
    }
  }

  useEffect(() => {
    fetchLogs()
    // Poll logs every 5 seconds
    const interval = setInterval(fetchLogs, 5000)
    return () => clearInterval(interval)
  }, [])

  const getActionColor = (action) => {
    if (action.includes('FAIL') || action.includes('ERROR')) return '#f87171' // Red
    if (action.includes('SUCCESS') || action.includes('SEED')) return '#34d399' // Green
    if (action.includes('CREW') || action.includes('AGENT')) return '#c084fc' // Purple
    if (action.includes('PUBLISH')) return '#38bdf8' // Blue
    return '#fbbf24' // Yellow/Orange
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>System & Agent Logs</h1>
          <p style={{ color: 'var(--text-muted)' }}>Real-time execution log of authentication milestones and CrewAI agent operations.</p>
        </div>
        
        <button onClick={fetchLogs} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <RefreshCw size={14} /> Clear & Reload
        </button>
      </div>

      <div className="glass-card" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-light)', paddingBottom: '0.75rem' }}>
          <Terminal size={18} style={{ color: 'var(--primary)' }} />
          <span style={{ fontSize: '0.875rem', fontWeight: 600, fontFamily: 'monospace' }}>terminal_stream@agent-karuppu:~$ tail -n 100 system.log</span>
        </div>

        <div className="console-container">
          {logs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem', fontSize: '0.875rem' }}>
              No log messages available in pipeline database.
            </div>
          ) : (
            logs.map(log => (
              <div key={log.id} className="console-line">
                <span className="console-timestamp">
                  [{new Date(log.created_at).toLocaleTimeString()}]
                </span>
                <span 
                  className="console-action"
                  style={{ color: getActionColor(log.action) }}
                >
                  [{log.action}]
                </span>
                {log.username && (
                  <span style={{ color: 'var(--primary)', marginRight: '0.5rem', fontWeight: 600 }}>
                    @{log.username}
                  </span>
                )}
                {log.ip_address && (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginRight: '0.5rem', fontFamily: 'monospace' }}>
                    ({log.ip_address})
                  </span>
                )}
                <span style={{ color: '#e5e7eb' }}>
                  {log.description}
                </span>
              </div>
            ))
          )}
        </div>
        
        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <span>Active Connection: ws://redis:6379/logs</span>
          <span>Logs are persisted in Postgres tables for security audit compliance.</span>
        </div>
      </div>
    </div>
  )
}
