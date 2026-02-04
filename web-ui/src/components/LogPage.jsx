import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, Terminal, Trash2 } from 'lucide-react';
import axios from 'axios';

/**
 * 日志页面组件
 */
const LogPage = ({ onBack, baseUrl }) => {
  const [logs, setLogs] = useState([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('all');
  const logsEndRef = useRef(null);
  const containerRef = useRef(null);
  const lastIdRef = useRef(0);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await axios.get(`${baseUrl}/logs?limit=500`);
        if (res.data?.logs) {
          setLogs(res.data.logs);
          if (res.data.logs.length > 0) {
            lastIdRef.current = res.data.logs[res.data.logs.length - 1].id;
          }
        }
      } catch (err) {
        console.error('[Logs] Failed to fetch logs:', err.message);
      }
    };
    fetchLogs();
  }, [baseUrl]);

  useEffect(() => {
    const timerRef = { current: null };

    const timer = setTimeout(() => {
      const eventSource = new EventSource(`${baseUrl}/logs/stream?since_id=${lastIdRef.current}`);

      eventSource.onmessage = (event) => {
        try {
          const log = JSON.parse(event.data);
          if (log.id <= lastIdRef.current) return;
          lastIdRef.current = log.id;
          setLogs(prev => {
            const newLogs = [...prev, log];
            if (newLogs.length > 1000) {
              return newLogs.slice(-1000);
            }
            return newLogs;
          });
        } catch (e) {
          // Ignore parse errors
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
      };

      timerRef.current = eventSource;
    }, 500);

    return () => {
      clearTimeout(timer);
      if (timerRef.current) {
        timerRef.current.close();
      }
    };
  }, [baseUrl]);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const handleClear = async () => {
    try {
      await axios.post(`${baseUrl}/logs/clear`);
      setLogs([]);
      lastIdRef.current = 0;
    } catch (err) {
      console.error('[Logs] Failed to clear logs:', err.message);
    }
  };

  const filteredLogs = logs.filter(log => {
    if (filter === 'all') return true;
    return log.level.toLowerCase() === filter;
  });

  const getLevelColor = (level) => {
    switch (level.toLowerCase()) {
      case 'error': return 'text-red-400';
      case 'warning': return 'text-amber-400';
      case 'info': return 'text-sky-400';
      case 'debug': return 'text-stone-500';
      default: return 'text-stone-400';
    }
  };

  return (
    <div className="flex flex-col h-screen bg-stone-900 text-stone-100">
      {/* Header */}
      <div className="h-11 bg-stone-800/80 backdrop-blur-sm border-b border-stone-700/50 flex items-center justify-between px-4 drag-region">
        <div className="flex items-center gap-3 no-drag">
          <button onClick={onBack} className="p-1.5 hover:bg-stone-700 rounded-lg text-stone-400 hover:text-white transition-colors">
            <ChevronLeft size={18} />
          </button>
          <Terminal size={16} className="text-amber-500" />
          <span className="font-semibold text-stone-200 text-sm">Logs</span>
          <span className="text-xs text-stone-500">({filteredLogs.length})</span>
        </div>
        <div className="flex items-center gap-2 no-drag">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-stone-700/50 border border-stone-600/50 rounded-lg px-2.5 py-1.5 text-xs text-stone-300 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
          >
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              autoScroll ? 'bg-amber-500/20 text-amber-400' : 'bg-stone-700/50 text-stone-400'
            }`}
          >
            Auto-scroll
          </button>
          <button onClick={handleClear} className="p-1.5 hover:bg-stone-700 rounded-lg text-stone-500 hover:text-red-400 transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Log Content */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4 font-mono text-xs dark-scrollbar">
        {filteredLogs.length === 0 ? (
          <div className="text-center text-stone-600 py-12">No logs available</div>
        ) : (
          <div className="space-y-px">
            {filteredLogs.map((log) => (
              <div key={log.id} className="flex gap-3 hover:bg-stone-800/30 px-2 py-1 rounded-lg transition-colors">
                <span className="text-stone-600 shrink-0 tabular-nums">{log.time}</span>
                <span className={`shrink-0 w-14 ${getLevelColor(log.level)}`}>[{log.level}]</span>
                <span className="text-stone-400 whitespace-pre-wrap break-all">{log.message}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>
    </div>
  );
};

export default LogPage;
