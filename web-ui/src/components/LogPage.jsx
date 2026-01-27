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

  // 初始加载日志
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

  // SSE 流式获取新日志
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
          // 忽略解析错误
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

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // 清空日志
  const handleClear = async () => {
    try {
      await axios.post(`${baseUrl}/logs/clear`);
      setLogs([]);
      lastIdRef.current = 0;
    } catch (err) {
      console.error('[Logs] Failed to clear logs:', err.message);
    }
  };

  // 过滤日志
  const filteredLogs = logs.filter(log => {
    if (filter === 'all') return true;
    return log.level.toLowerCase() === filter;
  });

  // 日志级别颜色
  const getLevelColor = (level) => {
    switch (level.toLowerCase()) {
      case 'error': return 'text-red-400';
      case 'warning': return 'text-yellow-400';
      case 'info': return 'text-blue-400';
      case 'debug': return 'text-stone-500';
      default: return 'text-stone-400';
    }
  };

  return (
    <div className="flex flex-col h-screen bg-stone-900 text-stone-100">
      {/* Header */}
      <div className="h-12 bg-stone-800 border-b border-stone-700 flex items-center justify-between px-4 drag-region">
        <div className="flex items-center gap-3 no-drag">
          <button onClick={onBack} className="p-1.5 hover:bg-stone-700 rounded-lg text-stone-400 hover:text-white">
            <ChevronLeft size={20} />
          </button>
          <Terminal size={18} className="text-amber-500" />
          <span className="font-bold text-stone-200">Backend Logs</span>
          <span className="text-xs text-stone-500 ml-2">({filteredLogs.length} entries)</span>
        </div>
        <div className="flex items-center gap-2 no-drag">
          {/* Filter */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-stone-700 border border-stone-600 rounded px-2 py-1 text-sm text-stone-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
          >
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
          {/* Auto scroll toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 py-1 rounded text-sm ${autoScroll ? 'bg-amber-500 text-white' : 'bg-stone-700 text-stone-300'}`}
          >
            Auto-scroll
          </button>
          {/* Clear */}
          <button onClick={handleClear} className="p-1.5 hover:bg-stone-700 rounded text-stone-400 hover:text-red-400">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Log Content */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4 font-mono text-xs">
        {filteredLogs.length === 0 ? (
          <div className="text-center text-stone-500 py-8">No logs available</div>
        ) : (
          <div className="space-y-0.5">
            {filteredLogs.map((log) => (
              <div key={log.id} className="flex gap-2 hover:bg-stone-800/50 px-1 py-0.5 rounded">
                <span className="text-stone-600 shrink-0">{log.time}</span>
                <span className={`shrink-0 w-16 ${getLevelColor(log.level)}`}>[{log.level}]</span>
                <span className="text-stone-300 whitespace-pre-wrap break-all">{log.message}</span>
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
