import React from 'react';

/**
 * 设置分组容器
 */
export const SettingGroup = ({ title, children }) => (
  <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
    <div className="px-4 py-3 bg-stone-50 border-b border-stone-200">
      <h3 className="font-semibold text-stone-700">{title}</h3>
    </div>
    <div className="p-4 space-y-4">{children}</div>
  </div>
);

/**
 * 设置行
 */
export const SettingRow = ({ label, description, children }) => (
  <div className="flex items-start justify-between gap-4">
    <div className="flex-1 min-w-0">
      <div className="font-medium text-stone-800">{label}</div>
      {description && <div className="text-sm text-stone-500 mt-0.5">{description}</div>}
    </div>
    <div className="flex-shrink-0">{children}</div>
  </div>
);

/**
 * 输入框
 */
export const Input = ({ value, onChange, type = 'text', className = '', ...props }) => (
  <input
    type={type}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={`bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 ${className}`}
    {...props}
  />
);

/**
 * 下拉选择框
 */
export const Select = ({ value, onChange, options, className = '', disabled = false }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    disabled={disabled}
    className={`bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
  >
    {options.map(opt => (
      <option key={opt.value} value={opt.value}>{opt.label}</option>
    ))}
  </select>
);

/**
 * 开关按钮
 */
export const Toggle = ({ checked, onChange }) => (
  <button
    onClick={() => onChange(!checked)}
    className={`w-11 h-6 rounded-full transition-colors ${checked ? 'bg-amber-500' : 'bg-stone-300'}`}
  >
    <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
  </button>
);
